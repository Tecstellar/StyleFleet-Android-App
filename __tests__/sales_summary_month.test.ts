import { Bill } from '../src/types/domain';
import { getSummaryMonthDetail } from '../src/utils/salesSummary';
import { buildMonthCsv, buildMonthHtml } from '../src/utils/salesSummaryExport';

let seq = 0;
const bill = (
  m: number, // 1-12, year 2026
  d: number,
  hour: number,
  total: number,
  customer: string,
  items: { name: string; qty?: number }[] = [],
  extra: Partial<Bill> = {}
): Bill =>
  ({
    id: `m${++seq}`,
    shop_id: 's',
    customer_id: null,
    customer_name: customer,
    staff_id: null,
    staff_name: '',
    invoice_number: `INV-${seq}`,
    status: 'paid',
    subtotal_minor: total,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: total,
    notes: null,
    issued_at: new Date(2026, m - 1, d, hour).toISOString(),
    created_at: new Date(2026, m - 1, d, hour).toISOString(),
    payment_method: 'UPI',
    items: items.map((i) => ({
      service_id: null,
      service_name_snapshot: i.name,
      quantity: i.qty ?? 1,
      unit_price_minor: 0,
      discount_minor: 0,
      tax_minor: 0,
      line_total_minor: 0,
      staff_id: null,
    })),
    ...extra,
  }) as Bill;

const bills: Bill[] = [
  bill(10, 7, 15, 30000, 'Ravi', [{ name: 'Facial' }]),
  bill(10, 7, 10, 50000, 'Asha', [{ name: 'Haircut' }, { name: 'Beard', qty: 2 }]),
  bill(10, 2, 11, 20000, 'Meena', [{ name: 'Spa' }]),
  bill(9, 30, 18, 99900, 'September person', [{ name: 'Colour' }]),
  bill(11, 1, 9, 77700, 'November person', [{ name: 'Wax' }]),
];

const meta = { shopName: 'Glow & Co', monthLabel: 'October 2026', generatedOn: '07/10/2026, 5:00:00 pm' };

describe('month detail: everything inside one month', () => {
  const detail = getSummaryMonthDetail(bills, 2026, 9);

  it('holds only that month, oldest day first', () => {
    expect(detail.days.map((d) => d.day)).toEqual([2, 7]);
    expect(detail.totals).toEqual({ billsCount: 3, salesMinor: 100000 });
  });

  it('lists each day\'s bills earliest first, with customer, services and price', () => {
    const seventh = detail.days[1];
    expect(seventh.bills.map((b) => b.customerName)).toEqual(['Asha', 'Ravi']);
    expect(seventh.bills[0].services).toEqual(['Haircut', 'Beard ×2']);
    expect(seventh.bills[0].priceMinor).toBe(50000);
    expect(seventh.salesMinor).toBe(80000);
  });

  it('does not leak the neighbouring months', () => {
    const names = detail.days.flatMap((d) => d.bills.map((b) => b.customerName));
    expect(names).not.toContain('September person');
    expect(names).not.toContain('November person');
  });

  it('an empty month is empty, not an error', () => {
    const empty = getSummaryMonthDetail(bills, 2026, 0);
    expect(empty.days).toEqual([]);
    expect(empty.totals).toEqual({ billsCount: 0, salesMinor: 0 });
  });
});

describe('Excel (CSV) export', () => {
  const detail = getSummaryMonthDetail(bills, 2026, 9);
  const csv = buildMonthCsv(detail, meta);
  const lines = csv.split('\n');

  it('has the shop, month and a header row', () => {
    expect(lines[0]).toBe('"StyleFleet Sales Summary"');
    expect(csv).toContain('"Shop Name","Glow & Co"');
    expect(csv).toContain('"Month","October 2026"');
    expect(csv).toContain('"Date","Customer","Services","Price (INR)"');
  });

  it('has one row per bill with the price in rupees', () => {
    const rows = lines.filter((l) => l.includes('"Asha"') || l.includes('"Ravi"') || l.includes('"Meena"'));
    expect(rows).toHaveLength(3);
    const asha = rows.find((l) => l.includes('"Asha"'))!;
    expect(asha).toContain('"Haircut; Beard ×2"');
    expect(asha).toContain('"500.00"');
  });

  it('ends with the month totals', () => {
    expect(lines[lines.length - 2]).toBe('"Total Bills","3"');
    expect(lines[lines.length - 1]).toBe('"Total Sales (INR)","1000.00"');
  });

  it('labels a nameless customer as Walk-in', () => {
    const walkIn = getSummaryMonthDetail([bill(10, 3, 9, 1000, '', [{ name: 'Trim' }])], 2026, 9);
    expect(buildMonthCsv(walkIn, meta)).toContain('"Walk-in"');
  });

  it('keeps names that start with = + - @ from running as spreadsheet formulas', () => {
    const risky = getSummaryMonthDetail(
      [bill(10, 3, 9, 1000, '=HYPERLINK("http://x")', [{ name: '+cmd' }]), bill(10, 3, 10, 1000, '@sum', [{ name: '-1' }])],
      2026,
      9
    );
    const out = buildMonthCsv(risky, meta);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain(`"'+cmd"`);
    expect(out).toContain(`"'@sum"`);
    expect(out).toContain(`"'-1"`);
  });

  it('escapes quotes in names', () => {
    const quoted = getSummaryMonthDetail([bill(10, 3, 9, 1000, 'Anna "Annie" B', [])], 2026, 9);
    expect(buildMonthCsv(quoted, meta)).toContain('"Anna ""Annie"" B"');
  });
});

