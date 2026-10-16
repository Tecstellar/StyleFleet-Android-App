import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Period, Bill } from '../../types/domain';
import { financialService } from '../../services/financialService';
import { inrFromMinor, shortInrFromMinor } from '../../utils/format';
import { PlusIcon, ChevronDownIcon } from '../../components/common/SvgIcons';
import { radii, shadows } from '../../theme/spacing';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { fmt, localeFor } from '../../i18n/format';
import { getGlass } from '../../theme/glass';
import { usePullRefresh } from '../../hooks/usePullRefresh';

interface SalesScreenProps {
  onRefresh?: () => Promise<void>;
  bills: Bill[];
  shopName?: string;
  onOpenInvoice: (bill: Bill) => void;
  onNewBill: () => void;
  onRestoreBill?: (billId: string) => Promise<void>;
  isStylist?: boolean;
}

export const SalesScreen = ({
  onRefresh,
  bills,
  shopName = 'Salon',
  onOpenInvoice,
  onNewBill,
  onRestoreBill,
  isStylist = false,
}: SalesScreenProps) => {
  const pullRefresh = usePullRefresh(onRefresh);
  const { colors } = useTheme();
  const glass = getGlass(colors.isDark);
  const { t, language } = useLanguage();
  const tf = (key: string, fallback: string, vars: Record<string, string | number> = {}) =>
    fmt(t(key, fallback), vars);
  const locale = localeFor(language);
  const [period, setPeriod] = useState<Period>('Day');
  const [activeTabSub, setActiveTabSub] = useState<'active' | 'deleted'>('active');
  const [showYesterdayDropdown, setShowYesterdayDropdown] = useState(false);

  // Helper to check if bill belongs to today's local calendar date
  const isTodayBill = (b: Bill): boolean => {
    const dateStr = b.created_at || b.issued_at;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  };

  // Stylists only see today's sales; owners see full history
  const visibleBills = React.useMemo(() => {
    return bills;
  }, [bills, isStylist]);

  // Separate active bills vs recently deleted bills (30 days)
  const { activeBills, deletedBills } = React.useMemo(() => {
    const seen = new Set<string>();
    const active: Bill[] = [];
    const deleted: Bill[] = [];
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const b of visibleBills) {
      if (!b) continue;
      if (b.id && seen.has(b.id)) continue;
      if (b.invoice_number && seen.has(b.invoice_number)) continue;
      if (b.id) seen.add(b.id);
      if (b.invoice_number) seen.add(b.invoice_number);

      if (b.status === 'deleted') {
        const delTime = b.deleted_at
          ? new Date(b.deleted_at).getTime()
          : b.created_at
          ? new Date(b.created_at).getTime()
          : b.issued_at
          ? new Date(b.issued_at).getTime()
          : now;
        if (now - delTime <= thirtyDaysMs) {
          deleted.push(b);
        }
      } else {
        active.push(b);
      }
    }
    return { activeBills: active, deletedBills: deleted };
  }, [visibleBills]);

  // Lock period to Day for stylists
  const activePeriod = isStylist ? 'Day' : period;
  const metrics = financialService.getSalesMetrics(activePeriod, activeBills);
  const deltaPct =
    metrics.prev_minor > 0
      ? Math.round((Math.abs(metrics.total_minor - metrics.prev_minor) / metrics.prev_minor) * 100)
      : 0;
  const isUp = metrics.total_minor >= metrics.prev_minor;
  const deltaLabel = metrics.prev_minor > 0
    ? `${isUp ? '▲ ' : '▼ '}${deltaPct}% ${t('vsLast', 'vs last')} ${t(activePeriod.toLowerCase(), activePeriod)}`
    : t('slNoChange', '0% change');

  // Yesterday's collected revenue & payment mode breakdown
  const yesterdayMetrics = React.useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const yesterdayEnd = todayStart - 1;

    // Use full bills array to compute yesterday metrics (for owner view)
    const yBills = bills.filter((b) => {
      if (!b || b.status === 'deleted') return false;
      const dateStr = b.created_at || b.issued_at;
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      return !isNaN(t) && t >= yesterdayStart && t <= yesterdayEnd;
    });

    const paymentTotals: Record<string, number> = { UPI: 0, Cash: 0, Card: 0 };
    let totalMinor = 0;

    for (const b of yBills) {
      if (b.status === 'pending') continue;
      const collected =
        b.status === 'partially_paid'
          ? (typeof b.paid_amount_minor === 'number' ? b.paid_amount_minor : (b.total_minor || 0))
          : (b.total_minor || 0);

      if (collected <= 0) continue;

      if (b.payments && b.payments.length > 0) {
        const sumPayments = b.payments.reduce((acc, p) => acc + (p.amount_minor || 0), 0);
        for (const p of b.payments) {
          const effectiveAmount =
            sumPayments > 0 && sumPayments !== collected
              ? Math.round(((p.amount_minor || 0) / sumPayments) * collected)
              : (p.amount_minor || 0);

          if (effectiveAmount > 0) {
            const raw = (p.method || b.payment_method || 'UPI').trim();
            const mode = /cash/i.test(raw) ? 'Cash' : /card/i.test(raw) ? 'Card' : 'UPI';
            paymentTotals[mode] = (paymentTotals[mode] || 0) + effectiveAmount;
            totalMinor += effectiveAmount;
          }
        }
      } else {
        const raw = (b.payment_method || 'UPI').trim();
        const mode = /cash/i.test(raw) ? 'Cash' : /card/i.test(raw) ? 'Card' : 'UPI';
        paymentTotals[mode] = (paymentTotals[mode] || 0) + collected;
        totalMinor += collected;
      }
    }

    return {
      total_minor: totalMinor,
      bills_count: yBills.length,
      modes: [
        {
          label: 'UPI',
          amt_minor: paymentTotals['UPI'] || 0,
          pct: totalMinor > 0 ? Math.round(((paymentTotals['UPI'] || 0) / totalMinor) * 100) : 0,
        },
        {
          label: 'Cash',
          amt_minor: paymentTotals['Cash'] || 0,
          pct: totalMinor > 0 ? Math.round(((paymentTotals['Cash'] || 0) / totalMinor) * 100) : 0,
        },
        {
          label: 'Card',
          amt_minor: paymentTotals['Card'] || 0,
          pct: totalMinor > 0 ? Math.round(((paymentTotals['Card'] || 0) / totalMinor) * 100) : 0,
        },
      ],
    };
  }, [bills]);

  const now = new Date();
  const subLabelText = isStylist
    ? tf('slSubStylistToday', "{today} ({date}) sales", {
        today: t('today', 'Today'),
        date: now.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      })
    : activePeriod === 'Day'
    ? tf('slSubDay', '{today} ({date}) vs yesterday', {
        today: t('today', 'Today'),
        date: now.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      })
    : activePeriod === 'Week'
    ? t('slSubWeek', 'Last 7 days (including Today) vs prior week')
    : tf('slSubMonth', '{month} (up to Today) vs last month', {
        month: now.toLocaleString(locale, { month: 'long' }),
      });
  const barLabel = (label: string): string => {
    const wk = label.match(/^W(\d+) \(Now\)$/);
    if (wk) return tf('slWeekNow', 'W{n} (Now)', { n: wk[1] });
    if (label === 'Today') return t('today', 'Today');
    return label;
  };
  const topServiceText = (() => {
    const sold = metrics.top_service.match(/^(.*) · (\d+) sold$/);
    if (sold) return tf('slSold', '{name} · {n} sold', { name: sold[1], n: sold[2] });
    if (metrics.top_service === 'No services yet') return t('slNoServices', 'No services yet');
    return metrics.top_service;
  })();
  const modeLabel = (label: string): string =>
    label === 'UPI' ? t('upi', 'UPI') : label === 'Cash' ? t('cash', 'Cash') : label === 'Card' ? t('card', 'Card') : label;

  // Local calendar day of a bill (YYYY-MM-DD), '' when the bill has no usable date
  const billDayKey = (b: Bill): string => {
    const d = new Date(b.created_at || '');
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Stylists: today by default, or any past day picked under "Custom"
  const [customDay, setCustomDay] = useState<string | null>(null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const todayKey = billDayKey({ created_at: new Date().toISOString() } as Bill);
  const shownBills = isStylist ? activeBills.filter((b) => billDayKey(b) === (customDay ?? todayKey)) : activeBills;
  const dayRows = React.useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const b of activeBills) {
      const k = billDayKey(b);
      if (!k) continue;
      const r = map.get(k) || { count: 0, total: 0 };
      r.count += 1;
      r.total += b.total_minor || 0;
      map.set(k, r);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [activeBills]);
  const customRow = customDay ? dayRows.find(([k]) => k === customDay)?.[1] : undefined;

  const dayHeadingLabel = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (sameDay(date, today)) return t('today', 'Today');
    if (sameDay(date, yesterday)) return t('slYesterday', 'Yesterday');
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
    });
  };

  const todayHeaderStr =new Date().toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{t('sales', 'Sales')}</Text>
          <Text style={[styles.todayLabel, { color: colors.textDim }]}>
            {todayHeaderStr}
          </Text>
        </View>

        {/* Period Selector Tabs - hidden for stylists */}
        {(
          <View style={[styles.periodTabsRow, { borderColor: glass.card.borderColor, backgroundColor: glass.card.backgroundColor }]}>
            {(isStylist ? (['Day', 'Custom'] as const) : (['Day', 'Week', 'Month'] as const)).map((p) => {
              const isSelected = isStylist ? (p === 'Custom' ? !!customDay : !customDay) : period === p;
              return (
                <TouchableOpacity
                  key={p}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (!isStylist) setPeriod(p as Period);
                    else if (p === 'Custom') setDayPickerOpen(true);
                    else setCustomDay(null);
                  }}
                  style={[
                    styles.periodTab,
                    {
                      backgroundColor: isSelected ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.periodTabText,
                      {
                        color: isSelected ? '#161826' : colors.textMuted,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {p === 'Day' ? t('today', 'Today') : p === 'Custom' ? t('slCustom', 'Custom') : t(p.toLowerCase(), p)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={pullRefresh}>
        {isStylist && customDay && (
          <View style={[styles.heroCard, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Text style={[styles.totalAmount, { color: colors.text }]}>{inrFromMinor(customRow?.total || 0)}</Text>
            <Text style={[styles.subLabel, { color: colors.textDim }]}>
              {dayHeadingLabel(customDay)} · {fmt(t(customRow?.count === 1 ? 'smBill' : 'smBills', '{n} bills'), { n: customRow?.count || 0 })}
            </Text>
          </View>
        )}
        {!customDay && (
        <>
        <View style={[styles.heroCard, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
        {/* Total & Delta */}
        <View style={styles.totalRow}>
          <Text style={[styles.totalAmount, { color: colors.text }]}>
            {inrFromMinor(metrics.total_minor)}
          </Text>
          <View
            style={[
              styles.deltaPill,
              {
                backgroundColor: isUp ? colors.accent + '22' : glass.pill.backgroundColor,
                borderColor: isUp ? colors.accent + '66' : glass.card.borderColor,
              },
            ]}
          >
            <Text style={[styles.deltaText, { color: isUp ? colors.accent : colors.neutral400 }]}>
              {deltaLabel}
            </Text>
          </View>
        </View>

        <View style={styles.subLabelRow}>
          <Text style={[styles.subLabel, { color: colors.textDim }]}>
            {subLabelText}
          </Text>
          {!isStylist && activePeriod === 'Day' && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowYesterdayDropdown((prev) => !prev)}
              style={styles.dropdownArrowBtn}
              accessibilityLabel={t('toggleYesterdayCollected', 'Toggle yesterday collected breakdown')}
            >
              <View style={{ transform: [{ rotate: showYesterdayDropdown ? '180deg' : '0deg' }] }}>
                <ChevronDownIcon size={16} color={colors.accent} strokeWidth={2.4} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Yesterday Breakdown Accordion */}
        {showYesterdayDropdown && !isStylist && activePeriod === 'Day' && (
          <View style={[styles.yesterdayAccordionCard, { backgroundColor: colors.isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)', borderColor: glass.card.borderColor }]}>
            <View style={styles.yesterdayAccordionHeader}>
              <View>
                <Text style={[styles.yesterdayTitle, { color: colors.accent }]}>
                  {t('slYesterdayCollected', 'Yesterday Collected via UPI, Cash & Card')}
                </Text>
                <Text style={[styles.yesterdaySubtitle, { color: colors.textDim }]}>
                  {tf('slYesterdaySummary', '{count} bills · Total {total}', {
                    count: yesterdayMetrics.bills_count,
                    total: inrFromMinor(yesterdayMetrics.total_minor),
                  })}
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 8 }}>
              {yesterdayMetrics.modes.map((m, idx) => (
                <View key={idx} style={styles.modeRow}>
                  <Text style={[styles.modeLabel, { color: colors.text }]}>{modeLabel(m.label)}</Text>
                  <View style={[styles.modeProgressBar, { backgroundColor: colors.trackBg }]}>
                    <View
                      style={[
                        styles.modeProgressFill,
                        { width: `${m.pct}%`, backgroundColor: colors.accent },
                      ]}
                    />
                  </View>
                  <Text style={[styles.modeAmount, { color: colors.textMuted }]}>
                    {shortInrFromMinor(m.amt_minor)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bar Chart */}
        <View style={styles.chartContainer}>
          {metrics.bars.map((bar, i) => {
            const isTodayOrNow = bar.label === 'Today' || bar.label.includes('Now');
            const hasSales = bar.amt_minor > 0;
            return (
              <View key={i} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.round((bar.height_pct / 100) * 72) + 4,
                      backgroundColor: hasSales
                        ? colors.accent
                        : isTodayOrNow
                        ? colors.accent800
                        : colors.trackBg,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.barLabel,
                    {
                      color: isTodayOrNow ? colors.accent : colors.textDim,
                      fontWeight: isTodayOrNow ? '700' : '400',
                    },
                  ]}
                >
                  {barLabel(bar.label)}
                </Text>
              </View>
            );
          })}
        </View>
        </View>

        {/* 2-Column Info Grid */}
        <View style={styles.metricsGrid}>
          {/* Collected via */}
          <View style={[styles.metricCard, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={[styles.metricCardLabel, { color: colors.textDim }]}>
                {t('slCollectedVia', 'COLLECTED VIA')}
              </Text>
              {!isStylist && activePeriod === 'Day' && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowYesterdayDropdown((prev) => !prev)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 6, borderRadius: radii.pill, backgroundColor: showYesterdayDropdown ? colors.accent + '22' : 'transparent', borderWidth: 1, borderColor: showYesterdayDropdown ? colors.accent : colors.divider }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '600', color: showYesterdayDropdown ? colors.accent : colors.textDim }}>
                    {showYesterdayDropdown ? t('yesterday', 'Yesterday') : t('today', 'Today')}
                  </Text>
                  <View style={{ transform: [{ rotate: showYesterdayDropdown ? '180deg' : '0deg' }] }}>
                    <ChevronDownIcon size={12} color={showYesterdayDropdown ? colors.accent : colors.textDim} strokeWidth={2.4} />
                  </View>
                </TouchableOpacity>
              )}
            </View>
            {(showYesterdayDropdown ? yesterdayMetrics.modes : metrics.modes).map((m, idx) => (
              <View key={idx} style={styles.modeRow}>
                <Text style={[styles.modeLabel, { color: colors.text }]}>{modeLabel(m.label)}</Text>
                <View
                  style={[
                    styles.modeProgressBar,
                    { backgroundColor: colors.trackBg },
                  ]}
                >
                  <View
                    style={[
                      styles.modeProgressFill,
                      { width: `${m.pct}%`, backgroundColor: colors.accent },
                    ]}
                  />
                </View>
                <Text style={[styles.modeAmount, { color: colors.textMuted }]}>
                  {shortInrFromMinor(m.amt_minor)}
                </Text>
              </View>
            ))}
          </View>

          {/* Bills count & Top service */}
          <View style={styles.metricCardColumn}>
            <View style={[styles.metricCardSmall, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
              <Text style={[styles.metricCardLabel, { color: colors.textDim }]}>
                {t('slBills', 'BILLS')}
              </Text>
              <Text style={[styles.billsCountText, { color: colors.text }]}>
                {metrics.bills_count}
              </Text>
              <Text style={[styles.avgBillText, { color: colors.textDim }]}>
                {tf('slAvg', 'avg {x}', { x: inrFromMinor(metrics.avg_bill_minor) })}
              </Text>
            </View>

            <View style={[styles.metricCardSmall, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
              <Text style={[styles.metricCardLabel, { color: colors.textDim }]}>
                {t('slTopService', 'TOP SERVICE')}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.topServiceText, { color: colors.text }]}
              >
                {topServiceText}
              </Text>
            </View>
          </View>
        </View>

        </>
        )}

        {/* Bills list header with Tabs */}
        <View style={[styles.billsListHeader, { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setActiveTabSub('active')}
              activeOpacity={0.8}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: radii.pill,
                backgroundColor: activeTabSub === 'active' ? colors.accent + '22' : glass.pill.backgroundColor,
                borderWidth: 1,
                borderColor: activeTabSub === 'active' ? colors.accent : glass.card.borderColor,
              }}
            >
              <Text style={{ color: activeTabSub === 'active' ? colors.accent : colors.textDim, fontWeight: '600', fontSize: 13 }}>
                {isStylist && !customDay
                  ? tf('slTodayBillsCount', "Today's Bills ({n})", { n: shownBills.length })
                  : tf('slRecentBills', 'Recent Bills ({n})', { n: shownBills.length })}
              </Text>
            </TouchableOpacity>

            {!isStylist && deletedBills.length > 0 && (
              <TouchableOpacity
                onPress={() => setActiveTabSub('deleted')}
                activeOpacity={0.8}
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: 10,
                  borderRadius: radii.pill,
                  backgroundColor: activeTabSub === 'deleted' ? 'rgba(239,68,68,0.15)' : glass.pill.backgroundColor,
                  borderWidth: 1,
                  borderColor: activeTabSub === 'deleted' ? '#EF4444' : glass.card.borderColor,
                }}
              >
                <Text style={{ color: activeTabSub === 'deleted' ? '#EF4444' : colors.textDim, fontWeight: '600', fontSize: 13 }}>
                  {tf('slDeletedBills', 'Recently Deleted ({n})', { n: deletedBills.length })}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.billsListSub, { color: colors.textSubtle }]}>
            {t('slTapToView', 'tap to view')}
          </Text>
        </View>

        <View style={styles.billsList}>
          {activeTabSub === 'deleted' ? (
            deletedBills.length === 0 ? (
              <View style={styles.emptyBillsBox}>
                <Text style={[styles.emptyBillsTitle, { color: colors.text }]}>
                  {t('slNoDeleted', 'No recently deleted bills')}
                </Text>
                <Text style={[styles.emptyBillsSub, { color: colors.textDim }]}>
                  {t('slNoDeletedSub', 'Bills deleted in the last 30 days will appear here.')}
                </Text>
              </View>
            ) : (
              deletedBills.map((b) => (
                <View
                  key={b.id || b.invoice_number}
                  style={[
                    styles.billRow,
                    { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor, opacity: 0.85, alignItems: 'center' },
                  ]}
                >
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    activeOpacity={0.7}
                    onPress={() => onOpenInvoice(b)}
                  >
                    <View style={styles.billMain}>
                      <Text numberOfLines={1} style={[styles.billTime, { color: colors.textDim }]}>
                        {b.issued_at}
                      </Text>
                      <Text style={[styles.billCust, { color: colors.text, fontWeight: '600' }]}>
                        {b.customer_name}
                      </Text>
                      <Text numberOfLines={1} style={[styles.billWhat, { color: '#EF4444' }]}>
                        {tf('slDeletedBy', 'Deleted by {who}', {
                          who: `${b.deleted_by || 'Owner'}${b.deleted_by_role ? ` (${b.deleted_by_role === 'stylist' ? 'Stylist' : 'Owner'})` : ''}`,
                        })} · #{b.invoice_number}
                      </Text>
                    </View>
                    <View style={styles.billRight}>
                      <Text style={[styles.billAmt, { color: colors.text, fontWeight: '700' }]}>
                        {inrFromMinor(b.total_minor)}
                      </Text>
                      <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: '600', marginTop: 2 }}>
                        {t('slDeletedTag', 'DELETED')}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {onRestoreBill && (
                    <TouchableOpacity
                      onPress={() => onRestoreBill(b.id)}
                      activeOpacity={0.8}
                      style={{ marginLeft: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.sm, backgroundColor: '#22C55E' }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>{t('restore', 'Restore')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )
          ) : (
            shownBills.length === 0 ? (
              <View style={styles.emptyBillsBox}>
                <Text style={[styles.emptyBillsTitle, { color: colors.text }]}>
                  {t('noBillsYet', 'No bills recorded yet')}
                </Text>
                <Text style={[styles.emptyBillsSub, { color: colors.textDim }]}>
                  {t('tapNewBill', 'Tap "+ New bill" below to record your first client service and payment.')}
                </Text>
              </View>
            ) : (
              shownBills.map((b, index) => {
                const dayKey = billDayKey(b);
                const showDayHeading = dayKey !== '' && (index === 0 || dayKey !== billDayKey(shownBills[index - 1]));
                const isPartiallyPaid = b.status === 'partially_paid';
                const isPending = b.status === 'pending';
                const dueMinor = b.due_amount_minor ?? (isPending ? b.total_minor : 0);
                const paidMinor = b.paid_amount_minor ?? (isPending ? 0 : Math.max(0, b.total_minor - dueMinor));
                const isDueBill = b.notes?.includes('due') || b.invoice_number?.startsWith('DUE');
                const whatText =
                  b.items && b.items.length > 0
                    ? b.items.map((it) => it.service_name_snapshot).join(', ')
                    : isDueBill
                    ? t('slOpeningDue', 'Opening Due / Settlement')
                    : t('slSalon', 'Salon Service');

                return (
                  <React.Fragment key={b.id || b.invoice_number}>
                  {showDayHeading && (
                    <Text style={[styles.dayHeading, { color: colors.textDim }, index > 0 && { marginTop: 10 }]}>
                      {dayHeadingLabel(dayKey)}
                    </Text>
                  )}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => onOpenInvoice(b)}
                    style={[
                      styles.billRow,
                      { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor },
                    ]}
                  >
                    <View style={styles.billMain}>
                      <Text numberOfLines={1} style={[styles.billTime, { color: colors.textDim }]}>
                        {b.issued_at}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.billCust, { color: colors.text, fontWeight: '600', flexShrink: 1 }]}>
                          {b.customer_name}
                        </Text>
                        {(b.is_edited || b.notes?.includes('[Edited]')) && (
                          <View style={{ flexShrink: 0, backgroundColor: 'rgba(217, 164, 65, 0.18)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: colors.accent }}>
                            <Text numberOfLines={1} style={{ fontSize: 9.5, color: colors.accent, fontWeight: '700' }}>
                              {t('edited', 'Edited')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.billWhat, { color: colors.textDim }]}
                      >
                        {whatText} · {b.staff_name || 'Staff'}
                      </Text>
                    </View>
                    <View style={styles.billRight}>
                      <Text style={[styles.billAmt, { color: colors.text, fontWeight: '700' }]}>
                        {inrFromMinor(b.total_minor)}
                      </Text>
                      {isPartiallyPaid ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text numberOfLines={1} style={{ fontSize: 10.5, color: '#16a34a', fontWeight: '600', marginTop: 2 }}>
                            {tf('slPaid', 'Paid {x}', { x: inrFromMinor(paidMinor) })}
                          </Text>
                          <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.16)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.45)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginTop: 3 }}>
                          <Text numberOfLines={1} style={{ fontSize: 10, color: '#f59e0b', fontWeight: '700' }}>{tf('slDue', 'Due {x}', { x: inrFromMinor(dueMinor) })}</Text>
                        </View>
                        </View>
                      ) : isPending ? (
                        <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.14)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.45)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginTop: 3 }}>
                          <Text numberOfLines={1} style={{ fontSize: 10, color: '#ef4444', fontWeight: '700' }}>{tf('slDue', 'Due {x}', { x: inrFromMinor(dueMinor) })}</Text>
                        </View>
                      ) : isDueBill ? (
                        <View style={{ backgroundColor: 'rgba(34, 197, 94, 0.14)', borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.45)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, marginTop: 3 }}>
                          <Text numberOfLines={1} style={{ fontSize: 10, color: '#22c55e', fontWeight: '700' }}>{t('slDueSettled', 'Due Settled')}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.billMode, { color: colors.textDim }]}>
                          {b.payment_method}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                  </React.Fragment>
                );
              })
            )
          )}
        </View>
      </ScrollView>

      {/* Stylist: pick a past day to see what they made */}
      <Modal visible={dayPickerOpen} transparent animationType="fade" onRequestClose={() => setDayPickerOpen(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => setDayPickerOpen(false)}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, maxHeight: '75%' }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 10 }}>
              {t('slPickDay', 'Pick a day')}
            </Text>
            <ScrollView>
              {dayRows.length === 0 ? (
                <Text style={{ color: colors.textDim, paddingVertical: 12 }}>{t('noBillsYet', 'No bills recorded yet')}</Text>
              ) : (
                dayRows.map(([key, row]) => (
                  <TouchableOpacity
                    key={key}
                    activeOpacity={0.7}
                    onPress={() => {
                      setCustomDay(key === todayKey ? null : key);
                      setDayPickerOpen(false);
                    }}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider }}
                  >
                    <View>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{dayHeadingLabel(key)}</Text>
                      <Text style={{ color: colors.textDim, fontSize: 12 }}>{fmt(t(row.count === 1 ? 'smBill' : 'smBills', '{n} bills'), { n: row.count })}</Text>
                    </View>
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>{inrFromMinor(row.total)}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Floating Action Button */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onNewBill}
        style={[
          styles.fab,
          {
            backgroundColor: colors.accent,
            borderColor: colors.accent,
          },
        ]}
      >
        <PlusIcon size={18} color="#161826" />
        <Text style={[styles.fabText, { color: '#161826' }]}>
          {t('newBill', 'New bill')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  dayHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: -0.4,
  },
  todayLabel: {
    marginLeft: 'auto',
    fontSize: 12,
  },
  periodTabsRow: {
    flexDirection: 'row',
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  deltaPill: {
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 4,
  },
  periodTabText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 96,
  },
  totalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 6,
  },
  totalAmount: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  deltaText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  subLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  dropdownArrowBtn: {
    padding: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesterdayAccordionCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  yesterdayAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yesterdayTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  yesterdaySubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  subLabel: {
    fontSize: 12,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 86,
    marginTop: 18,
    marginBottom: 4,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  bar: {
    width: '100%',
    borderRadius: 3,
  },
  barLabel: {
    fontSize: 9.5,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 14,
  },
  metricCard: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  metricCardColumn: {
    flex: 1,
    gap: 8,
  },
  metricCardSmall: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  metricCardLabel: {
    fontSize: 9.5,
    fontWeight: '500',
    letterSpacing: 0.9,
    marginBottom: 7,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 5,
  },
  modeLabel: {
    flex: 1,
    fontSize: 12,
  },
  modeProgressBar: {
    width: 48,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  modeProgressFill: {
    height: '100%',
  },
  modeAmount: {
    fontSize: 11.5,
    width: 44,
    textAlign: 'right',
  },
  billsCountText: {
    fontSize: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  avgBillText: {
    fontSize: 11,
  },
  topServiceText: {
    fontSize: 13.5,
    marginTop: 3,
  },
  billsListHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  billsListTitle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  billsListSub: {
    marginLeft: 'auto',
    fontSize: 11,
  },
  billsList: {},
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
  },
  billTime: {
    fontSize: 11,
    marginBottom: 2,
  },
  billMain: {
    flex: 1,
    minWidth: 0,
  },
  billCust: {
    fontSize: 14,
  },
  billWhat: {
    fontSize: 11.5,
    marginTop: 2,
  },
  billRight: {
    alignItems: 'flex-end',
    maxWidth: '44%',
    flexShrink: 0,
  },
  billAmt: {
    fontSize: 14,
  },
  billMode: {
    fontSize: 10,
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...shadows.md,
  },
  fabText: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyBillsBox: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyBillsTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyBillsSub: {
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
});
