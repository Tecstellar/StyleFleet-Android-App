import { Expense } from '../src/types/domain';
import { buildExpenseCsv, dayMatrix, expenseRange, expensesInRange, groupExpenses, parseDay } from '../src/utils/expenseReport';

const staff = [
  { id: 'a', name: 'Stylist A' },
  { id: 'b', name: 'Stylist B' },
];
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 0).toISOString();
const ex = (id: string, cat: string, amount: number, day: number, staffId: string | null = null): Expense =>
  ({
    id,
    shop_id: 's',
    category_id: null,
    category_name: cat,
    note: cat,
    amount_minor: amount * 100,
    payment_method: 'Cash',
    expense_date: 'Oct',
    created_at: at(day),
    staff_id: staffId,
  }) as Expense;

const list = [
  ex('1', 'Salary', 10000, 15, 'a'),
  ex('2', 'Salary', 8000, 15, 'b'),
  ex('3', 'Rent', 20000, 15),
  ex('4', 'Electricity', 1500, 14),
  ex('5', 'Advance', 2000, 14, 'a'),
];
const now = new Date(2026, 9, 15, 15, 0);

describe('expense report', () => {
  it('splits spend by stylist and by shop category, biggest first', () => {
    const rows = groupExpenses(list, staff).map((g) => [g.label, g.totalMinor / 100]);
    expect(rows).toEqual([
      ['Rent', 20000],
      ['Stylist A', 12000],
      ['Stylist B', 8000],
      ['Electricity', 1500],
    ]);
  });

  it('filters by day, week, month and custom range', () => {
    const count = (p: 'Day' | 'Week' | 'Month' | 'Custom', s = '', e = '') =>
      expensesInRange(list, expenseRange(p, s, e, now)!).length;
    expect(count('Day')).toBe(3);
    expect(count('Week')).toBe(5);
    expect(count('Month')).toBe(5);
    expect(count('Custom', '2026-10-14', '2026-10-14')).toBe(2);
  });

  it('rejects bad custom ranges', () => {
    expect(expenseRange('Custom', '2026-10-16', '2026-10-15', now)).toBeNull();
    expect(expenseRange('Custom', 'nope', '2026-10-15', now)).toBeNull();
    expect(parseDay('2026-02-31')).toBeNull();
  });

  it('builds a day by day matrix whose rows add up', () => {
    const m = dayMatrix(list, staff);
    expect(m.columns).toHaveLength(4);
    expect(m.rows.map((r) => r.totalMinor / 100)).toEqual([3500, 38000]);
    expect(m.rows.reduce((s, r) => s + r.totalMinor, 0)).toBe(list.reduce((s, e) => s + e.amount_minor, 0));
  });

  it('exports every section to the csv', () => {
    const csv = buildExpenseCsv(list, staff, { shopName: 'Shop', rangeLabel: 'Oct', generatedOn: 'now' });
    expect(csv).toContain('"SPENT ON"');
    expect(csv).toContain('"DAY BY DAY"');
    expect(csv).toContain('"ALL ENTRIES"');
    expect(csv).toContain('"Stylist A","Team member","2","12000.00"');
  });
});
