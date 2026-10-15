import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { Bill, Expense, StaffMember, Appointment, Customer } from '../../types/domain';
import { inrFromMinor } from '../../utils/format';
import { BackIcon, PdfIcon, ExcelIcon, LockIcon } from '../../components/common/SvgIcons';
import { radii } from '../../theme/spacing';
import { SalesSummaryView } from '../../components/reports/SalesSummaryView';
import { countsInProfit, splitExpenseTotals } from '../../utils/expenseProfit';
import { stylistNameFor } from '../../utils/expenseStylist';
import { fmt } from '../../i18n/format';
import { FREE_SALES_LIMIT } from '../../utils/subscriptionUtils';

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

export const getExpenseTimestamp = (ex: Expense | null | undefined): number => {
  if (!ex) return 0;
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

export const getAppointmentTimestamp = (a: Appointment | null | undefined): number => {
  if (!a) return 0;
  if (a.starts_at) {
    const t = new Date(a.starts_at).getTime();
    if (!isNaN(t)) return t;
  }
  if (a.created_at) {
    const t = new Date(a.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
};

export const isOpeningDueBill = (b: { invoice_number?: string; notes?: string | null } | null | undefined): boolean => {
  if (!b) return false;
  if (b.invoice_number?.startsWith('DUE-')) return true;
  const n = (b.notes || '').toLowerCase();
  if (
    n.includes('opening balance') ||
    n.includes('adjusted customer due') ||
    n.includes('opening due balance') ||
    n.includes('customer opening due balance') ||
    n.includes('initial opening')
  ) {
    return true;
  }
  return false;
};


type ReportPeriod = 'Day' | 'Week' | 'Month' | 'Custom';

interface ReportsScreenProps {
  /** Open on the sales summary instead of the daily report (used by the Home revenue tile). */
  initialView?: 'report' | 'summary';
  initialPeriod?: 'Day' | 'Week' | 'Month';
  bills: Bill[];
  expenses: Expense[];
  staff: StaffMember[];
  customers?: Customer[];
  appointments?: Appointment[];
  shopId?: string;
  shopName: string;
  ownerName: string;
  shopAddress?: string;
  shopGstin?: string;
  isPro?: boolean;
  totalSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  onUpgradePlan?: () => void;
  onRefresh?: () => Promise<void>;
  onBack: () => void;
}

interface StylistPerfRow {
  id: string;
  name: string;
  isOwner: boolean;
  role: string;
  visits: number;
  salesMinor: number;
  pct: number;
}

interface ServicePerfRow {
  name: string;
  count: number;
  revenueMinor: number;
  pct: number;
}

interface DayWiseRow {
  dateKey: string;
  displayDate: string;
  billsCount: number;
  salesMinor: number;
  paidMinor: number;
  dueMinor: number;
  expensesMinor: number;
  netProfitMinor: number;
}

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  initialView = 'report',
  initialPeriod = 'Day',
  bills = [],
  expenses = [],
  staff = [],
  customers = [],
  appointments = [],
  shopId,
  shopName = 'My Salon',
  ownerName = 'Owner',
  shopAddress = '',
  shopGstin = '',
  isPro = false,
  totalSalesCount = 0,
  freeSalesLimit = FREE_SALES_LIMIT,
  onUpgradePlan,
  onRefresh,
  onBack,
}) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [reportView, setReportView] = useState<'report' | 'summary'>(initialView);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // If reports screen mounted with empty bills, automatically trigger refresh
  useEffect(() => {
    if (bills.length === 0 && onRefresh) {
      onRefresh().catch(() => {});
    }
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    try {
      setIsRefreshing(true);
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const isReportDownloadLocked = !isPro && totalSalesCount >= freeSalesLimit;

  // Custom date range state (YYYY-MM-DD)
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [generatedPdfUri, setGeneratedPdfUri] = useState<string | null>(null);

  // Calculate Start & End Date based on period
  const { startMs, endMs, dateRangeLabel } = useMemo(() => {
    const now = new Date();
    let s = new Date(now);
    let e = new Date(now);

    if (period === 'Day') {
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      const label = s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return { startMs: s.getTime(), endMs: e.getTime(), dateRangeLabel: `Today (${label})` };
    }

    if (period === 'Week') {
      // Start of current week (Sunday or Monday, standard 7 days)
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      s.setDate(now.getDate() - diffToMonday);
      s.setHours(0, 0, 0, 0);
      e.setDate(s.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      const sStr = s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const eStr = e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return { startMs: s.getTime(), endMs: e.getTime(), dateRangeLabel: `${sStr} – ${eStr}` };
    }

    if (period === 'Month') {
      s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const mStr = s.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return { startMs: s.getTime(), endMs: e.getTime(), dateRangeLabel: mStr };
    }

    // Custom
    const sParts = customStart.split('-').map(Number);
    const eParts = customEnd.split('-').map(Number);
    const cs = new Date(sParts[0] || now.getFullYear(), (sParts[1] || 1) - 1, sParts[2] || 1, 0, 0, 0, 0);
    const ce = new Date(eParts[0] || now.getFullYear(), (eParts[1] || 1) - 1, eParts[2] || 1, 23, 59, 59, 999);
    return {
      startMs: cs.getTime(),
      endMs: ce.getTime(),
      dateRangeLabel: `${customStart} to ${customEnd}`,
    };
  }, [period, customStart, customEnd]);

  // Filter Active Bills within Range (using robust ISO / timestamp parser)
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (!b || b.status === 'deleted') return false;
      const t = getBillTimestamp(b);
      return t >= startMs && t <= endMs;
    });
  }, [bills, startMs, endMs]);

  // Genuine service sales bills (excludes opening due balance entries)
  const filteredSalesBills = useMemo(() => {
    return filteredBills.filter((b) => !isOpeningDueBill(b));
  }, [filteredBills]);

  // Filter Expenses within Range
  const filteredExpenses = useMemo(() => {
    return expenses.filter((ex) => {
      if (!ex) return false;
      const t = getExpenseTimestamp(ex);
      return t >= startMs && t <= endMs;
    });
  }, [expenses, startMs, endMs]);

  // Filter Appointments within Range
  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (!a) return false;
      const t = getAppointmentTimestamp(a);
      return t >= startMs && t <= endMs;
    });
  }, [appointments, startMs, endMs]);

  // Financial Metrics
  const metrics = useMemo(() => {
    // Total Sales: ONLY genuine sales/services billed in period (never opening due balances)
    const totalSalesMinor = filteredSalesBills.reduce((acc, b) => acc + (b.total_minor || 0), 0);

    // Collected: actual cash/UPI collected across transactions in this period
    const paidAmountMinor = filteredBills.reduce((acc, b) => {
      if (b.status === 'pending') return acc;
      const billCollected = typeof b.paid_amount_minor === 'number'
        ? b.paid_amount_minor
        : (b.status === 'paid' ? (b.total_minor || 0) : 0);

      if (b.payments && b.payments.length > 0) {
        const inPeriod = b.payments.filter((p) => {
          const pt = new Date(p.paid_at).getTime();
          return isNaN(pt) || (pt >= startMs && pt <= endMs);
        });
        const pSum = inPeriod.reduce((s, p) => s + (p.amount_minor || 0), 0);
        const totalP = b.payments.reduce((s, p) => s + (p.amount_minor || 0), 0);
        if (pSum > 0) {
          const effectivePSum = totalP > 0 && totalP !== billCollected
            ? Math.round((pSum / totalP) * billCollected)
            : pSum;
          return acc + effectivePSum;
        }
      }
      return acc + billCollected;
    }, 0);

    // Period bills dues
    const periodBillsDue = filteredBills.reduce((acc, b) => {
      if (typeof b.due_amount_minor === 'number') return acc + b.due_amount_minor;
      if (b.status === 'pending') return acc + (b.total_minor || 0);
      return acc;
    }, 0);

    // Reconcile with verified active customer dues
    let totalCustomerDues: number | null = null;
    if (customers && customers.length > 0) {
      const uniqueByPhone = new Map<string, number>();
      for (const c of customers) {
        if (!c) continue;
        const clean = (c.phone || '').replace(/\D/g, '').slice(-10);
        const key = clean.length === 10 ? clean : c.id;
        const due = c.outstanding_due_minor || 0;
        if (!uniqueByPhone.has(key) || due > (uniqueByPhone.get(key) || 0)) {
          uniqueByPhone.set(key, due);
        }
      }
      totalCustomerDues = Array.from(uniqueByPhone.values()).reduce((sum, d) => sum + d, 0);
    }

    const dueAmountMinor =
      totalCustomerDues !== null && totalCustomerDues >= 0 && periodBillsDue > totalCustomerDues
        ? totalCustomerDues
        : periodBillsDue;

    const billsCount = filteredSalesBills.length;
    const uniqueCusts = new Set(
      filteredSalesBills
        .map((b) => b.customer_id || (b.customer_name ? b.customer_name.trim().toLowerCase() : ''))
        .filter(Boolean)
    ).size;

    // Profit only subtracts expenses the owner chose to count; the rest are shown separately.
    const expenseSplit = splitExpenseTotals(filteredExpenses);
    const totalExpensesMinor = expenseSplit.countedMinor;
    const excludedExpensesMinor = expenseSplit.excludedMinor;
    const expensesCount = filteredExpenses.length;
    const apptsCount = filteredAppointments.length;

    const netProfitMinor = totalSalesMinor - totalExpensesMinor;
    const marginPct = totalSalesMinor > 0 ? Math.round((netProfitMinor / totalSalesMinor) * 100) : 0;

    return {
      totalSalesMinor,
      paidAmountMinor,
      dueAmountMinor,
      billsCount,
      uniqueCusts,
      totalExpensesMinor,
      excludedExpensesMinor,
      expensesCount,
      apptsCount,
      netProfitMinor,
      marginPct,
    };
  }, [filteredBills, filteredSalesBills, filteredExpenses, filteredAppointments, customers, startMs, endMs]);

  // Payment Breakdown Summary (UPI, Cash, Card, Other, Total)
  const paymentSummary = useMemo(() => {
    let upiMinor = 0, upiCount = 0;
    let cashMinor = 0, cashCount = 0;
    let cardMinor = 0, cardCount = 0;
    let otherMinor = 0, otherCount = 0;

    for (const b of filteredBills) {
      if (!b || b.status === 'deleted') continue;
      const payments = b.payments || [];
      if (payments.length > 0) {
        for (const p of payments) {
          const m = (p.method || '').toLowerCase();
          const amt = p.amount_minor || 0;
          if (m.includes('upi')) {
            upiMinor += amt;
            upiCount++;
          } else if (m.includes('cash')) {
            cashMinor += amt;
            cashCount++;
          } else if (m.includes('card')) {
            cardMinor += amt;
            cardCount++;
          } else {
            otherMinor += amt;
            otherCount++;
          }
        }
      } else {
        const amt = b.paid_amount_minor !== undefined ? b.paid_amount_minor : (b.status === 'paid' ? b.total_minor : 0);
        if (amt > 0) {
          const m = (b.payment_method || '').toLowerCase();
          if (m.includes('upi')) {
            upiMinor += amt;
            upiCount++;
          } else if (m.includes('cash')) {
            cashMinor += amt;
            cashCount++;
          } else if (m.includes('card')) {
            cardMinor += amt;
            cardCount++;
          } else {
            otherMinor += amt;
            otherCount++;
          }
        }
      }
    }

    const totalCollectedMinor = upiMinor + cashMinor + cardMinor + otherMinor;
    const totalTxns = upiCount + cashCount + cardCount + otherCount;

    return {
      upi: { amountMinor: upiMinor, count: upiCount },
      cash: { amountMinor: cashMinor, count: cashCount },
      card: { amountMinor: cardMinor, count: cardCount },
      other: { amountMinor: otherMinor, count: otherCount },
      total: { amountMinor: totalCollectedMinor, count: totalTxns },
    };
  }, [filteredBills]);

  // Stylist Performance Breakdown (Rule: No Stylist Selected -> Owner as default)
  const stylistPerformance: StylistPerfRow[] = useMemo(() => {
    const map = new Map<string, StylistPerfRow>();

    // Owner entry
    const effectiveOwnerName = (ownerName || 'Owner').trim();
    map.set('owner', {
      id: 'owner',
      name: effectiveOwnerName,
      isOwner: true,
      role: 'Salon Owner',
      visits: 0,
      salesMinor: 0,
      pct: 0,
    });

    // Registered staff entries
    for (const s of staff) {
      if (!s) continue;
      const key = s.name.trim().toLowerCase();
      map.set(key, {
        id: s.id,
        name: s.name.trim(),
        isOwner: false,
        role: s.role || 'Stylist',
        visits: 0,
        salesMinor: 0,
        pct: 0,
      });
    }

    // Attribute each bill (only genuine sales, never opening dues)
    for (const b of filteredSalesBills) {
      const rawName = (b.staff_name || '').trim();
      // Check if matches dual stylists (e.g. "Ravi & Priya")
      if (rawName.includes('&')) {
        const parts = rawName.split('&').map((p) => p.trim());
        const splitMinor = Math.round((b.total_minor || 0) / parts.length);
        for (const p of parts) {
          const pLower = p.toLowerCase();
          const matched = staff.find((st) => st.name.trim().toLowerCase() === pLower);
          const key = matched ? matched.name.trim().toLowerCase() : pLower;
          let existing = map.get(key);
          if (!existing) {
            existing = {
              id: matched?.id || key,
              name: matched?.name || p,
              isOwner: false,
              role: 'Stylist',
              visits: 0,
              salesMinor: 0,
              pct: 0,
            };
            map.set(key, existing);
          }
          existing.visits += 1;
          existing.salesMinor += splitMinor;
        }
        continue;
      }

      const lower = rawName.toLowerCase();

      // Check if matches registered staff
      const matchedStaff = staff.find(
        (st) => (b.staff_id && st.id === b.staff_id) || (lower && st.name.trim().toLowerCase() === lower)
      );

      if (matchedStaff) {
        const key = matchedStaff.name.trim().toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.visits += 1;
          existing.salesMinor += b.total_minor || 0;
        }
      } else {
        // Check if unassigned / owner
        const isOwnerAttr =
          !rawName ||
          !b.staff_id ||
          lower === 'no stylist' ||
          lower === 'unassigned' ||
          lower === 'any' ||
          lower === 'any stylist' ||
          lower === 'owner' ||
          lower === 'salon owner' ||
          lower === 'reception' ||
          lower === effectiveOwnerName.toLowerCase();

        if (isOwnerAttr) {
          const ownerRow = map.get('owner')!;
          ownerRow.visits += 1;
          ownerRow.salesMinor += b.total_minor || 0;
        } else {
          let existing = map.get(lower);
          if (!existing) {
            existing = {
              id: b.staff_id || lower,
              name: rawName,
              isOwner: false,
              role: 'Stylist',
              visits: 0,
              salesMinor: 0,
              pct: 0,
            };
            map.set(lower, existing);
          }
          existing.visits += 1;
          existing.salesMinor += b.total_minor || 0;
        }
      }
    }

    // Compute percentage contribution
    const rows = Array.from(map.values());
    for (const r of rows) {
      r.pct = metrics.totalSalesMinor > 0 ? Math.round((r.salesMinor / metrics.totalSalesMinor) * 100) : 0;
    }

    // Sort by sales descending, with Owner first if tied
    return rows.sort((a, b) => b.salesMinor - a.salesMinor);
  }, [filteredSalesBills, staff, ownerName, metrics.totalSalesMinor]);

  // Service-Based Performance Breakdown
  const servicePerformance: ServicePerfRow[] = useMemo(() => {
    const map = new Map<string, { count: number; revenueMinor: number }>();
    let totalRev = 0;

    for (const b of filteredSalesBills) {
      if (b.items && b.items.length > 0) {
        for (const it of b.items) {
          const name = (it.service_name_snapshot || 'General Service').trim();
          const qty = it.quantity || 1;
          const lineTotal = it.line_total_minor ?? ((it.unit_price_minor || 0) * qty);
          const cur = map.get(name) || { count: 0, revenueMinor: 0 };
          cur.count += qty;
          cur.revenueMinor += lineTotal;
          map.set(name, cur);
          totalRev += lineTotal;
        }
      } else if (b.total_minor) {
        const name = 'General Service';
        const cur = map.get(name) || { count: 0, revenueMinor: 0 };
        cur.count += 1;
        cur.revenueMinor += b.total_minor;
        map.set(name, cur);
        totalRev += b.total_minor;
      }
    }

    const rows: ServicePerfRow[] = Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      revenueMinor: data.revenueMinor,
      pct: totalRev > 0 ? Math.round((data.revenueMinor / totalRev) * 100) : 0,
    }));

    return rows.sort((a, b) => b.revenueMinor - a.revenueMinor);
  }, [filteredSalesBills]);

  // Day-Wise Financial & Sales Breakdown
  const dayWiseBreakdown: DayWiseRow[] = useMemo(() => {
    const map = new Map<string, DayWiseRow>();

    const getLocalDateKey = (isoOrMs: string | number): { dateKey: string; displayDate: string } => {
      const d = new Date(isoOrMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${day}`;
      const displayDate = d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return { dateKey, displayDate };
    };

    for (const b of filteredBills) {
      const t = getBillTimestamp(b);
      if (!t) continue;
      const { dateKey, displayDate } = getLocalDateKey(t);

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          dateKey,
          displayDate,
          billsCount: 0,
          salesMinor: 0,
          paidMinor: 0,
          dueMinor: 0,
          expensesMinor: 0,
          netProfitMinor: 0,
        });
      }

      const row = map.get(dateKey)!;
      const isDueBill = isOpeningDueBill(b);
      if (!isDueBill) {
        row.billsCount += 1;
        row.salesMinor += b.total_minor || 0;
      }
      const paid =
        typeof b.paid_amount_minor === 'number'
          ? b.paid_amount_minor
          : b.status === 'paid'
          ? b.total_minor || 0
          : 0;
      const due =
        typeof b.due_amount_minor === 'number'
          ? b.due_amount_minor
          : b.status === 'pending'
          ? b.total_minor || 0
          : 0;
      row.paidMinor += paid;
      row.dueMinor += due;
    }

    for (const ex of filteredExpenses) {
      if (!countsInProfit(ex)) continue;
      const t = getExpenseTimestamp(ex);
      if (!t) continue;
      const { dateKey, displayDate } = getLocalDateKey(t);

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          dateKey,
          displayDate,
          billsCount: 0,
          salesMinor: 0,
          paidMinor: 0,
          dueMinor: 0,
          expensesMinor: 0,
          netProfitMinor: 0,
        });
      }

      const row = map.get(dateKey)!;
      row.expensesMinor += ex.amount_minor || 0;
    }

    // Compute net profit for each day
    const rows = Array.from(map.values());
    for (const r of rows) {
      r.netProfitMinor = r.salesMinor - r.expensesMinor;
    }

    // Sort descending by date (most recent day first)
    return rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [filteredBills, filteredExpenses]);

  // Export to PDF
  const handleExportPdf = async () => {
    if (isReportDownloadLocked) {
      Alert.alert(
        'Upgrade to Pro',
        'Upgrade to Pro to download reports.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Upgrade Now',
            onPress: () => onUpgradePlan && onUpgradePlan(),
          },
        ]
      );
      return;
    }

    try {
      setIsExportingPdf(true);

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Business Report - ${shopName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 30px;
      color: #111827;
      background: #FFFFFF;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #D4AF37;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .salon-name {
      font-size: 26px;
      font-weight: 800;
      color: #111827;
      margin: 0;
    }
    .salon-sub {
      font-size: 13px;
      color: #6B7280;
      margin-top: 4px;
    }
    .report-title-badge {
      display: inline-block;
      background: #FEF3C7;
      color: #92400E;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 4px;
      margin-top: 8px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }
    .kpi-card {
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 12px 14px;
      background: #F9FAFB;
    }
    .kpi-label {
      font-size: 11px;
      text-transform: uppercase;
      color: #6B7280;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .kpi-val {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-top: 4px;
    }
    .kpi-highlight {
      color: #D4AF37;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 12px;
      padding-bottom: 4px;
      border-bottom: 1px solid #E5E7EB;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 12px;
    }
    th {
      background: #F3F4F6;
      color: #374151;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
      border-bottom: 1px solid #D1D5DB;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #E5E7EB;
      color: #1F2937;
    }
    .text-right {
      text-align: right;
    }
    .footer {
      margin-top: 30px;
      font-size: 11px;
      color: #9CA3AF;
      text-align: center;
      border-top: 1px solid #E5E7EB;
      padding-top: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="salon-name">${shopName}</h1>
    <div class="salon-sub">${shopAddress || 'Salon & Spa Management'} ${shopGstin ? `· GSTIN: ${shopGstin}` : ''}</div>
    <div class="report-title-badge">PERIOD: ${dateRangeLabel.toUpperCase()}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Sales</div>
      <div class="kpi-val kpi-highlight">${inrFromMinor(metrics.totalSalesMinor)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Paid / Collected</div>
      <div class="kpi-val">${inrFromMinor(metrics.paidAmountMinor)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Outstanding Dues</div>
      <div class="kpi-val" style="color: ${metrics.dueAmountMinor > 0 ? '#DC2626' : '#111827'}">${inrFromMinor(metrics.dueAmountMinor)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Net Profit (${metrics.marginPct}%)</div>
      <div class="kpi-val" style="color: ${metrics.netProfitMinor >= 0 ? '#16A34A' : '#DC2626'}">${inrFromMinor(metrics.netProfitMinor)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total Expenses</div>
      <div class="kpi-val">${inrFromMinor(metrics.totalExpensesMinor)}</div>
    </div>
    ${
      metrics.excludedExpensesMinor > 0
        ? `<div class="kpi-card">
      <div class="kpi-label">Not Counted in Profit</div>
      <div class="kpi-val">${inrFromMinor(metrics.excludedExpensesMinor)}</div>
    </div>`
        : ''
    }
    <div class="kpi-card">
      <div class="kpi-label">Total Bills</div>
      <div class="kpi-val">${metrics.billsCount}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Clients Served</div>
      <div class="kpi-val">${metrics.uniqueCusts}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Appointments</div>
      <div class="kpi-val">${metrics.apptsCount}</div>
    </div>
  </div>

  <div class="section-title">Payment Summary</div>
  <table>
    <thead>
      <tr>
        <th>Payment Method</th>
        <th class="text-right">Transactions</th>
        <th class="text-right">Total Collected</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>UPI</td>
        <td class="text-right">${paymentSummary.upi.count}</td>
        <td class="text-right"><strong>${inrFromMinor(paymentSummary.upi.amountMinor)}</strong></td>
      </tr>
      <tr>
        <td>Cash</td>
        <td class="text-right">${paymentSummary.cash.count}</td>
        <td class="text-right"><strong>${inrFromMinor(paymentSummary.cash.amountMinor)}</strong></td>
      </tr>
      <tr>
        <td>Card</td>
        <td class="text-right">${paymentSummary.card.count}</td>
        <td class="text-right"><strong>${inrFromMinor(paymentSummary.card.amountMinor)}</strong></td>
      </tr>
      ${paymentSummary.other.amountMinor > 0 ? `
      <tr>
        <td>Other</td>
        <td class="text-right">${paymentSummary.other.count}</td>
        <td class="text-right"><strong>${inrFromMinor(paymentSummary.other.amountMinor)}</strong></td>
      </tr>` : ''}
      <tr style="background: #F9FAFB; font-weight: bold;">
        <td>TOTAL</td>
        <td class="text-right">${paymentSummary.total.count}</td>
        <td class="text-right"><strong>${inrFromMinor(paymentSummary.total.amountMinor)}</strong></td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">Day-Wise Sales & Financial Performance</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th class="text-right">Bills</th>
        <th class="text-right">Sales Revenue</th>
        <th class="text-right">Collected</th>
        <th class="text-right">Dues</th>
        <th class="text-right">Expenses</th>
        <th class="text-right">Net Profit</th>
      </tr>
    </thead>
    <tbody>
      ${
        dayWiseBreakdown.length === 0
          ? `<tr><td colspan="7" style="text-align: center; color: #9CA3AF; padding: 12px;">No transactions recorded in this period.</td></tr>`
          : dayWiseBreakdown
              .map(
                (d) => `
        <tr>
          <td><strong>${d.displayDate}</strong></td>
          <td class="text-right">${d.billsCount}</td>
          <td class="text-right"><strong>${inrFromMinor(d.salesMinor)}</strong></td>
          <td class="text-right" style="color: #16A34A;">${inrFromMinor(d.paidMinor)}</td>
          <td class="text-right" style="color: ${d.dueMinor > 0 ? '#DC2626' : '#111827'};">${inrFromMinor(d.dueMinor)}</td>
          <td class="text-right" style="color: ${d.expensesMinor > 0 ? '#DC2626' : '#111827'};">${inrFromMinor(d.expensesMinor)}</td>
          <td class="text-right" style="color: ${d.netProfitMinor >= 0 ? '#16A34A' : '#DC2626'};"><strong>${inrFromMinor(d.netProfitMinor)}</strong></td>
        </tr>
      `
              )
              .join('')
      }
    </tbody>
  </table>

  <div class="section-title">Stylist Performance Breakdown</div>
  <table>
    <thead>
      <tr>
        <th>Stylist / Member</th>
        <th>Role</th>
        <th class="text-right">Visits</th>
        <th class="text-right">Total Sales</th>
        <th class="text-right">% Share</th>
      </tr>
    </thead>
    <tbody>
      ${stylistPerformance
        .map(
          (s) => `
        <tr>
          <td><strong>${s.name}</strong> ${s.isOwner ? '<span style="font-size:10px; color:#D4AF37;">(Owner)</span>' : ''}</td>
          <td>${s.role}</td>
          <td class="text-right">${s.visits}</td>
          <td class="text-right"><strong>${inrFromMinor(s.salesMinor)}</strong></td>
          <td class="text-right">${s.pct}%</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <div class="section-title">Service-Based Performance Breakdown</div>
  <table>
    <thead>
      <tr>
        <th>Service Name</th>
        <th class="text-right">Count / Qty</th>
        <th class="text-right">Total Revenue</th>
        <th class="text-right">% Share</th>
      </tr>
    </thead>
    <tbody>
      ${
        servicePerformance.length === 0
          ? `<tr><td colspan="4" style="text-align: center; color: #9CA3AF; padding: 12px;">No service activity recorded in this period.</td></tr>`
          : servicePerformance
              .map(
                (s) => `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td class="text-right">${s.count}</td>
          <td class="text-right"><strong>${inrFromMinor(s.revenueMinor)}</strong></td>
          <td class="text-right">${s.pct}%</td>
        </tr>
      `
              )
              .join('')
      }
    </tbody>
  </table>

  <div class="section-title">Recent Bills in Period (Total: ${filteredBills.length})</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Invoice #</th>
        <th>Customer</th>
        <th>Stylist</th>
        <th class="text-right">Amount</th>
        <th class="text-right">Status</th>
      </tr>
    </thead>
    <tbody>
      ${filteredBills
        .slice(0, 50)
        .map(
          (b) => `
        <tr>
          <td>${getBillTimestamp(b) ? new Date(getBillTimestamp(b)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'N/A'}</td>
          <td>${b.invoice_number}</td>
          <td>${b.customer_name}</td>
          <td>${b.staff_name || ownerName || 'Owner'}</td>
          <td class="text-right"><strong>${inrFromMinor(b.total_minor)}</strong></td>
          <td class="text-right">${b.status.toUpperCase()}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <div class="footer">
    Generated automatically by StyleFleet Salon OS · ${new Date().toLocaleString('en-IN')}
  </div>
</body>
</html>
      `;

      const { uri, base64 } = await Print.printToFileAsync({ html, base64: true });
      const cleanShop = shopName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Report_${cleanShop}_${period}_${Date.now()}.pdf`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      if (base64) {
        await FileSystem.writeAsStringAsync(targetUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.copyAsync({ from: uri, to: targetUri });
      }

      setGeneratedPdfUri(targetUri);
      setShowPdfPreviewModal(true);
    } catch (err: any) {
      console.warn('PDF Generate Error:', err);
      Alert.alert('Generate Error', err.message || 'Could not generate PDF report.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleSharePdf = async () => {
    if (!generatedPdfUri) return;
    try {
      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (available) {
        await Sharing.shareAsync(generatedPdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share Report PDF - ${shopName}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
      }
    } catch (err: any) {
      Alert.alert('Share Error', err.message || 'Could not share PDF report.');
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedPdfUri) return;
    try {
      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (available) {
        await Sharing.shareAsync(generatedPdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Download Report PDF - ${shopName}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Downloaded', `Report PDF generated and saved to cache:\n${generatedPdfUri}`);
      }
    } catch (err: any) {
      Alert.alert('Download Error', err.message || 'Could not download PDF report.');
    }
  };

  // Export to Excel / CSV
  const handleExportCsv = async () => {
    if (isReportDownloadLocked) {
      Alert.alert(
        'Upgrade to Pro',
        'Upgrade to Pro to download reports.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Upgrade Now',
            onPress: () => onUpgradePlan && onUpgradePlan(),
          },
        ]
      );
      return;
    }

    try {
      setIsExportingCsv(true);

      const rows: string[] = [];

      // Header block
      rows.push(`"StyleFleet Business Report"`);
      rows.push(`"Shop Name","${shopName.replace(/"/g, '""')}"`);
      rows.push(`"Period","${dateRangeLabel.replace(/"/g, '""')}"`);
      rows.push(`"Generated On","${new Date().toLocaleString('en-IN').replace(/"/g, '""')}"`);
      rows.push(``);

      // Financial KPI
      rows.push(`"FINANCIAL SUMMARY"`);
      rows.push(`"Metric","Amount (INR)"`);
      rows.push(`"Total Sales Revenue","${(metrics.totalSalesMinor / 100).toFixed(2)}"`);
      rows.push(`"Total Paid / Collected","${(metrics.paidAmountMinor / 100).toFixed(2)}"`);
      rows.push(`"Outstanding Dues","${(metrics.dueAmountMinor / 100).toFixed(2)}"`);
      rows.push(`"Total Expenses (counted in profit)","${(metrics.totalExpensesMinor / 100).toFixed(2)}"`);
      rows.push(`"Expenses Not Counted in Profit","${(metrics.excludedExpensesMinor / 100).toFixed(2)}"`);
      rows.push(`"Net Profit","${(metrics.netProfitMinor / 100).toFixed(2)}"`);
      rows.push(`"Profit Margin","${metrics.marginPct}%"`);
      rows.push(`"Total Bills Count","${metrics.billsCount}"`);
      rows.push(`"Unique Customers Served","${metrics.uniqueCusts}"`);
      rows.push(`"Appointments Scheduled","${metrics.apptsCount}"`);
      rows.push(``);

      // Payment Summary
      rows.push(`"PAYMENT SUMMARY"`);
      rows.push(`"Payment Method","Transactions","Total Collected (INR)"`);
      rows.push(`"UPI","${paymentSummary.upi.count}","${(paymentSummary.upi.amountMinor / 100).toFixed(2)}"`);
      rows.push(`"Cash","${paymentSummary.cash.count}","${(paymentSummary.cash.amountMinor / 100).toFixed(2)}"`);
      rows.push(`"Card","${paymentSummary.card.count}","${(paymentSummary.card.amountMinor / 100).toFixed(2)}"`);
      if (paymentSummary.other.amountMinor > 0) {
        rows.push(`"Other","${paymentSummary.other.count}","${(paymentSummary.other.amountMinor / 100).toFixed(2)}"`);
      }
      rows.push(`"Total","${paymentSummary.total.count}","${(paymentSummary.total.amountMinor / 100).toFixed(2)}"`);
      rows.push(``);

      // Day-Wise Breakdown
      rows.push(`"DAY-WISE SALES & FINANCIAL BREAKDOWN"`);
      rows.push(
        `"Date","Bills Count","Sales Revenue (INR)","Collected (INR)","Outstanding Dues (INR)","Expenses (INR)","Net Profit (INR)"`
      );
      for (const d of dayWiseBreakdown) {
        rows.push(
          `"${d.displayDate.replace(/"/g, '""')}","${d.billsCount}","${(d.salesMinor / 100).toFixed(2)}","${(d.paidMinor / 100).toFixed(2)}","${(d.dueMinor / 100).toFixed(2)}","${(d.expensesMinor / 100).toFixed(2)}","${(d.netProfitMinor / 100).toFixed(2)}"`
        );
      }
      rows.push(``);

      // Stylist Performance
      rows.push(`"STYLIST PERFORMANCE BREAKDOWN"`);
      rows.push(`"Stylist Name","Role","Visits / Services","Total Sales (INR)","Share (%)"`);
      for (const s of stylistPerformance) {
        rows.push(
          `"${s.name.replace(/"/g, '""')}","${s.role}","${s.visits}","${(s.salesMinor / 100).toFixed(2)}","${s.pct}%"`
        );
      }
      rows.push(``);

      // Service Performance
      rows.push(`"SERVICE PERFORMANCE BREAKDOWN"`);
      rows.push(`"Service Name","Count / Quantity","Total Revenue (INR)","Share (%)"`);
      for (const s of servicePerformance) {
        rows.push(
          `"${s.name.replace(/"/g, '""')}","${s.count}","${(s.revenueMinor / 100).toFixed(2)}","${s.pct}%"`
        );
      }
      rows.push(``);

      // Bills Table
      rows.push(`"BILLS DETAIL"`);
      rows.push(`"Date","Invoice #","Customer Name","Stylist Name","Total (INR)","Status"`);
      for (const b of filteredBills) {
        const d = getBillTimestamp(b) ? new Date(getBillTimestamp(b)).toLocaleDateString('en-IN') : 'N/A';
        const stName = b.staff_name || ownerName || 'Owner';
        rows.push(
          `"${d}","${b.invoice_number}","${b.customer_name.replace(/"/g, '""')}","${stName.replace(/"/g, '""')}","${(b.total_minor / 100).toFixed(2)}","${b.status}"`
        );
      }
      rows.push(``);

      // Expenses Table
      rows.push(`"EXPENSES DETAIL"`);
      rows.push(`"Date","Category","Description","Stylist","Amount (INR)","Counted in Profit"`);
      for (const ex of filteredExpenses) {
        const d = getExpenseTimestamp(ex) ? new Date(getExpenseTimestamp(ex)).toLocaleDateString('en-IN') : 'N/A';
        const catName = ex.category_name || (ex as any).category || 'Expense';
        const note = ex.note || (ex as any).description || '';
        rows.push(
          `"${d}","${catName.replace(/"/g, '""')}","${note.replace(/"/g, '""')}","${(stylistNameFor(staff, ex.staff_id) || '').replace(/"/g, '""')}","${(ex.amount_minor / 100).toFixed(2)}","${countsInProfit(ex) ? 'Yes' : 'No'}"`
        );
      }

      const csvContent = rows.join('\n');
      const cleanShop = shopName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Report_${cleanShop}_${period}_${Date.now()}.csv`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(targetUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (available) {
        await Sharing.shareAsync(targetUri, {
          mimeType: 'text/csv',
          dialogTitle: `Share Report Excel/CSV - ${shopName}`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.warn('CSV Export Error:', err);
      Alert.alert('Export Error', err.message || 'Could not export Excel/CSV report.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <BackIcon size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleCol}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('businessReports', 'Business Reports')}</Text>
          <Text style={[styles.headerSub, { color: colors.textDim }]}>{shopName} · {dateRangeLabel}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          ) : undefined
        }
      >
        {/* Report | Summary switch */}
        <View style={[styles.viewSwitch, getGlass(colors.isDark).inset, { borderWidth: 1 }]}>
          {(['report', 'summary'] as const).map((v) => {
            const active = reportView === v;
            return (
              <TouchableOpacity
                key={v}
                activeOpacity={0.85}
                onPress={() => setReportView(v)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.viewSwitchBtn, active && { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: active ? '#0D0E11' : colors.textDim, fontWeight: '800', fontSize: 13 }}>
                  {v === 'report' ? t('smTabReport', 'Report') : t('smTabSummary', 'Summary')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {reportView === 'summary' ? (
          <SalesSummaryView
            bills={bills}
            expenses={expenses}
            shopName={shopName}
            isDownloadLocked={isReportDownloadLocked}
            onUpgradePlan={onUpgradePlan}
          />
        ) : (
          <>
        {/* Period Selector Tabs */}
        <View style={[styles.periodTabsRow, { borderColor: colors.divider }]}>
          {(['Day', 'Week', 'Month', 'Custom'] as const).map((p) => {
            const isSelected = period === p;
            return (
              <TouchableOpacity
                key={p}
                activeOpacity={0.8}
                onPress={() => {
                  setPeriod(p);
                  if (p === 'Custom') setShowCustomModal(true);
                }}
                style={[
                  styles.periodTab,
                  {
                    backgroundColor: isSelected ? colors.surface : 'transparent',
                    borderRightWidth: p !== 'Custom' ? 1 : 0,
                    borderRightColor: colors.divider,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.periodTabText,
                    {
                      color: isSelected ? colors.accent : colors.textDim,
                      fontWeight: isSelected ? '700' : '500',
                    },
                  ]}
                >
                  {p === 'Day' ? t('today', 'Today') : p === 'Week' ? t('week', 'Week') : p === 'Month' ? t('month', 'Month') : t('custom', 'Custom')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Export Buttons Bar */}
        <View style={styles.exportBar}>
          <TouchableOpacity
            style={[styles.exportBtn, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}
            activeOpacity={0.8}
            onPress={handleExportPdf}
            disabled={isExportingPdf || isExportingCsv}
          >
            {isExportingPdf ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                {isReportDownloadLocked ? (
                  <LockIcon size={16} color={colors.accent} />
                ) : (
                  <PdfIcon size={18} color="#EF4444" />
                )}
                <Text style={[styles.exportBtnText, { color: colors.text }]}>{t('generatePdf', 'Generate PDF')}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.exportBtn, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}
            activeOpacity={0.8}
            onPress={handleExportCsv}
            disabled={isExportingPdf || isExportingCsv}
          >
            {isExportingCsv ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                {isReportDownloadLocked ? (
                  <LockIcon size={16} color={colors.accent} />
                ) : (
                  <ExcelIcon size={18} color="#10B981" />
                )}
                <Text style={[styles.exportBtnText, { color: colors.text }]}>{t('exportExcel', 'Export Excel')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Net Profit Big Banner */}
        <View style={[styles.netProfitCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kpiLabel, { color: colors.textDim }]}>{t('netProfit', 'NET PROFIT')}</Text>
            <Text
              style={[
                styles.netProfitAmt,
                { color: metrics.netProfitMinor >= 0 ? colors.accent : colors.error },
              ]}
            >
              {inrFromMinor(metrics.netProfitMinor)}
            </Text>
          </View>
          <View style={[styles.marginBadge, { backgroundColor: 'rgba(217, 164, 65, 0.15)' }]}>
            <Text style={[styles.marginText, { color: colors.accent }]}>
              {metrics.marginPct}% {t('margin', 'Margin')}
            </Text>
          </View>
        </View>

        {/* 2x2 Metric Grid */}
        <View style={styles.metricGrid}>
          <View style={[styles.metricCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.metricLabel, { color: colors.textDim }]}>{t('totalSales', 'Total Sales')}</Text>
            <Text style={[styles.metricValue, { color: colors.text }]}>{inrFromMinor(metrics.totalSalesMinor)}</Text>
            <Text style={[styles.metricSub, { color: colors.textMuted }]}>{metrics.billsCount} bills</Text>
          </View>

          <View style={[styles.metricCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.metricLabel, { color: colors.textDim }]}>{t('collected', 'Collected')}</Text>
            <Text style={[styles.metricValue, { color: '#22C55E' }]}>{inrFromMinor(metrics.paidAmountMinor)}</Text>
            <Text style={[styles.metricSub, { color: colors.textMuted }]}>{metrics.uniqueCusts} clients</Text>
          </View>

          <View style={[styles.metricCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.metricLabel, { color: colors.textDim }]}>{t('outstandingDues', 'Outstanding Dues')}</Text>
            <Text style={[styles.metricValue, { color: metrics.dueAmountMinor > 0 ? colors.error : colors.text }]}>
              {inrFromMinor(metrics.dueAmountMinor)}
            </Text>
            <Text style={[styles.metricSub, { color: colors.textMuted }]}>Pending collection</Text>
          </View>

          <View style={[styles.metricCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.metricLabel, { color: colors.textDim }]}>{t('expenses', 'Expenses')}</Text>
            <Text style={[styles.metricValue, { color: colors.error }]}>{inrFromMinor(metrics.totalExpensesMinor)}</Text>
            <Text style={[styles.metricSub, { color: colors.textMuted }]}>
              {metrics.expensesCount} entries
              {metrics.excludedExpensesMinor > 0
                ? ` · ${fmt(t('exNotCounted', '{amt} not counted in profit'), { amt: inrFromMinor(metrics.excludedExpensesMinor) })}`
                : ''}
            </Text>
          </View>
        </View>

        {/* Payment Summary Breakdown Card */}
        <View style={[styles.card, { ...getGlass(colors.isDark).card, borderWidth: 1, marginBottom: 16 }]}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Payment Summary</Text>
              <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>
                {paymentSummary.total.count} transactions recorded
              </Text>
            </View>
          </View>

          <View style={{ gap: 10, marginTop: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>UPI ({paymentSummary.upi.count})</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{inrFromMinor(paymentSummary.upi.amountMinor)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>Cash ({paymentSummary.cash.count})</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{inrFromMinor(paymentSummary.cash.amountMinor)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>Card ({paymentSummary.card.count})</Text>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{inrFromMinor(paymentSummary.card.amountMinor)}</Text>
            </View>
            {paymentSummary.other.amountMinor > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.textDim, fontSize: 13 }}>Other ({paymentSummary.other.count})</Text>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{inrFromMinor(paymentSummary.other.amountMinor)}</Text>
              </View>
            )}
            <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '700' }}>Total Collected</Text>
              <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>{inrFromMinor(paymentSummary.total.amountMinor)}</Text>
            </View>
          </View>
        </View>

        {/* Day-Wise Sales & Financial Breakdown Card */}
        <View style={[styles.card, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {t('dayWiseBreakdown', 'Day-Wise Breakdown')}
              </Text>
              <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>
                {dayWiseBreakdown.length} {dayWiseBreakdown.length === 1 ? 'day recorded' : 'days recorded'} · Daily sales & profit
              </Text>
            </View>
          </View>

          {dayWiseBreakdown.length === 0 ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>No daily transactions in this period</Text>
            </View>
          ) : (
            dayWiseBreakdown.map((item, idx) => (
              <View
                key={item.dateKey}
                style={[
                  styles.dayRow,
                  { borderBottomColor: idx < dayWiseBreakdown.length - 1 ? colors.divider : 'transparent' },
                ]}
              >
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={[styles.dayDateText, { color: colors.text }]}>{item.displayDate}</Text>
                  <Text style={[styles.daySubText, { color: colors.textDim }]}>
                    {item.billsCount} {item.billsCount === 1 ? 'bill' : 'bills'}
                    {item.expensesMinor > 0 ? ` · Exp: ${inrFromMinor(item.expensesMinor)}` : ''}
                    {item.dueMinor > 0 ? ` · Due: ${inrFromMinor(item.dueMinor)}` : ''}
                  </Text>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.daySalesText, { color: colors.text }]}>{inrFromMinor(item.salesMinor)}</Text>
                  <Text
                    style={[
                      styles.dayProfitText,
                      { color: item.netProfitMinor >= 0 ? '#16A34A' : colors.error },
                    ]}
                  >
                    Net {inrFromMinor(item.netProfitMinor)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Stylist Performance Card */}
        <View style={[styles.card, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {t('stylistPerformance', 'Stylist Performance')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>
              {stylistPerformance.length} members
            </Text>
          </View>

          {stylistPerformance.map((s, idx) => (
            <View
              key={s.id}
              style={[
                styles.stylistRow,
                { borderBottomColor: idx < stylistPerformance.length - 1 ? colors.divider : 'transparent' },
              ]}
            >
              <View style={styles.stylistInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.stylistName, { color: colors.text }]}>{s.name}</Text>
                  {s.isOwner && (
                    <View style={[styles.ownerBadge, { backgroundColor: 'rgba(217, 164, 65, 0.15)' }]}>
                      <Text style={[styles.ownerBadgeText, { color: colors.accent }]}>Owner</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.stylistRole, { color: colors.textDim }]}>
                  {s.role} · {s.visits} {s.visits === 1 ? 'service' : 'services'}
                </Text>
              </View>

              <View style={styles.stylistFigures}>
                <Text style={[styles.stylistSales, { color: colors.text }]}>{inrFromMinor(s.salesMinor)}</Text>
                <Text style={[styles.stylistPct, { color: colors.accent }]}>{s.pct}% contribution</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Service Performance Card */}
        <View style={[styles.card, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {t('servicePerformance', 'Service Performance')}
              </Text>
              <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>
                {servicePerformance.length} {servicePerformance.length === 1 ? 'service' : 'services'} · Revenue & volume
              </Text>
            </View>
          </View>

          {servicePerformance.length === 0 ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>No service sales in this period</Text>
            </View>
          ) : (
            servicePerformance.map((item, idx) => (
              <View
                key={item.name}
                style={[
                  styles.stylistRow,
                  { borderBottomColor: idx < servicePerformance.length - 1 ? colors.divider : 'transparent' },
                ]}
              >
                <View style={styles.stylistInfo}>
                  <Text style={[styles.stylistName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.stylistRole, { color: colors.textDim }]}>
                    {item.count} {item.count === 1 ? 'service billed' : 'services billed'}
                  </Text>
                </View>

                <View style={styles.stylistFigures}>
                  <Text style={[styles.stylistSales, { color: colors.text }]}>
                    {inrFromMinor(item.revenueMinor)}
                  </Text>
                  <Text style={[styles.stylistPct, { color: colors.accent }]}>
                    {item.pct}% {t('shareContribution', 'contribution')}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
          </>
        )}
      </ScrollView>

      {/* Custom Date Range Modal */}
      <Modal visible={showCustomModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('customRange', 'Custom Date Range')}</Text>
            <Text style={[styles.modalSub, { color: colors.textDim }]}>
              Enter dates in YYYY-MM-DD format:
            </Text>

            <View style={{ marginVertical: 12 }}>
              <Text style={[styles.inputLabel, { color: colors.textDim }]}>From Date (Start):</Text>
              <TextInput
                value={customStart}
                onChangeText={setCustomStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text, borderColor: colors.divider, backgroundColor: colors.bg }]}
              />
            </View>

            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.inputLabel, { color: colors.textDim }]}>To Date (End):</Text>
              <TextInput
                value={customEnd}
                onChangeText={setCustomEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text, borderColor: colors.divider, backgroundColor: colors.bg }]}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: 'transparent', borderColor: colors.divider, borderWidth: 1 }]}
                onPress={() => setShowCustomModal(false)}
              >
                <Text style={{ color: colors.textDim, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.accent, flex: 1 }]}
                onPress={() => setShowCustomModal(false)}
              >
                <Text style={{ color: '#0D0F14', fontWeight: '700' }}>Apply Range</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PDF Preview & Download/Share Modal */}
      <Modal visible={showPdfPreviewModal} transparent animationType="slide" onRequestClose={() => setShowPdfPreviewModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.divider, maxWidth: 380, width: '92%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Report Preview</Text>
                <Text style={{ fontSize: 12, color: colors.textDim }}>{shopName} · {dateRangeLabel}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPdfPreviewModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Quick Financial Summary */}
            <View style={{ backgroundColor: colors.bg, borderRadius: radii.md, padding: 12, marginBottom: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>Total Sales Revenue:</Text>
                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>{inrFromMinor(metrics.totalSalesMinor)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>Collected / Paid:</Text>
                <Text style={{ color: '#22C55E', fontSize: 13, fontWeight: '700' }}>{inrFromMinor(metrics.paidAmountMinor)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>Outstanding Dues:</Text>
                <Text style={{ color: metrics.dueAmountMinor > 0 ? colors.error : colors.text, fontSize: 13, fontWeight: '600' }}>
                  {inrFromMinor(metrics.dueAmountMinor)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>Expenses:</Text>
                <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600' }}>{inrFromMinor(metrics.totalExpensesMinor)}</Text>
              </View>
              {metrics.excludedExpensesMinor > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textDim, fontSize: 12.5 }}>Not counted in profit:</Text>
                  <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600' }}>
                    {inrFromMinor(metrics.excludedExpensesMinor)}
                  </Text>
                </View>
              )}
              <View style={{ height: 1, backgroundColor: colors.divider }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Net Profit ({metrics.marginPct}%):</Text>
                <Text style={{ color: metrics.netProfitMinor >= 0 ? colors.accent : colors.error, fontSize: 14, fontWeight: '700' }}>
                  {inrFromMinor(metrics.netProfitMinor)}
                </Text>
              </View>
            </View>

            {/* Payment Summary Preview */}
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accent, marginBottom: 6, letterSpacing: 0.5 }}>
              PAYMENT BREAKDOWN
            </Text>
            <View style={{ backgroundColor: colors.bg, borderRadius: radii.md, padding: 10, marginBottom: 14, gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>UPI ({paymentSummary.upi.count}):</Text>
                <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>{inrFromMinor(paymentSummary.upi.amountMinor)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>Cash ({paymentSummary.cash.count}):</Text>
                <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>{inrFromMinor(paymentSummary.cash.amountMinor)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>Card ({paymentSummary.card.count}):</Text>
                <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>{inrFromMinor(paymentSummary.card.amountMinor)}</Text>
              </View>
            </View>

            {/* Actions: Download / Share */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={handleDownloadPdf}
                style={[styles.modalBtn, { backgroundColor: 'transparent', borderColor: colors.divider, borderWidth: 1, flex: 1 }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>Download</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSharePdf}
                style={[styles.modalBtn, { backgroundColor: colors.accent, flex: 1.2 }]}
              >
                <Text style={{ color: '#0D0F14', fontWeight: '700', fontSize: 13 }}>Share PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  viewSwitch: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    marginBottom: 12,
  },
  viewSwitchBtn: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  periodTabsRow: {
    flexDirection: 'row',
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodTabText: {
    fontSize: 13,
  },
  exportBar: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  netProfitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 16,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  netProfitAmt: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 4,
  },
  marginBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  marginText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    width: '48%',
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  metricSub: {
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardSubtitle: {
    fontSize: 12,
  },
  stylistRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  stylistInfo: {
    flex: 1,
    marginRight: 10,
  },
  stylistName: {
    fontSize: 14,
    fontWeight: '700',
  },
  ownerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stylistRole: {
    fontSize: 12,
    marginTop: 2,
  },
  stylistFigures: {
    alignItems: 'flex-end',
  },
  stylistSales: {
    fontSize: 14,
    fontWeight: '700',
  },
  stylistPct: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dayDateText: {
    fontSize: 14,
    fontWeight: '700',
  },
  daySubText: {
    fontSize: 12,
    marginTop: 2,
  },
  daySalesText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dayProfitText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
