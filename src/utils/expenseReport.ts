import { Expense, StaffMember } from '../types/domain';
import { inrFromMinor } from './format';
import { countsInProfit } from './expenseProfit';

export type ExpensePeriod = 'Day' | 'Week' | 'Month' | 'Custom';

export interface ExpenseRange {
  startMs: number;
  endMs: number;
  /** English label used in the downloaded files, e.g. "October 2026" or "1 Oct 2026 to 15 Oct 2026". */
  label: string;
}

export interface ExpenseGroupRow {
  key: string;
  /** Team member name, or the category (Rent, Electricity...) for shop expenses. */
  label: string;
  isPerson: boolean;
  count: number;
  totalMinor: number;
}

export interface ExpenseDayMatrix {
  columns: string[];
  rows: { dateKey: string; cells: number[]; totalMinor: number }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

export const dateKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** When the expense was made. created_at is a full timestamp; expense_date is only display text. */
export const expenseMs = (e: Pick<Expense, 'created_at'>): number => {
  const t = new Date(e.created_at || '').getTime();
  return isNaN(t) ? 0 : t;
};

const dayText = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** "YYYY-MM-DD" to a local date, or null when it is not a real calendar day. */
export const parseDay = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((value || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
};

/** The dates a period covers. Week = last 7 days including today, Month = this calendar month so far. */
export function expenseRange(
  period: ExpensePeriod,
  customStart = '',
  customEnd = '',
  now: Date = new Date()
): ExpenseRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  if (period === 'Day') return { startMs: today.getTime(), endMs: endOfDay(today), label: dayText(today.getTime()) };
  if (period === 'Week') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    return { startMs: start.getTime(), endMs: endOfDay(today), label: `${dayText(start.getTime())} to ${dayText(today.getTime())}` };
  }
  if (period === 'Month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      startMs: start.getTime(),
      endMs: endOfDay(today),
      label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    };
  }
  const s = parseDay(customStart);
  const e = parseDay(customEnd);
  if (!s || !e || s.getTime() > e.getTime()) return null;
  return { startMs: s.getTime(), endMs: endOfDay(e), label: `${dayText(s.getTime())} to ${dayText(e.getTime())}` };
}

export const expensesInRange = (expenses: Expense[], range: ExpenseRange): Expense[] =>
  expenses.filter((e) => {
    const t = expenseMs(e);
    return t >= range.startMs && t <= range.endMs;
  });

const groupOf = (e: Expense, staff: Pick<StaffMember, 'id' | 'name'>[]) => {
  const member = e.staff_id ? staff.find((s) => s.id === e.staff_id) : undefined;
  if (member) return { key: `p:${member.id}`, label: member.name.trim(), isPerson: true };
  const cat = (e.category_name || 'General').trim() || 'General';
  return { key: `c:${cat.toLowerCase()}`, label: cat, isPerson: false };
};

/** Money spent per team member and per shop category (Rent, Electricity...), biggest first. */
export function groupExpenses(expenses: Expense[], staff: Pick<StaffMember, 'id' | 'name'>[]): ExpenseGroupRow[] {
  const map = new Map<string, ExpenseGroupRow>();
  for (const e of expenses) {
    const g = groupOf(e, staff);
    const row = map.get(g.key) || { ...g, count: 0, totalMinor: 0 };
    row.count += 1;
    row.totalMinor += e.amount_minor || 0;
    map.set(g.key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.totalMinor - a.totalMinor);
}

const MAX_COLUMNS = 6;

/** One row per day, one column per person / category (the biggest few, the rest under "Other"). */
export function dayMatrix(expenses: Expense[], staff: Pick<StaffMember, 'id' | 'name'>[]): ExpenseDayMatrix {
  const groups = groupExpenses(expenses, staff);
  const shown = groups.length > MAX_COLUMNS ? groups.slice(0, MAX_COLUMNS - 1) : groups;
  const hasOther = groups.length > shown.length;
  const index = new Map(shown.map((g, i) => [g.key, i]));
  const columns = [...shown.map((g) => g.label), ...(hasOther ? ['Other'] : [])];
  const byDay = new Map<string, number[]>();
  for (const e of expenses) {
    const key = dateKey(expenseMs(e));
    const cells = byDay.get(key) || columns.map(() => 0);
    const col = index.get(groupOf(e, staff).key) ?? columns.length - 1;
    cells[col] += e.amount_minor || 0;
    byDay.set(key, cells);
  }
  const rows = Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, cells]) => ({ dateKey: key, cells, totalMinor: cells.reduce((s, v) => s + v, 0) }));
  return { columns, rows };
}

export interface ExpenseReportMeta {
  shopName: string;
  rangeLabel: string;
  generatedOn: string;
}