describe('PDF export content', () => {
  it('lists every bill and the month total', () => {
    const html = buildMonthHtml(getSummaryMonthDetail(bills, 2026, 9), meta);
    for (const name of ['Asha', 'Ravi', 'Meena', 'Haircut, Beard ×2', 'Facial', 'Spa']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('Glow &amp; Co');
    expect(html).toContain('October 2026');
    expect(html).toContain('3 bills');
    expect(html).not.toContain('September person');
  });

  it('cannot be broken or hijacked by a customer name', () => {
    const evil = getSummaryMonthDetail([bill(10, 3, 9, 1000, '<script>alert(1)</script>', [{ name: '<b>x</b>' }])], 2026, 9);
    const html = buildMonthHtml(evil, meta);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('says so when the month has no sales', () => {
    expect(buildMonthHtml(getSummaryMonthDetail(bills, 2026, 0), meta)).toContain('No sales recorded in this month.');
  });
});

describe('month summary with expenses and net profit', () => {
  const sampleExpenses = [
    {
      id: 'e1',
      shop_id: 's',
      category_id: null,
      category_name: 'Rent & Electricity',
      note: 'Salon rent portion',
      amount_minor: 25000,
      payment_method: 'UPI',
      expense_date: new Date(2026, 9, 5).toISOString(),
      created_at: new Date(2026, 9, 5).toISOString(),
      include_in_profit: true,
    },
    {
      id: 'e2',
      shop_id: 's',
      category_id: null,
      category_name: 'Shampoo & Products',
      note: 'Stock replenishment',
      amount_minor: 15000,
      payment_method: 'Cash',
      expense_date: new Date(2026, 9, 6).toISOString(),
      created_at: new Date(2026, 9, 6).toISOString(),
      include_in_profit: true,
    },
  ];

  it('correctly calculates total expenses, net profit, and profit margin', () => {
    // Total sales in Oct: 100,000. Expenses: 40,000. Net Profit: 60,000. Margin: 60%
    const detail = getSummaryMonthDetail(bills, 2026, 9, sampleExpenses);
    expect(detail.totals.salesMinor).toBe(100000);
    expect(detail.totals.expensesMinor).toBe(40000);
    expect(detail.totals.expensesCount).toBe(2);
    expect(detail.totals.netProfitMinor).toBe(60000);
    expect(detail.totals.marginPct).toBe(60);
  });

  it('includes expenses and net profit in the CSV export', () => {
    const detail = getSummaryMonthDetail(bills, 2026, 9, sampleExpenses);
    const csv = buildMonthCsv(detail, meta);
    expect(csv).toContain('"Total Expenses (INR)","400.00"');
    expect(csv).toContain('"Net Profit (INR)","600.00"');
    expect(csv).toContain('"Profit Margin","60%"');
    expect(csv).toContain('"EXPENSES BREAKDOWN"');
    expect(csv).toContain('"Rent & Electricity"');
    expect(csv).toContain('"Shampoo & Products"');
  });

  it('includes KPI summary and expenses table in the PDF HTML export', () => {
    const detail = getSummaryMonthDetail(bills, 2026, 9, sampleExpenses);
    const html = buildMonthHtml(detail, meta);
    expect(html).toContain('TOTAL EXPENSES');
    expect(html).toContain('NET PROFIT');
    expect(html).toContain('60% Margin');
    expect(html).toContain('Rent &amp; Electricity');
    expect(html).toContain('Shampoo &amp; Products');
  });
});

