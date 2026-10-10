import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  acceptableAmountsRupees,
  isWithinLaunchOffer,
  legacyOrderBelongsToShop,
  normalizePlanId,
  planDays,
  priceRupees,
} from '../supabase/functions/_shared/plans';
import {
  LAUNCH_OFFER_SUBSCRIPTION_PLANS,
  STANDARD_SUBSCRIPTION_PLANS,
  getPlanById,
} from '../src/config/planConfig';
import { isWithinFirst30DaysOfRegistration } from '../src/utils/subscriptionUtils';

const mockInvoke = jest.fn();
const mockInsert = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));

// eslint-disable-next-line import/first
import { subscriptionRepository } from '../src/repositories/subscriptionRepository';

describe('payment server prices match the app', () => {
  it('has the same regular price, launch price and length for every plan', () => {
    for (const plan of STANDARD_SUBSCRIPTION_PLANS) {
      const id = normalizePlanId(plan.id)!;
      expect(id).not.toBeNull();
      expect(priceRupees(id, false)).toBe(plan.priceInRupees);
      expect(planDays(id)).toBe(plan.durationDays);
    }
    for (const plan of LAUNCH_OFFER_SUBSCRIPTION_PLANS) {
      const id = normalizePlanId(plan.id)!;
      expect(priceRupees(id, true)).toBe(plan.priceInRupees);
    }
  });

  it('understands every plan id the app accepts and rejects unknown ones', () => {
    for (const raw of ['3_months', '6_months', '12_months', 'sf_plan_3m', 'sf_plan_6m', 'sf_plan_12m']) {
      expect(normalizePlanId(raw)).toBe(getPlanById(raw)!.id);
    }
    expect(normalizePlanId('free_forever')).toBeNull();
    expect(normalizePlanId(undefined)).toBeNull();
  });

  it('counts the launch offer window exactly like the app', () => {
    const registered = '2026-06-10T09:30:00.000Z';
    for (let day = -3; day <= 40; day += 1) {
      const now = new Date(Date.parse(registered) + day * 86400000);
      expect(isWithinLaunchOffer(registered, now)).toBe(isWithinFirst30DaysOfRegistration(registered, now));
    }
    expect(isWithinLaunchOffer(null)).toBe(false);
    expect(isWithinLaunchOffer('not a date')).toBe(false);
  });

  it('accepts only the launch or regular price of the plan that was ordered', () => {
    expect(acceptableAmountsRupees('6_months').sort()).toEqual([4799, 5999]);
    expect(acceptableAmountsRupees('3_months')).toEqual([2999]);
    expect(acceptableAmountsRupees('12_months')).not.toContain(1);
  });

  it('matches an old untagged order to its own shop only', () => {
    const shop = '12345678-aaaa-4bbb-8ccc-1234567890ab';
    expect(legacyOrderBelongsToShop('sf_12345678_1760000000000', shop)).toBe(true);
    expect(legacyOrderBelongsToShop('sf_87654321_1760000000000', shop)).toBe(false);
    expect(legacyOrderBelongsToShop('other_12345678_1', shop)).toBe(false);
  });
});

describe('the app and the payment server', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockInvoke.mockReset();
    mockInsert.mockReset();
    mockInsert.mockResolvedValue({ error: null });
  });

  const order = {
    shopId: '12345678-aaaa-4bbb-8ccc-1234567890ab',
    planId: '6_months' as const,
    customerName: 'Asha',
    customerPhone: '9876543210',
    isLaunchOffer: false,
  };

  it('sends the price it showed only as a cross-check, never as the amount to charge', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true, orderId: 'sf_x', paymentSessionId: 'sess' }, error: null });
    await subscriptionRepository.createPaymentOrder(order);

    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.expectedAmount).toBe(5999);
    expect(body).not.toHaveProperty('amount');
  });

  it('shows the reason the server gives when it refuses to start a payment', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'The price for this plan is now ₹5,999.' }) } },
    });
    await expect(subscriptionRepository.createPaymentOrder(order)).rejects.toThrow(/price for this plan/);
  });

  it('does not fall back to calling Cashfree directly when the server cannot be reached', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('fetch must not be called');
    }) as never);
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'offline' } });

    await expect(subscriptionRepository.createPaymentOrder(order)).rejects.toThrow(/Unable to start the payment/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('adds no second subscription row after the server has already saved the payment', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, message: 'ok', subscription: { amount_minor: 599900 } },
      error: null,
    });
    const result = await subscriptionRepository.verifyPaymentOrder({
      orderId: 'sf_x',
      shopId: order.shopId,
      planId: order.planId,
    });

    expect(result.success).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reports a payment the server did not confirm as not activated', async () => {
    mockInvoke.mockResolvedValue({ data: { success: false, status: 'ACTIVE' }, error: null });
    const pending = await subscriptionRepository.verifyPaymentOrder({ orderId: 'sf_x', shopId: order.shopId, planId: order.planId });
    expect(pending.success).toBe(false);
    expect(pending.message).toMatch(/ACTIVE/);

    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'This payment belongs to a different salon.' }) } },
    });
    const refused = await subscriptionRepository.verifyPaymentOrder({ orderId: 'sf_x', shopId: order.shopId, planId: order.planId });
    expect(refused.success).toBe(false);
    expect(refused.message).toMatch(/different salon/);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
