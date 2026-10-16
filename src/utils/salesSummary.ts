import { Bill, Expense, StaffMember } from '../types/domain';
import { isOpeningDueBill } from '../services/billingService';
import { countsInProfit } from './expenseProfit';

/** When a bill was made: created_at, else issued_at, else 0. */
export const getBillTimestamp = (b: Bill | null | undefined): number => {
  if (!b) return 0;
  if (b.created_at) {
    const t = new Date(b.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  if (b.issued_at) {
    const t = new Date(b.issued_at).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
};

/** When an expense was made: expense_date, else created_at, else 0. */
export const getExpenseTimestamp = (ex: Expense | null | undefined): number => {
  if (!ex) return 0;
  // created_at first: expense_date can be display text like "Oct 15" that parses to the wrong year
  if (ex.created_at) {
    const t = new Date(ex.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  if (ex.expense_date) {
    const t = new Date(ex.expense_date).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
};

export interface SummaryTotals {
  billsCount: number;
  salesMinor: number;
  expensesMinor?: number;
  expensesCount?: number;
  netProfitMinor?: number;
  marginPct?: number;
}

export interface SummaryYear extends SummaryTotals {
  year: number;
}

export interface SummaryMonth extends SummaryTotals {
  /** 0 = January */
  month: number;
}

export interface SummaryDay extends SummaryTotals {
  /** 1-31 */
  day: number;
  dateKey: string;
}

export interface SummaryBillLine {
  id: string;
  customerName: string;
  /** One entry per service, e.g. "Haircut" or "Beard ×2". Empty when the bill has no line items. */
  services: string[];
  /** How it was paid, in English: "UPI", "Cash + UPI", "Cash (part)" or "Pending". */
  paymentMode: string;
  priceMinor: number;
  time: number;
}

export interface SummaryExpenseLine {
  id: string;
  categoryName: string;
  note: string;
  amountMinor: number;
  time: number;
  countsInProfit: boolean;
}

/** Genuine sales only: no deleted bills, no opening-due entries, and a readable date. */
export const summaryBills = (bills: Bill[]): Bill[] =>
  (bills || []).filter((b) => !!b && b.status !== 'deleted' && !isOpeningDueBill(b) && getBillTimestamp(b) > 0);

/** Genuine expenses with readable timestamp. */
export const summaryExpenses = (expenses?: Expense[]): Expense[] =>
  (expenses || []).filter((ex) => !!ex && getExpenseTimestamp(ex) > 0);

const pad = (n: number) => String(n).padStart(2, '0');

export const dateKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const add = (t: SummaryTotals, b: Bill) => {
  t.billsCount += 1;
  t.salesMinor += b.total_minor || 0;
};

/** Years that have sales, newest first. Dates use the phone's local time, like the rest of Reports. */
export function getSummaryYears(bills: Bill[], expenses?: Expense[]): SummaryYear[] {
  const map = new Map<number, SummaryYear>();
  const withExpenses = expenses !== undefined;

  for (const b of summaryBills(bills)) {
    const year = new Date(getBillTimestamp(b)).getFullYear();
    const row = map.get(year) || {
      year,
      billsCount: 0,
      salesMinor: 0,
      ...(withExpenses ? { expensesMinor: 0, expensesCount: 0, netProfitMinor: 0, marginPct: 0 } : {}),
    };
    add(row, b);
    map.set(year, row);
  }

  if (withExpenses) {
    for (const ex of summaryExpenses(expenses)) {
      const year = new Date(getExpenseTimestamp(ex)).getFullYear();
      const row = map.get(year) || {
        year,
        billsCount: 0,
        salesMinor: 0,
        expensesMinor: 0,
        expensesCount: 0,
        netProfitMinor: 0,
        marginPct: 0,
      };
      const counted = countsInProfit(ex);
      if (counted) {
        row.expensesMinor = (row.expensesMinor || 0) + (ex.amount_minor || 0);
      }
      row.expensesCount = (row.expensesCount || 0) + 1;
      map.set(year, row);
    }

    // Finalize net profit & margin
    for (const row of map.values()) {
      const exp = row.expensesMinor || 0;
      row.netProfitMinor = row.salesMinor - exp;
      row.marginPct = row.salesMinor > 0 ? Math.round((row.netProfitMinor / row.salesMinor) * 100) : 0;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.year - a.year);
}

/** Months of a year that have sales, newest first. */
export function getSummaryMonths(bills: Bill[], year: number, expenses?: Expense[]): SummaryMonth[] {
  const map = new Map<number, SummaryMonth>();
  const withExpenses = expenses !== undefined;

  for (const b of summaryBills(bills)) {
    const d = new Date(getBillTimestamp(b));
    if (d.getFullYear() !== year) continue;
    const row = map.get(d.getMonth()) || {
      month: d.getMonth(),
      billsCount: 0,
      salesMinor: 0,
      ...(withExpenses ? { expensesMinor: 0, expensesCount: 0, netProfitMinor: 0, marginPct: 0 } : {}),
    };
    add(row, b);
    map.set(d.getMonth(), row);
  }

  if (withExpenses) {
    for (const ex of summaryExpenses(expenses)) {
      const d = new Date(getExpenseTimestamp(ex));
      if (d.getFullYear() !== year) continue;
      const row = map.get(d.getMonth()) || {
        month: d.getMonth(),
        billsCount: 0,
        salesMinor: 0,
        expensesMinor: 0,
        expensesCount: 0,
        netProfitMinor: 0,
        marginPct: 0,
      };
      if (countsInProfit(ex)) {
        row.expensesMinor = (row.expensesMinor || 0) + (ex.amount_minor || 0);
      }
      row.expensesCount = (row.expensesCount || 0) + 1;
      map.set(d.getMonth(), row);
    }

    for (const row of map.values()) {
      const exp = row.expensesMinor || 0;
      row.netProfitMinor = row.salesMinor - exp;
      row.marginPct = row.salesMinor > 0 ? Math.round((row.netProfitMinor / row.salesMinor) * 100) : 0;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.month - a.month);
}

/** Days of a month that have sales, newest first. */
export function getSummaryDays(bills: Bill[], year: number, month: number, expenses?: Expense[]): SummaryDay[] {
  const map = new Map<number, SummaryDay>();
  const withExpenses = expenses !== undefined;

  for (const b of summaryBills(bills)) {
    const ms = getBillTimestamp(b);
    const d = new Date(ms);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const row = map.get(d.getDate()) || {
      day: d.getDate(),
      dateKey: dateKeyOf(ms),
      billsCount: 0,
      salesMinor: 0,
      ...(withExpenses ? { expensesMinor: 0, expensesCount: 0, netProfitMinor: 0, marginPct: 0 } : {}),
    };
    add(row, b);
    map.set(d.getDate(), row);
  }

  if (withExpenses) {
    for (const ex of summaryExpenses(expenses)) {
      const ms = getExpenseTimestamp(ex);
      const d = new Date(ms);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const row = map.get(d.getDate()) || {
        day: d.getDate(),
        dateKey: dateKeyOf(ms),
        billsCount: 0,
        salesMinor: 0,
        expensesMinor: 0,
        expensesCount: 0,
        netProfitMinor: 0,
        marginPct: 0,
      };
      if (countsInProfit(ex)) {
        row.expensesMinor = (row.expensesMinor || 0) + (ex.amount_minor || 0);
      }
      row.expensesCount = (row.expensesCount || 0) + 1;
      map.set(d.getDate(), row);
    }

    for (const row of map.values()) {
      const exp = row.expensesMinor || 0;
      row.netProfitMinor = row.salesMinor - exp;
      row.marginPct = row.salesMinor > 0 ? Math.round((row.netProfitMinor / row.salesMinor) * 100) : 0;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.day - a.day);
}

/** Every bill of one day: customer, services and price. Latest first. */
const MODE_NAME = { upi: 'UPI', cash: 'Cash', card: 'Card' } as const;

/** The payment mode shown next to a bill. A bill paid two ways reads "Cash + UPI". */
export function paymentModeText(b: Bill): string {
  if (b.status === 'pending') return 'Pending';
  const used =
    b.payments && b.payments.length > 0
      ? b.payments.filter((p) => (p.amount_minor || 0) > 0).map((p) => modeOf(p.method || b.payment_method))
      : [modeOf(b.payment_method)];
  const text = Array.from(new Set(used.length > 0 ? used : [modeOf(b.payment_method)])).map((m) => MODE_NAME[m]).join(' + ');
  return b.status === 'partially_paid' ? text + ' (part)' : text;
}

export function getSummaryDayBills(bills: Bill[], dateKey: string): SummaryBillLine[] {
  return summaryBills(bills)
    .filter((b) => dateKeyOf(getBillTimestamp(b)) === dateKey)
    .map((b) => ({
      id: b.id,
      customerName: (b.customer_name || '').trim(),
      services: (b.items || [])
        .map((it) => {
          const name = (it.service_name_snapshot || '').trim();
          if (!name) return '';
          return (it.quantity || 1) > 1 ? `${name} ×${it.quantity}` : name;
        })
        .filter(Boolean),
      paymentMode: paymentModeText(b),
      priceMinor: b.total_minor || 0,
      time: getBillTimestamp(b),
    }))
    .sort((a, b) => b.time - a.time);
}

/** Every expense of one day. Latest first. */
export function getSummaryDayExpenses(expenses: Expense[], dateKey: string): SummaryExpenseLine[] {
  return summaryExpenses(expenses)
    .filter((ex) => dateKeyOf(getExpenseTimestamp(ex)) === dateKey)
    .map((ex) => ({
      id: ex.id,
      categoryName: (ex.category_name || 'General').trim(),
      note: (ex.note || '').trim(),
      amountMinor: ex.amount_minor || 0,
      time: getExpenseTimestamp(ex),
      countsInProfit: countsInProfit(ex),
    }))
    .sort((a, b) => b.time - a.time);
}

export interface SummaryMonthDay extends SummaryTotals {
  day: number;
  dateKey: string;
  bills: SummaryBillLine[];
  expenses?: SummaryExpenseLine[];
}

/** Money actually collected, split by how it was paid. Pending is billed but not yet received. */
export interface ReceivedBreakdown {
  upiMinor: number;
  cashMinor: number;
  cardMinor: number;
  /** UPI + cash + card: the final amount received. */
  totalMinor: number;
  pendingMinor: number;
}

const modeOf = (raw?: string | null): 'upi' | 'cash' | 'card' => {
  const r = (raw || 'UPI').trim();
  return /cash/i.test(r) ? 'cash' : /card/i.test(r) ? 'card' : 'upi';
};

/** Same rules as the Sales screen: a pending bill collected nothing, a part-paid bill only what was paid. */
export function receivedForBills(bills: Bill[]): ReceivedBreakdown {
  const out: ReceivedBreakdown = { upiMinor: 0, cashMinor: 0, cardMinor: 0, totalMinor: 0, pendingMinor: 0 };
  const put = (mode: 'upi' | 'cash' | 'card', amount: number) => {
    if (mode === 'upi') out.upiMinor += amount;
    else if (mode === 'cash') out.cashMinor += amount;
    else out.cardMinor += amount;
    out.totalMinor += amount;
  };
  for (const b of bills) {
    const total = b.total_minor || 0;
    const collected =
      b.status === 'pending'
        ? 0
        : b.status === 'partially_paid'
        ? Math.min(total, typeof b.paid_amount_minor === 'number' ? b.paid_amount_minor : total)
        : total;
    out.pendingMinor += Math.max(0, total - collected);
    if (collected <= 0) continue;
    if (b.payments && b.payments.length > 0) {
      const sum = b.payments.reduce((acc, p) => acc + (p.amount_minor || 0), 0);
      for (const p of b.payments) {
        const amount = sum > 0 && sum !== collected ? Math.round(((p.amount_minor || 0) / sum) * collected) : p.amount_minor || 0;
        if (amount > 0) put(modeOf(p.method || b.payment_method), amount);
      }
    } else {
      put(modeOf(b.payment_method), collected);
    }
  }
  return out;
}

export interface SummaryMonthDetail {
  year: number;
  month: number;
  received: ReceivedBreakdown;
  /** Chronological: day 1 first, and within a day the earliest bill first. */
  days: SummaryMonthDay[];
  expenses?: SummaryExpenseLine[];
  totals: SummaryTotals;
}

/** Everything inside one month: each day that has sales/expenses, with bills, expenses, and net profit. */
export function getSummaryMonthDetail(bills: Bill[], year: number, month: number, expenses?: Expense[]): SummaryMonthDetail {
  const withExpenses = expenses !== undefined;
  const days: SummaryMonthDay[] = getSummaryDays(bills, year, month, expenses)
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      ...d,
      bills: getSummaryDayBills(bills, d.dateKey).sort((a, b) => a.time - b.time),
      ...(withExpenses ? { expenses: getSummaryDayExpenses(expenses || [], d.dateKey).sort((a, b) => a.time - b.time) } : {}),
    }));

  const allMonthExpenses: SummaryExpenseLine[] = withExpenses
    ? summaryExpenses(expenses)
        .filter((ex) => {
          const d = new Date(getExpenseTimestamp(ex));
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .map((ex) => ({
          id: ex.id,
          categoryName: (ex.category_name || 'General').trim(),
          note: (ex.note || '').trim(),
          amountMinor: ex.amount_minor || 0,
          time: getExpenseTimestamp(ex),
          countsInProfit: countsInProfit(ex),
        }))
        .sort((a, b) => a.time - b.time)
    : [];

  const totalSalesMinor = days.reduce((s, d) => s + d.salesMinor, 0);
  const totalBillsCount = days.reduce((s, d) => s + d.billsCount, 0);

  let totals: SummaryTotals = {
    billsCount: totalBillsCount,
    salesMinor: totalSalesMinor,
  };

  if (withExpenses) {
    const countedExpensesMinor = allMonthExpenses.reduce((s, ex) => s + (ex.countsInProfit ? ex.amountMinor : 0), 0);
    const netProfitMinor = totalSalesMinor - countedExpensesMinor;
    const marginPct = totalSalesMinor > 0 ? Math.round((netProfitMinor / totalSalesMinor) * 100) : 0;

    totals = {
      billsCount: totalBillsCount,
      salesMinor: totalSalesMinor,
      expensesMinor: countedExpensesMinor,
      expensesCount: allMonthExpenses.length,
      netProfitMinor,
      marginPct,
    };
  }

  const received = receivedForBills(
    summaryBills(bills).filter((b) => {
      const d = new Date(getBillTimestamp(b));
      return d.getFullYear() === year && d.getMonth() === month;
    })
  );

  return {
    year,
    month,
    received,
    days,
    ...(withExpenses ? { expenses: allMonthExpenses } : {}),
    totals,
  };
}

export interface StylistMonthRow {
  key: string;
  name: string;
  isOwner: boolean;
  billsCount: number;
  salesMinor: number;
  /** Money paid to this team member this month (expenses tagged to them that count in profit). */
  payMinor: number;
  /** Sales they brought in minus what they were paid. */
  netMinor: number;
}

const OWNER_NAMES = ['', 'no stylist', 'unassigned', 'any', 'any stylist', 'owner', 'salon owner', 'reception'];

/**
 * Sales each stylist (and the owner) brought in during one month, and what they cost.
 * A bill with two stylists ("A & B") is split equally; bills with no stylist belong to the owner.
 */
export function getStylistMonthBreakdown(
  bills: Bill[],
  expenses: Expense[],
  staff: StaffMember[],
  ownerName: string,
  year: number,
  month: number
): StylistMonthRow[] {
  const owner = (ownerName || 'Owner').trim();
  const rows = new Map<string, StylistMonthRow>();
  const rowFor = (key: string, name: string, isOwner: boolean) => {
    let r = rows.get(key);
    if (!r) {
      r = { key, name, isOwner, billsCount: 0, salesMinor: 0, payMinor: 0, netMinor: 0 };
      rows.set(key, r);
    }
    return r;
  };
  rowFor('owner', owner, true);
  for (const st of staff) if (st && st.is_active !== false) rowFor(st.id, st.name.trim(), false);

  const inMonth = (ms: number) => {
    const d = new Date(ms);
    return d.getFullYear() === year && d.getMonth() === month;
  };

  for (const b of summaryBills(bills)) {
    if (!inMonth(getBillTimestamp(b))) continue;
    const names = (b.staff_name || '').split('&').map((n) => n.trim());
    const share = Math.round((b.total_minor || 0) / names.length);
    for (const n of names) {
      const lower = n.toLowerCase();
      const st = staff.find((x) => (names.length === 1 && b.staff_id && x.id === b.staff_id) || x.name.trim().toLowerCase() === lower);
      const row =
        st ? rowFor(st.id, st.name.trim(), false)
        : OWNER_NAMES.includes(lower) || lower === owner.toLowerCase() || !b.staff_id ? rowFor('owner', owner, true)
        : rowFor(lower, n, false);
      row.billsCount += 1;
      row.salesMinor += share;
    }
  }

  for (const ex of summaryExpenses(expenses)) {
    if (!ex.staff_id || !countsInProfit(ex) || !inMonth(getExpenseTimestamp(ex))) continue;
    const row = rows.get(ex.staff_id);
    if (row) row.payMinor += ex.amount_minor || 0;
  }

  const list = Array.from(rows.values()).filter((r) => r.billsCount > 0 || r.payMinor > 0);
  for (const r of list) r.netMinor = r.salesMinor - r.payMinor;
  return list.sort((a, b) => b.salesMinor - a.salesMinor);
}
