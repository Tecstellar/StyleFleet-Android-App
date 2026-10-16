import { Bill } from '../src/types/domain';
import { buildMonthCsv } from '../src/utils/salesSummaryExport';
import { getSummaryMonthDetail, receivedForBills } from '../src/utils/salesSummary';

const bill = (over: Partial<Bill>): Bill =>
  ({
    id: Math.random().toString(),
    shop_id: 's',
    customer_id: null,
    customer_name: 'C',
    staff_id: null,
    staff_name: 'Owner',
    invoice_number: Math.random().toString(),
    status: 'paid',
    total_minor: 0,
    created_at: new Date(2026, 9, 15, 11, 0).toISOString(),
    payment_method: 'UPI',
    items: [],
    ...over,
  }) as Bill;

describe('amount received by payment mode', () => {
  const bills = [
    bill({ total_minor: 50000, payment_method: 'UPI' }),
    bill({ total_minor: 30000, payment_method: 'Cash' }),
    bill({ total_minor: 20000, status: 'partially_paid', paid_amount_minor: 5000, payment_method: 'Cash' }),
    bill({ total_minor: 10000, status: 'pending' }),
    bill({
      total_minor: 40000,
      payments: [
        { amount_minor: 10000, method: 'Cash', paid_at: '' },
        { amount_minor: 30000, method: 'UPI', paid_at: '' },
      ],
    }),
  ];

  it('splits what was collected into UPI, cash and card and adds up to the final amount', () => {
    const r = receivedForBills(bills);
    expect(r.upiMinor).toBe(80000);
    expect(r.cashMinor).toBe(45000);
    expect(r.cardMinor).toBe(0);
    expect(r.totalMinor).toBe(125000);
    expect(r.upiMinor + r.cashMinor + r.cardMinor).toBe(r.totalMinor);
  });

  it('counts the unpaid part of pending and part-paid bills as pending, not received', () => {
    expect(receivedForBills(bills).pendingMinor).toBe(25000);
  });

  it('is part of the month detail and of the Excel download', () => {
    const detail = getSummaryMonthDetail(bills, 2026, 9);
    expect(detail.received.totalMinor).toBe(125000);
    const csv = buildMonthCsv(detail, { shopName: 'Shop', monthLabel: 'October 2026', generatedOn: 'now' });
    expect(csv).toContain('"AMOUNT RECEIVED"');
    expect(csv).toContain('"UPI","800.00"');
    expect(csv).toContain('"Cash","450.00"');
    expect(csv).toContain('"Total Received","1250.00"');
  });
});

describe('payment mode text on each bill', () => {
  it('names the mode, both modes when split, and flags pending and part-paid bills', () => {
    const { paymentModeText } = require('../src/utils/salesSummary');
    expect(paymentModeText(bill({ payment_method: 'cash', total_minor: 100 }))).toBe('Cash');
    expect(paymentModeText(bill({ status: 'pending', total_minor: 100 }))).toBe('Pending');
    expect(paymentModeText(bill({ status: 'partially_paid', paid_amount_minor: 10, total_minor: 100, payment_method: 'UPI' }))).toBe('UPI (part)');
    expect(
      paymentModeText(
        bill({
          total_minor: 100,
          payments: [
            { amount_minor: 40, method: 'Cash', paid_at: '' },
            { amount_minor: 60, method: 'UPI', paid_at: '' },
          ],
        })
      )
    ).toBe('Cash + UPI');
  });
});
