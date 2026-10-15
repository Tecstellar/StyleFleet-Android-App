import { SummaryMonthDetail, dateKeyOf } from './salesSummary';
import { inrFromMinor } from './format';

export interface MonthExportMeta {
  shopName: string;
  /** English month label for the file, e.g. "October 2026" */
  monthLabel: string;
  generatedOn: string;
}

const WALK_IN = 'Walk-in';

/** A cell that starts with = + - @ would run as a formula in Excel, so mark it as text. */
const csvText = (value: string): string => {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const dayText = (dateKey: string): string => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export function buildMonthCsv(detail: SummaryMonthDetail, meta: MonthExportMeta): string {
  const rows: string[] = [];
  rows.push(`"StyleFleet Sales Summary"`);
  rows.push(`"Shop Name",${csvText(meta.shopName)}`);
  rows.push(`"Month",${csvText(meta.monthLabel)}`);
  rows.push(`"Generated On",${csvText(meta.generatedOn)}`);
  rows.push('');
  rows.push(`"Date","Customer","Services","Price (INR)"`);
  for (const day of detail.days) {
    for (const b of day.bills) {
      rows.push(
        [
          csvText(dayText(day.dateKey)),
          csvText(b.customerName || WALK_IN),
          csvText(b.services.join('; ')),
          `"${(b.priceMinor / 100).toFixed(2)}"`,
        ].join(',')
      );
    }
  }

  if (detail.expenses && detail.expenses.length > 0) {
    rows.push('');
    rows.push(`"EXPENSES BREAKDOWN"`);
    rows.push(`"Date","Category","Note","Amount (INR)"`);
    for (const ex of detail.expenses) {
      const d = dateKeyOf(ex.time);
      rows.push(
        [
          csvText(dayText(d)),
          csvText(ex.categoryName || 'General'),
          csvText(ex.note || '-'),
          `"${(ex.amountMinor / 100).toFixed(2)}"`,
        ].join(',')
      );
    }
  }

  rows.push('');
  rows.push(`"Total Bills","${detail.totals.billsCount}"`);
  rows.push(`"Total Sales (INR)","${(detail.totals.salesMinor / 100).toFixed(2)}"`);
  if (detail.totals.expensesMinor !== undefined) {
    rows.push(`"Total Expenses (INR)","${(detail.totals.expensesMinor / 100).toFixed(2)}"`);
    const netProfit = detail.totals.netProfitMinor ?? (detail.totals.salesMinor - detail.totals.expensesMinor);
    rows.push(`"Net Profit (INR)","${(netProfit / 100).toFixed(2)}"`);
    rows.push(`"Profit Margin","${detail.totals.marginPct ?? 0}%"`);
  }
  return rows.join('\n');
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildMonthHtml(detail: SummaryMonthDetail, meta: MonthExportMeta): string {
  const dayBlocks = detail.days
    .map(
      (day) => `
  <div class="day">${esc(dayText(day.dateKey))}
    <span class="day-total">${day.billsCount} ${day.billsCount === 1 ? 'bill' : 'bills'} &middot; ${esc(inrFromMinor(day.salesMinor))}</span>
  </div>
  <table>
    <tbody>
      ${day.bills
        .map(
          (b) => `<tr>
        <td class="cust">${esc(b.customerName || WALK_IN)}</td>
        <td>${esc(b.services.join(', ') || 'General service')}</td>
        <td class="num">${esc(inrFromMinor(b.priceMinor))}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
    )
    .join('\n');

  const hasExpenses = detail.expenses && detail.expenses.length > 0;
  const expensesBlock = hasExpenses
    ? `
  <div class="section-title" style="margin-top: 24px; font-weight: 800; font-size: 14px; border-bottom: 2px solid #EF4444; padding-bottom: 6px;">
    Expenses Breakdown (${detail.expenses!.length} ${detail.expenses!.length === 1 ? 'entry' : 'entries'} &middot; Total ${esc(inrFromMinor(detail.totals.expensesMinor || 0))})
  </div>
  <table>
    <thead>
      <tr style="background: #F9FAFB; font-weight: 700; color: #4B5563;">
        <td>Date</td>
        <td>Category</td>
        <td>Note</td>
        <td style="text-align: right;">Amount</td>
      </tr>
    </thead>
    <tbody>
      ${detail.expenses!
        .map(
          (ex) => `<tr>
        <td style="width: 25%; font-size: 11.5px; color: #6B7280;">${esc(dayText(dateKeyOf(ex.time)))}</td>
        <td style="font-weight: 600;">${esc(ex.categoryName || 'General')}</td>
        <td style="color: #6B7280;">${esc(ex.note || '-')}</td>
        <td class="num" style="color: #EF4444;">${esc(inrFromMinor(ex.amountMinor))}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
    : '';

  const netProfit = detail.totals.netProfitMinor ?? (detail.totals.salesMinor - (detail.totals.expensesMinor || 0));
  const hasExpenseData = detail.totals.expensesMinor !== undefined;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sales & Financial Summary - ${esc(meta.monthLabel)}</title>
  <style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 28px; color: #111827; }
    .header { border-bottom: 2px solid #D4AF37; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 22px; }
    .sub { color: #6B7280; font-size: 12px; margin-top: 4px; }
    .kpi-row { display: flex; gap: 12px; margin-bottom: 18px; }
    .kpi-card { flex: 1; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px 14px; }
    .kpi-card.highlight { background: #FFFBEB; border-color: #FDE68A; }
    .kpi-label { font-size: 10.5px; font-weight: 800; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-val { font-size: 18px; font-weight: 800; margin-top: 2px; }
    .kpi-sub { font-size: 11px; color: #9CA3AF; margin-top: 1px; }
    .day { background: #F3F4F6; padding: 8px 10px; margin-top: 14px; font-weight: 700; font-size: 13px; display: flex; justify-content: space-between; }
    .day-total { font-weight: 600; color: #374151; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 7px 10px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
    td.cust { font-weight: 600; width: 28%; }
    td.num { text-align: right; font-weight: 700; white-space: nowrap; }
    .total { margin-top: 20px; border-top: 2px solid #111827; padding-top: 12px; display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; }
    .footer { margin-top: 24px; font-size: 11px; color: #9CA3AF; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(meta.shopName)}</h1>
    <div class="sub">Financial & Sales Summary &middot; ${esc(meta.monthLabel)}</div>
  </div>

  ${hasExpenseData ? `
  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-label">TOTAL SALES</div>
      <div class="kpi-val">${esc(inrFromMinor(detail.totals.salesMinor))}</div>
      <div class="kpi-sub">${detail.totals.billsCount} ${detail.totals.billsCount === 1 ? 'bill' : 'bills'}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">TOTAL EXPENSES</div>
      <div class="kpi-val" style="color: #EF4444;">${esc(inrFromMinor(detail.totals.expensesMinor || 0))}</div>
      <div class="kpi-sub">${detail.totals.expensesCount || 0} entries</div>
    </div>
    <div class="kpi-card highlight">
      <div class="kpi-label">NET PROFIT</div>
      <div class="kpi-val" style="color: ${netProfit >= 0 ? '#10B981' : '#EF4444'};">${esc(inrFromMinor(netProfit))}</div>
      <div class="kpi-sub">${detail.totals.marginPct ?? 0}% Margin</div>
    </div>
  </div>
  ` : ''}

  ${dayBlocks || '<p>No sales recorded in this month.</p>'}
  ${expensesBlock}

  <div class="total">
    <span>${detail.totals.billsCount} ${detail.totals.billsCount === 1 ? 'bill' : 'bills'}${hasExpenseData ? ` &middot; Net Profit: ${esc(inrFromMinor(netProfit))} (${detail.totals.marginPct ?? 0}%)` : ''}</span>
    <span>Total Sales: ${esc(inrFromMinor(detail.totals.salesMinor))}</span>
  </div>
  <div class="footer">Generated by StyleFleet &middot; ${esc(meta.generatedOn)}</div>
</body>
</html>`;
}
