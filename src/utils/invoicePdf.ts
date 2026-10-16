import { Bill } from '../types/domain';
import { inrFromMinor } from './format';
import { generateInvoicePrefixFromShopName } from './invoicePrefix';

export interface InvoiceHtmlParams {
  bill: Bill;
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  shopEmail?: string | null;
  shopGstin?: string | null;
  shopLogoUrl?: string | null;
  customerPhone?: string | null;
}

/**
 * Formats a date string or timestamp into '[DD MMM YYYY]' (e.g. '02 Oct 2026')
 */
function formatInvoiceDate(dateInput?: string | Date | null): string {
  try {
    const d = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const day = String(d.getDate()).padStart(2, '0');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return '02 Oct 2026';
  }
}

/**
 * Formats a 10-digit phone number into '+91 XXXXX XXXXX'
 */
function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return '+91 00000 00000';
  const clean = phone.replace(/\D/g, '').slice(-10);
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return phone.startsWith('+91') ? phone : `+91 ${phone}`;
}

export const generateInvoiceHtml = ({
  bill,
  shopName,
  shopAddress,
  shopPhone,
  shopEmail,
  shopGstin,
  shopLogoUrl,
  customerPhone,
}: InvoiceHtmlParams): string => {
  const isPartiallyPaid = bill.status === 'partially_paid';
  const isPending = bill.status === 'pending';

  let paidMinor = bill.paid_amount_minor;
  let dueMinor = bill.due_amount_minor;

  if (paidMinor === undefined || dueMinor === undefined) {
    if (bill.notes && bill.notes.includes('due:')) {
      const dueMatch = bill.notes.match(/due:(\d+)/);
      const paidMatch = bill.notes.match(/paid:(\d+)/);
      if (dueMatch) dueMinor = parseInt(dueMatch[1], 10);
      if (paidMatch) paidMinor = parseInt(paidMatch[1], 10);
    }
  }

  if (isPending) {
    paidMinor = 0;
    dueMinor = dueMinor ?? bill.total_minor;
  } else if (isPartiallyPaid) {
    dueMinor = dueMinor ?? 0;
    paidMinor = paidMinor ?? Math.max(0, bill.total_minor - dueMinor);
  } else {
    paidMinor = paidMinor ?? bill.total_minor;
    dueMinor = 0;
  }

  // Derive monogram from shop name (e.g. 'K7 Hairlines' -> 'K7', 'Cappuccino Salon' -> 'CS')
  const monogram = generateInvoicePrefixFromShopName(shopName);

  // Formatted dates
  const invoiceDateStr = formatInvoiceDate(bill.created_at || bill.issued_at);
  const appointmentDateStr = formatInvoiceDate(bill.created_at || bill.issued_at);

  // Formatted phones
  const customerPhoneFormatted = formatPhoneNumber(customerPhone);
  const shopPhoneFormatted = formatPhoneNumber(shopPhone);

  // Shop contact subtitle (Address, City, Phone, Email/GSTIN)
  const contactParts: string[] = [];
  if (shopPhone) contactParts.push(shopPhoneFormatted);
  if (shopEmail) contactParts.push(shopEmail);
  if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
  const contactLine = contactParts.length > 0 ? contactParts.join(' · ') : '+91 00000 00000';

  // Responsive items table
  const items = bill.items && bill.items.length > 0 ? bill.items : [
    {
      service_name_snapshot: 'Salon Service',
      quantity: 1,
      unit_price_minor: bill.subtotal_minor || bill.total_minor,
      discount_minor: 0,
      tax_minor: 0,
      line_total_minor: bill.subtotal_minor || bill.total_minor,
      service_id: null,
      staff_id: null,
    },
  ];

  const itemsRows = items
    .map((it) => {
      const staffName = bill.staff_name || 'Staff';
      const qty = it.quantity || 1;
      const unitPrice = inrFromMinor(it.unit_price_minor);
      const lineTotal = inrFromMinor(it.line_total_minor || (it.unit_price_minor * qty));

      return `
      <tr>
        <td class="col-service">${it.service_name_snapshot}</td>
        <td class="col-staff">${staffName}</td>
        <td class="col-qty">${qty}</td>
        <td class="col-price">${unitPrice}</td>
        <td class="col-amount">${lineTotal}</td>
      </tr>
    `;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice - ${bill.invoice_number}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    @page {
      size: A4 portrait;
      margin: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #FFFFFF;
      color: #0F172A;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .invoice-container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      background: #FFFFFF;
    }

    /* TOP HEADER BANNER (Midnight Navy) */
    .header-banner {
      background: #0B132B;
      padding: 32px 36px 24px 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .salon-logo-circle {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      border: 1.5px solid #C5A059;
      background: #0B132B;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .salon-logo-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .salon-monogram {
      color: #FFFFFF;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .salon-title {
      font-size: 24px;
      font-weight: 700;
      color: #FFFFFF;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
    }
    .salon-meta-text {
      font-size: 13.5px;
      color: #FFFFFF;
      line-height: 1.4;
      margin-bottom: 2px;
    }

    .header-right {
      text-align: right;
    }
    .invoice-main-title {
      font-size: 26px;
      font-weight: 700;
      color: #FFFFFF;
      letter-spacing: 3.5px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .header-meta-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 14px;
      margin-bottom: 4px;
      font-size: 13.5px;
    }
    .header-meta-label {
      color: #FFFFFF;
    }
    .header-meta-val {
      color: #FFFFFF;
      font-weight: 700;
      min-width: 110px;
      text-align: right;
    }

    /* GOLD ACCENT DIVIDER */
    .gold-bar {
      height: 3.5px;
      background: #C5A059;
      width: 100%;
    }

    /* BILLED TO / MOBILE / DATE SECTION */
    .meta-section {
      padding: 26px 36px 18px 36px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #F8FAFC;
    }
    .meta-col {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      color: #C5A059;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .meta-val-customer {
      font-size: 18px;
      font-weight: 700;
      color: #000000;
    }
    .meta-val {
      font-size: 15.5px;
      font-weight: 600;
      color: #000000;
    }

    /* SERVICES TABLE */
    .table-container {
      margin: 10px 36px 20px 36px;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
    }
    thead {
      background: #0B132B !important;
      background-color: #0B132B !important;
    }
    thead tr {
      background: #0B132B !important;
      background-color: #0B132B !important;
    }
    thead th {
      color: #FFFFFF !important;
      -webkit-text-fill-color: #FFFFFF !important;
      background: #0B132B !important;
      background-color: #0B132B !important;
      font-size: 12.5px !important;
      font-weight: 700 !important;
      letter-spacing: 1.5px !important;
      text-transform: uppercase !important;
      padding: 11px 8px !important;
      border: none !important;
    }
    thead th span {
      color: #FFFFFF !important;
      -webkit-text-fill-color: #FFFFFF !important;
    }
    thead th.col-service,
    thead th.col-staff,
    thead th.col-qty,
    thead th.col-price,
    thead th.col-amount {
      color: #FFFFFF !important;
      -webkit-text-fill-color: #FFFFFF !important;
      background: #0B132B !important;
      background-color: #0B132B !important;
    }
    thead th:first-child {
      border-top-left-radius: 6px;
      border-bottom-left-radius: 6px;
      padding-left: 14px !important;
    }
    thead th:last-child {
      border-top-right-radius: 6px;
      border-bottom-right-radius: 6px;
      padding-right: 14px !important;
    }
    tbody tr {
      border-bottom: 1px solid #E2E8F0;
    }
    tbody td {
      padding: 12px 8px;
      vertical-align: middle;
    }
    .col-service {
      width: 42%;
      text-align: left;
      font-size: 15px;
      padding-left: 14px;
      word-break: break-word;
      line-height: 1.45;
    }
    tbody td.col-service {
      font-weight: 600;
      color: #000000;
    }
    .col-staff {
      width: 22%;
      text-align: left;
      font-size: 14.5px;
    }
    tbody td.col-staff {
      font-weight: 500;
      color: #000000;
    }
    .col-qty {
      width: 10%;
      text-align: center;
      font-size: 14.5px;
    }
    tbody td.col-qty {
      font-weight: 600;
      color: #000000;
    }
    .col-price {
      width: 13%;
      text-align: right;
      font-size: 14.5px;
    }
    tbody td.col-price {
      font-weight: 500;
      color: #000000;
    }
    .col-amount {
      width: 13%;
      text-align: right;
      font-size: 15px;
      padding-right: 14px;
    }
    tbody td.col-amount {
      font-weight: 700;
      color: #000000;
    }

    /* PAYMENT & TOTALS BREAKDOWN */
    .summary-section {
      margin: 0 36px 24px 36px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .payment-info-box {
      display: flex;
      flex-direction: column;
    }
    .payment-badge-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 4px;
    }
    .payment-pill {
      background: #0B132B;
      color: #FFFFFF;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .payment-pill-partial {
      background: #0B132B;
      color: #FFFFFF;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .payment-method-desc {
      font-size: 14.5px;
      color: #000000;
      font-weight: 600;
    }

    .totals-box {
      width: 330px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 14.5px;
      color: #000000;
      font-weight: 500;
    }
    .totals-row-val {
      font-weight: 600;
      color: #000000;
    }
    .total-amount-box {
      background: #0B132B;
      border-radius: 6px;
      padding: 12px 18px;
      margin: 10px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #FFFFFF;
    }
    .total-amount-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #FFFFFF;
    }
    .total-amount-val {
      font-size: 22px;
      font-weight: 800;
      color: #FFFFFF;
    }
    .details-subrow {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 14.5px;
      color: #000000;
      font-weight: 500;
    }
    .details-subrow-val {
      font-weight: 700;
      color: #000000;
    }

    /* FOOTER CARD */
    .footer-card {
      margin: 12px 36px 0 36px;
      background: #FAF7F0;
      border: 1px solid #ECE4D0;
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .scissors-badge {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #0B132B;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 16px;
      flex-shrink: 0;
    }
    .footer-thankyou {
      font-size: 15px;
      font-weight: 600;
      color: #000000;
    }
    .footer-sub {
      font-size: 13px;
      color: #000000;
      margin-top: 2px;
    }

    /* BOTTOM BRANDING */
    .branding-footer {
      text-align: center;
      margin-top: 24px;
      margin-bottom: 16px;
      font-size: 10.5px;
      letter-spacing: 2px;
      color: #000000;
      text-transform: uppercase;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <!-- TOP HEADER -->
    <div class="header-banner">
      <div class="header-left">
        <div class="salon-logo-circle">
          ${
            shopLogoUrl
              ? `<img src="${shopLogoUrl}" class="salon-logo-img" alt="Logo" />`
              : `<span class="salon-monogram">${monogram}</span>`
          }
        </div>
        <div>
          <div class="salon-title">${shopName}</div>
          <div class="salon-meta-text">${shopAddress || 'Salon & Wellness Studio'}</div>
          <div class="salon-meta-text">${contactLine}</div>
        </div>
      </div>

      <div class="header-right">
        <div class="invoice-main-title">INVOICE</div>
        <div class="header-meta-row">
          <span class="header-meta-label">Invoice No.</span>
          <span class="header-meta-val">${bill.invoice_number}</span>
        </div>
        <div class="header-meta-row">
          <span class="header-meta-label">Invoice Date</span>
          <span class="header-meta-val">${invoiceDateStr}</span>
        </div>
      </div>
    </div>

    <!-- LUXURY GOLD BAR -->
    <div class="gold-bar"></div>

    <!-- BILLED TO / MOBILE / DATE -->
    <div class="meta-section">
      <div class="meta-col">
        <span class="meta-label">BILLED TO</span>
        <span class="meta-val-customer">${bill.customer_name || 'Customer Name'}</span>
      </div>
      <div class="meta-col">
        <span class="meta-label">MOBILE</span>
        <span class="meta-val">${customerPhoneFormatted}</span>
      </div>
      <div class="meta-col">
        <span class="meta-label">APPOINTMENT DATE</span>
        <span class="meta-val">${appointmentDateStr}</span>
      </div>
    </div>

    <!-- SERVICES TABLE -->
    <div class="table-container">
      <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
        <thead>
          <tr style="background-color: #0B132B !important; background: #0B132B !important;">
            <th class="col-service" style="background-color: #0B132B !important; background: #0B132B !important; color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; padding: 11px 8px 11px 14px; border-top-left-radius: 6px; border-bottom-left-radius: 6px; text-align: left;">
              <span style="color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">SERVICE</span>
            </th>
            <th class="col-staff" style="background-color: #0B132B !important; background: #0B132B !important; color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; padding: 11px 8px; text-align: left;">
              <span style="color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">STYLIST</span>
            </th>
            <th class="col-qty" style="background-color: #0B132B !important; background: #0B132B !important; color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; padding: 11px 8px; text-align: center;">
              <span style="color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">QTY</span>
            </th>
            <th class="col-price" style="background-color: #0B132B !important; background: #0B132B !important; color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; padding: 11px 8px; text-align: right;">
              <span style="color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">PRICE</span>
            </th>
            <th class="col-amount" style="background-color: #0B132B !important; background: #0B132B !important; color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; padding: 11px 14px 11px 8px; text-align: right; border-top-right-radius: 6px; border-bottom-right-radius: 6px;">
              <span style="color: #FFFFFF !important; -webkit-text-fill-color: #FFFFFF !important; font-weight: 700; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;">AMOUNT</span>
            </th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>
    </div>

    <!-- SUMMARY SECTION -->
    <div class="summary-section">
      <!-- Left: Payment Status -->
      <div class="payment-info-box">
        <span class="meta-label">PAYMENT</span>
        <div class="payment-badge-row">
          ${
            isPartiallyPaid
              ? `<span class="payment-pill-partial">[PARTIAL]</span>`
              : isPending
              ? `<span class="payment-pill">[UNPAID]</span>`
              : `<span class="payment-pill">[PAID]</span>`
          }
          <span class="payment-method-desc">via ${bill.payment_method ? bill.payment_method.toUpperCase() : 'UPI'}</span>
        </div>
      </div>

      <!-- Right: Calculations & Total Amount -->
      <div class="totals-box">
        <div class="totals-row">
          <span>Subtotal</span>
          <span class="totals-row-val">${inrFromMinor(bill.subtotal_minor)}</span>
        </div>

        ${
          bill.discount_minor > 0
            ? `
        <div class="totals-row" style="color: #B45309;">
          <span>Discount</span>
          <span class="totals-row-val" style="color: #B45309;">– ${inrFromMinor(bill.discount_minor)}</span>
        </div>`
            : `
        <div class="totals-row">
          <span>Discount</span>
          <span class="totals-row-val">– ₹0</span>
        </div>`
        }

        <div class="totals-row">
          <span>Tax (GST)</span>
          <span class="totals-row-val">${bill.tax_minor > 0 ? inrFromMinor(bill.tax_minor) : '₹0'}</span>
        </div>

        ${
          bill.tip_minor && bill.tip_minor > 0
            ? `
        <div class="totals-row" style="color: #000000;">
          <span>Tip</span>
          <span class="totals-row-val">+ ${inrFromMinor(bill.tip_minor)}</span>
        </div>`
            : ''
        }

        <div class="total-amount-box">
          <span class="total-amount-label">TOTAL AMOUNT</span>
          <span class="total-amount-val">${inrFromMinor(bill.total_minor)}</span>
        </div>

        <div class="details-subrow">
          <span>Paid Amount</span>
          <span class="details-subrow-val">${inrFromMinor(paidMinor)}</span>
        </div>

        <div class="details-subrow">
          <span>Balance Due</span>
          <span class="details-subrow-val" style="color: ${dueMinor > 0 ? '#DC2626' : '#000000'};">${inrFromMinor(dueMinor)}</span>
        </div>

        <div class="details-subrow">
          <span>Payment Method</span>
          <span class="details-subrow-val">${bill.payment_method ? bill.payment_method.toUpperCase() : 'UPI'}</span>
        </div>
      </div>
    </div>

    <!-- FOOTER THANK YOU CARD -->
    <div class="footer-card">
      <div class="scissors-badge">✂</div>
      <div>
        <div class="footer-thankyou">
          Thank you for visiting <span style="color: #C5A059; font-weight: 700;">${shopName}</span>.
        </div>
        <div class="footer-sub">We look forward to serving you again!</div>
      </div>
    </div>

    <!-- BOTTOM BRANDING -->
    <div class="branding-footer">
      POWERED BY STYLEFLEET · ${shopName.toUpperCase()}
    </div>
  </div>
</body>
</html>
`;
};