/** A cell that starts with = + - @ would run as a formula in Excel, so mark it as text. */
const csvText = (value: string): string => {
  const safe = /^[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const rupees = (minor: number): string => `"${(minor / 100).toFixed(2)}"`;

const esc = (s: string): string =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const keyText = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const entryWho = (e: Expense, staff: Pick<StaffMember, 'id' | 'name'>[]): string => {
  const g = groupOf(e, staff);
  return g.isPerson ? g.label : '';
};

export function buildExpenseCsv(
  expenses: Expense[],
  staff: Pick<StaffMember, 'id' | 'name'>[],
  meta: ExpenseReportMeta
): string {
  const groups = groupExpenses(expenses, staff);
  const matrix = dayMatrix(expenses, staff);
  const total = expenses.reduce((s, e) => s + (e.amount_minor || 0), 0);
  const rows: string[] = [];
  rows.push('"StyleFleet Expense Report"');
  rows.push(`"Shop Name",${csvText(meta.shopName)}`);
  rows.push(`"Period",${csvText(meta.rangeLabel)}`);
  rows.push(`"Generated On",${csvText(meta.generatedOn)}`);
  rows.push('');
  rows.push('"SPENT ON"');
  rows.push('"Name","Type","Entries","Amount (INR)"');
  for (const g of groups) {
    rows.push([csvText(g.label), csvText(g.isPerson ? 'Team member' : 'Shop expense'), `"${g.count}"`, rupees(g.totalMinor)].join(','));
  }
  rows.push(['"Total"', '""', `"${expenses.length}"`, rupees(total)].join(','));
  rows.push('');
  rows.push('"DAY BY DAY"');
  rows.push([csvText('Date'), ...matrix.columns.map(csvText), csvText('Total (INR)')].join(','));
  for (const r of matrix.rows) {
    rows.push([csvText(keyText(r.dateKey)), ...r.cells.map(rupees), rupees(r.totalMinor)].join(','));
  }
  rows.push('');
  rows.push('"ALL ENTRIES"');
  rows.push('"Date","Team member","Category","Note","Payment","Amount (INR)","Counted in profit"');
  const sorted = [...expenses].sort((a, b) => expenseMs(a) - expenseMs(b));
  for (const e of sorted) {
    rows.push(
      [
        csvText(keyText(dateKey(expenseMs(e)))),
        csvText(entryWho(e, staff)),
        csvText(e.category_name || 'General'),
        csvText(e.note || ''),
        csvText(e.payment_method || ''),
        rupees(e.amount_minor || 0),
        csvText(countsInProfit(e) ? 'Yes' : 'No'),
      ].join(',')
    );
  }
  return rows.join('\n');
}

export function buildExpenseHtml(
  expenses: Expense[],
  staff: Pick<StaffMember, 'id' | 'name'>[],
  meta: ExpenseReportMeta
): string {
  const groups = groupExpenses(expenses, staff);
  const matrix = dayMatrix(expenses, staff);
  const total = expenses.reduce((s, e) => s + (e.amount_minor || 0), 0);
  const money = (m: number) => esc(inrFromMinor(m));
  const groupRows = groups
    .map(
      (g) => `<tr>
        <td style="font-weight: 600;">${esc(g.label)}</td>
        <td style="color: #6B7280;">${g.isPerson ? 'Team member' : 'Shop expense'}</td>
        <td>${g.count}</td>
        <td class="num">${money(g.totalMinor)}</td>
      </tr>`
    )
    .join('\n');
  const dayRows = matrix.rows
    .map(
      (r) => `<tr>
        <td style="font-weight: 600;">${esc(keyText(r.dateKey))}</td>
        ${r.cells.map((c) => `<td class="num">${c > 0 ? money(c) : '-'}</td>`).join('')}
        <td class="num">${money(r.totalMinor)}</td>
      </tr>`
    )
    .join('\n');
  const entryRows = [...expenses]
    .sort((a, b) => expenseMs(a) - expenseMs(b))
    .map((e) => {
      const who = entryWho(e, staff);
      return `<tr>
        <td style="width: 22%; color: #6B7280;">${esc(keyText(dateKey(expenseMs(e))))}</td>
        <td style="font-weight: 600;">${esc(who ? `${who} · ${e.category_name || 'General'}` : e.category_name || 'General')}</td>
        <td style="color: #6B7280;">${esc(e.note || '-')}</td>
        <td class="num">${money(e.amount_minor || 0)}${countsInProfit(e) ? '' : ' *'}</td>
      </tr>`;
    })
    .join('\n');
  const hasUncounted = expenses.some((e) => !countsInProfit(e));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 28px; color: #111827; }
    .header { border-bottom: 2px solid #D4AF37; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 22px; }
    .sub { color: #6B7280; font-size: 12px; margin-top: 4px; }
    .section { margin-top: 22px; font-weight: 800; font-size: 14px; border-bottom: 2px solid #EF4444; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
    td, th { padding: 7px 8px; border-bottom: 1px solid #E5E7EB; vertical-align: top; text-align: left; }
    th { background: #F9FAFB; color: #4B5563; font-weight: 700; }
    td.num, th.num { text-align: right; font-weight: 700; white-space: nowrap; }
    .total { margin-top: 20px; border-top: 2px solid #111827; padding-top: 12px; display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; }
    .footer { margin-top: 24px; font-size: 11px; color: #9CA3AF; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(meta.shopName)}</h1>
    <div class="sub">Expense Report &middot; ${esc(meta.rangeLabel)}</div>
  </div>

  <div class="section">Spent on</div>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Entries</th><th class="num">Amount</th></tr></thead>
    <tbody>${groupRows || '<tr><td colspan="4">No expenses in this period.</td></tr>'}</tbody>
  </table>

  <div class="section">Day by day</div>
  <table>
    <thead><tr><th>Date</th>${matrix.columns.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${dayRows || `<tr><td colspan="${matrix.columns.length + 2}">No expenses in this period.</td></tr>`}</tbody>
  </table>

  <div class="section">All entries</div>
  <table>
    <thead><tr><th>Date</th><th>For</th><th>Note</th><th class="num">Amount</th></tr></thead>
    <tbody>${entryRows || '<tr><td colspan="4">No expenses in this period.</td></tr>'}</tbody>
  </table>
  ${hasUncounted ? '<div class="sub" style="margin-top: 6px;">* Not counted in profit</div>' : ''}

  <div class="total"><span>${expenses.length} ${expenses.length === 1 ? 'entry' : 'entries'}</span><span>Total: ${money(total)}</span></div>
  <div class="footer">Generated by StyleFleet &middot; ${esc(meta.generatedOn)}</div>
</body>
</html>`;
}
