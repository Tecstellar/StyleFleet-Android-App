import { createHmac } from 'crypto';
import { createFakeSupabase, FakeCall, FakeResult } from './helpers/fakeSupabase';
import {
  activatePaidOrder,
  checkoutSignatureIsValid,
  hmacSha256Hex,
  orderTargetFromNotes,
  webhookSignatureIsValid,
} from '../supabase/functions/_shared/payments';

const SHOP = '12345678-aaaa-4bbb-8ccc-1234567890ab';
const OTHER_SHOP = '99999999-aaaa-4bbb-8ccc-1234567890ab';
const notes = { app: 'stylefleet', shop_id: SHOP, plan_id: '6_months' };

const paid = (over: Record<string, unknown> = {}) => ({
  orderId: 'order_Abc123',
  paymentId: 'pay_Xyz789',
  notes,
  amountPaise: 599900,
  currency: 'INR',
  ...over,
});

function db(respond: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  return createFakeSupabase(respond);
}

describe('which orders belong to StyleFleet', () => {
  it('accepts an order tagged for StyleFleet with a shop and plan', () => {
    expect(orderTargetFromNotes(notes)).toEqual({ shopId: SHOP, plan: '6_months' });
  });

  it('ignores another app on the same Razorpay account', () => {
    expect(orderTargetFromNotes({ ...notes, app: 'other_app' })).toBeNull();
    expect(orderTargetFromNotes({ shop_id: SHOP, plan_id: '6_months' })).toBeNull();
    expect(orderTargetFromNotes(null)).toBeNull();
    expect(orderTargetFromNotes([])).toBeNull();
  });

  it('rejects a tag with a bad shop or an unknown plan', () => {
    expect(orderTargetFromNotes({ ...notes, shop_id: 'not-a-uuid' })).toBeNull();
    expect(orderTargetFromNotes({ ...notes, plan_id: 'free_forever' })).toBeNull();
  });
});

describe('signatures', () => {
  it('computes the same HMAC as Node', async () => {
    const expected = createHmac('sha256', 'secret').update('hello').digest('hex');
    expect(await hmacSha256Hex('hello', 'secret')).toBe(expected);
  });

  it('accepts a genuine webhook and rejects a forged or missing one', async () => {
    const body = JSON.stringify({ event: 'order.paid' });
    const good = createHmac('sha256', 'whsec').update(body).digest('hex');

    expect(await webhookSignatureIsValid(body, good, 'whsec')).toBe(true);
    expect(await webhookSignatureIsValid(body, good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'), 'whsec')).toBe(false);
    expect(await webhookSignatureIsValid(body + ' ', good, 'whsec')).toBe(false); // body changed
    expect(await webhookSignatureIsValid(body, null, 'whsec')).toBe(false);
    expect(await webhookSignatureIsValid(body, good, '')).toBe(false); // secret not set
  });

  it('accepts a genuine checkout result and rejects a forged one', async () => {
    const sig = createHmac('sha256', 'keysecret').update('order_Abc123|pay_Xyz789').digest('hex');
    expect(await checkoutSignatureIsValid('order_Abc123', 'pay_Xyz789', sig, 'keysecret')).toBe(true);
    expect(await checkoutSignatureIsValid('order_Abc123', 'pay_Other', sig, 'keysecret')).toBe(false);
  });
});

describe('activating a paid order', () => {
  it('saves one active subscription for the tagged shop and plan, for the amount paid', async () => {
    const fake = db();
    const result = await activatePaidOrder(fake, paid());

    expect(result).toMatchObject({ ok: true, alreadyActive: false });
    const inserts = fake.callsTo('subscriptions', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      shop_id: SHOP,
      plan_id: '6_months',
      status: 'active',
      cashfree_order_id: 'order_Abc123',
      cashfree_payment_id: 'pay_Xyz789',
      amount_minor: 599900,
    });
  });

  it('adds nothing when the order was already activated', async () => {
    const fake = db((c) =>
      c.table === 'subscriptions' && c.op === 'select' ? { data: { id: 'sub_1', shop_id: SHOP } } : undefined
    );
    const result = await activatePaidOrder(fake, paid());

    expect(result).toMatchObject({ ok: true, alreadyActive: true });
    expect(fake.callsTo('subscriptions', 'insert')).toHaveLength(0);
  });

  it('refuses a payment that belongs to a different salon', async () => {
    const fake = db();
    const result = await activatePaidOrder(fake, paid(), OTHER_SHOP);

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(fake.callsTo('subscriptions', 'insert')).toHaveLength(0);
  });

  it('refuses an order that is not tagged for StyleFleet', async () => {
    const fake = db();
    const result = await activatePaidOrder(fake, paid({ notes: { app: 'other_app', shop_id: SHOP, plan_id: '6_months' } }));

    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(fake.callsTo('subscriptions', 'insert')).toHaveLength(0);
  });

  it('refuses an amount the plan can never cost', async () => {
    const fake = db();
    const result = await activatePaidOrder(fake, paid({ amountPaise: 100 }));

    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(fake.callsTo('subscriptions', 'insert')).toHaveLength(0);
  });

  it('accepts the launch price and the regular price of the plan', async () => {
    for (const amountPaise of [479900, 599900]) {
      const result = await activatePaidOrder(db(), paid({ amountPaise }));
      expect(result.ok).toBe(true);
    }
  });

  it('reports a failed save as a failure, never as a success', async () => {
    const fake = db((c) =>
      c.table === 'subscriptions' && c.op === 'insert' ? { error: { message: 'db down' } } : undefined
    );
    const result = await activatePaidOrder(fake, paid());

    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it('treats a lost race on the unique order id as the single activation', async () => {
    let selects = 0;
    const fake = db((c) => {
      if (c.table === 'subscriptions' && c.op === 'select') {
        selects += 1;
        return selects === 1 ? { data: null } : { data: { id: 'sub_winner' } };
      }
      if (c.table === 'subscriptions' && c.op === 'insert') return { error: { message: 'duplicate', code: '23505' } };
      return undefined;
    });
    const result = await activatePaidOrder(fake, paid());

    expect(result).toMatchObject({ ok: true, alreadyActive: true });
  });
});
