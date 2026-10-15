import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { fmt, localeFor } from '../../i18n/format';
import { getGlass } from '../../theme/glass';
import { inrFromMinor } from '../../utils/format';
import { Bill, Expense } from '../../types/domain';
import { getSummaryYears, getSummaryMonths, getSummaryMonthDetail, dateKeyOf } from '../../utils/salesSummary';
import { buildMonthCsv, buildMonthHtml } from '../../utils/salesSummaryExport';
import { ExcelIcon, PdfIcon } from '../common/SvgIcons';
import { radii } from '../../theme/spacing';

interface SalesSummaryViewProps {
  bills: Bill[];
  expenses?: Expense[];
  shopName: string;
  /** Free plan past the sales limit: downloads are locked, like the Report tab. */
  isDownloadLocked?: boolean;
  onUpgradePlan?: () => void;
}

type ExportKind = 'csv' | 'pdf';

/**
 * Sales, expenses, and net profit by year, then month.
 * Tapping a month lists every sale and expense in it with Excel and PDF downloads.
 */
export const SalesSummaryView = ({
  bills,
  expenses = [],
  shopName,
  isDownloadLocked = false,
  onUpgradePlan,
}: SalesSummaryViewProps) => {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const glass = getGlass(colors.isDark);
  const locale = localeFor(language);

  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const years = useMemo(() => getSummaryYears(bills, expenses), [bills, expenses]);
  const months = useMemo(() => (year === null ? [] : getSummaryMonths(bills, year, expenses)), [bills, year, expenses]);
  const target = year !== null && month !== null ? { year, month } : null;
  const detail = useMemo(
    () => (target ? getSummaryMonthDetail(bills, target.year, target.month, expenses) : null),
    [bills, target, expenses]
  );

  const monthName = (m: number) => new Date(2000, m, 1).toLocaleDateString(locale, { month: 'long' });
  const shortDate = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };
  const billsText = (n: number) => fmt(n === 1 ? t('smBill', '{n} bill') : t('smBills', '{n} bills'), { n });

  const exportMonth = async (kind: ExportKind) => {
    if (!target || !detail || exporting) return;
    if (isDownloadLocked) {
      Alert.alert(t('smUpgradeTitle', 'Upgrade to Pro'), t('smUpgradeMsg', 'Upgrade to Pro to download reports.'), [
        { text: t('cancel', 'Cancel'), style: 'cancel' },
        { text: t('smUpgradeNow', 'Upgrade Now'), onPress: () => onUpgradePlan && onUpgradePlan() },
      ]);
      return;
    }

    setExporting(kind);
    try {
      const meta = {
        shopName: shopName || 'My Salon',
        monthLabel: new Date(target.year, target.month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        generatedOn: new Date().toLocaleString('en-IN'),
      };
      const cleanShop = meta.shopName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const stamp = `${target.year}-${String(target.month + 1).padStart(2, '0')}`;
      const filename = `Financial_Summary_${cleanShop}_${stamp}_${Date.now()}.${kind === 'csv' ? 'csv' : 'pdf'}`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      if (kind === 'csv') {
        await FileSystem.writeAsStringAsync(targetUri, buildMonthCsv(detail, meta), {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } else {
        const { uri, base64 } = await Print.printToFileAsync({ html: buildMonthHtml(detail, meta), base64: true });
        if (base64) {
          await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        } else {
          await FileSystem.copyAsync({ from: uri, to: targetUri });
        }
      }

      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (!available) {
        Alert.alert(t('smExportFailed', 'Could not export the report'), t('smShareUnavailable', 'File sharing is not available on this device.'));
        return;
      }
      await Sharing.shareAsync(targetUri, {
        mimeType: kind === 'csv' ? 'text/csv' : 'application/pdf',
        dialogTitle: `${meta.shopName} - ${meta.monthLabel}`,
        UTI: kind === 'csv' ? 'public.comma-separated-values-text' : 'com.adobe.pdf',
      });
    } catch (e: unknown) {
      Alert.alert(t('smExportFailed', 'Could not export the report'), e instanceof Error ? e.message : '');
    } finally {
      setExporting(null);
    }
  };

  const row = (
    key: string,
    label: string,
    sub: string,
    salesMinor: number,
    onPress: () => void,
    expensesMinor?: number,
    netProfitMinor?: number,
    marginPct?: number
  ) => {
    const hasExp = typeof expensesMinor === 'number' && expensesMinor > 0;
    const hasProfit = typeof netProfitMinor === 'number';
    return (
      <TouchableOpacity
        key={key}
        activeOpacity={0.85}
        onPress={onPress}
        style={[styles.row, glass.card, { borderWidth: 1 }]}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.rowSub, { color: colors.textDim }]}>
            {sub}
            {hasExp ? ` · Exp: ${inrFromMinor(expensesMinor)}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', paddingRight: 4 }}>
          {hasProfit ? (
            <>
              <Text
                style={[
                  styles.rowAmount,
                  { color: netProfitMinor >= 0 ? colors.accent : colors.error },
                ]}
              >
                {inrFromMinor(netProfitMinor)}
              </Text>
              <Text style={{ fontSize: 10.5, color: colors.textDim, fontWeight: '600', marginTop: 1 }}>
                Sales: {inrFromMinor(salesMinor)}
                {typeof marginPct === 'number' ? ` (${marginPct}%)` : ''}
              </Text>
            </>
          ) : (
            <Text style={[styles.rowAmount, { color: colors.text }]}>{inrFromMinor(salesMinor)}</Text>
          )}
        </View>
        <Text style={[styles.chevron, { color: colors.textDim }]}>{'›'}</Text>
      </TouchableOpacity>
    );
  };

  // A download tile: coloured file icon, the format name, and (in the roomy version) a short hint
  const downloadTile = (kind: ExportKind, compact = false) => {
    const isExcel = kind === 'csv';
    const tint = isExcel ? '#10B981' : '#EF4444';
    const label = isExcel ? t('smDownloadExcel', 'Download Excel') : t('smDownloadPdf', 'Download PDF');
    const hint = isExcel ? t('smExcelHint', 'Spreadsheet with Profit & Expenses') : t('smPdfHint', 'Ready to print summary');
    return (
      <TouchableOpacity
        key={kind}
        activeOpacity={0.85}
        onPress={() => exportMonth(kind)}
        disabled={!!exporting}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          compact ? styles.tileCompact : styles.tile,
          glass.raised,
          { borderWidth: 1, opacity: exporting && exporting !== kind ? 0.5 : 1 },
        ]}
      >
        <View style={[compact ? styles.tileIconSmall : styles.tileIcon, { backgroundColor: tint + '24' }]}>
          {exporting === kind ? (
            <ActivityIndicator size="small" color={tint} />
          ) : isExcel ? (
            <ExcelIcon size={compact ? 17 : 24} color={tint} />
          ) : (
            <PdfIcon size={compact ? 17 : 24} color={tint} />
          )}
        </View>
        <View style={compact ? undefined : { alignItems: 'center' }}>
          <Text style={[styles.tileLabel, { color: colors.text }]}>{isExcel ? 'Excel' : 'PDF'}</Text>
          {!compact && <Text style={[styles.tileHint, { color: colors.textDim }]}>{hint}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <Text style={[styles.sub, { color: colors.textDim }]}>{t('smSub', 'Financial & sales summary by year and month')}</Text>

      {year !== null && (
        <View style={styles.crumbs}>
          <TouchableOpacity
            onPress={() => {
              setYear(null);
              setMonth(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.crumb, { color: colors.accent }]}>{t('smAllYears', 'All years')}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textDim }}>{'›'}</Text>
          {month === null ? (
            <Text style={[styles.crumb, { color: colors.text }]}>{year}</Text>
          ) : (
            <>
              <TouchableOpacity onPress={() => setMonth(null)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={[styles.crumb, { color: colors.accent }]}>{year}</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.textDim }}>{'›'}</Text>
              <Text style={[styles.crumb, { color: colors.text }]}>{monthName(month)}</Text>
            </>
          )}
        </View>
      )}

      <Text style={[styles.title, { color: colors.text }]}>
        {year === null
          ? t('smPickYear', 'Choose a year')
          : month === null
          ? t('smPickMonth', 'Choose a month')
          : `${monthName(month)} ${year}`}
      </Text>

      {years.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ color: colors.textDim, fontSize: 13 }}>{t('smNoSales', 'No sales or expenses recorded yet')}</Text>
        </View>
      ) : year === null ? (
        years.map((y) =>
          row(
            String(y.year),
            String(y.year),
            billsText(y.billsCount),
            y.salesMinor,
            () => setYear(y.year),
            y.expensesMinor,
            y.netProfitMinor,
            y.marginPct
          )
        )
      ) : month === null ? (
        months.map((m) =>
          row(
            String(m.month),
            `${monthName(m.month)} ${year}`,
            billsText(m.billsCount),
            m.salesMinor,
            () => setMonth(m.month),
            m.expensesMinor,
            m.netProfitMinor,
            m.marginPct
          )
        )
      ) : (
        <>
          {/* Month Financial Overview KPI Card */}
          {detail && (
            <View style={[styles.monthKpiCard, glass.card, { borderWidth: 1 }]}>
              <View style={styles.monthKpiHeader}>
                <View>
                  <Text style={[styles.kpiLabel, { color: colors.textDim }]}>
                    {t('netProfit', 'NET PROFIT')}
                  </Text>
                  <Text
                    style={[
                      styles.netProfitValue,
                      { color: (detail.totals.netProfitMinor ?? 0) >= 0 ? colors.accent : colors.error },
                    ]}
                  >
                    {inrFromMinor(
                      detail.totals.netProfitMinor ??
                        (detail.totals.salesMinor - (detail.totals.expensesMinor || 0))
                    )}
                  </Text>
                </View>
                <View style={[styles.marginBadge, { backgroundColor: colors.accent + '22', borderColor: colors.accent + '55', borderWidth: 1 }]}>
                  <Text style={[styles.marginText, { color: colors.accent }]}>
                    {detail.totals.marginPct ?? 0}% {t('margin', 'Margin')}
                  </Text>
                </View>
              </View>

              <View style={[styles.kpiGrid, { borderTopColor: colors.divider }]}>
                <View style={styles.kpiCol}>
                  <Text style={[styles.kpiSubLabel, { color: colors.textDim }]}>{t('totalSales', 'Sales')}</Text>
                  <Text style={[styles.kpiSubValue, { color: colors.text }]}>
                    {inrFromMinor(detail.totals.salesMinor)}
                  </Text>
                  <Text style={[styles.kpiCount, { color: colors.textMuted }]}>
                    {billsText(detail.totals.billsCount)}
                  </Text>
                </View>

                <View style={styles.kpiCol}>
                  <Text style={[styles.kpiSubLabel, { color: colors.textDim }]}>{t('expenses', 'Expenses')}</Text>
                  <Text style={[styles.kpiSubValue, { color: colors.error }]}>
                    {inrFromMinor(detail.totals.expensesMinor || 0)}
                  </Text>
                  <Text style={[styles.kpiCount, { color: colors.textMuted }]}>
                    {detail.totals.expensesCount || (detail.expenses ? detail.expenses.length : 0)} {t('entries', 'entries')}
                  </Text>
                </View>

                <View style={styles.kpiCol}>
                  <Text style={[styles.kpiSubLabel, { color: colors.textDim }]}>{t('netProfit', 'Net Profit')}</Text>
                  <Text
                    style={[
                      styles.kpiSubValue,
                      { color: (detail.totals.netProfitMinor ?? 0) >= 0 ? '#10B981' : colors.error },
                    ]}
                  >
                    {inrFromMinor(
                      detail.totals.netProfitMinor ??
                        (detail.totals.salesMinor - (detail.totals.expensesMinor || 0))
                    )}
                  </Text>
                  <Text style={[styles.kpiCount, { color: colors.accent }]}>
                    {detail.totals.marginPct ?? 0}%
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Inside the month: one row per date, then downloads */}
          {detail && detail.days.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>{t('smNoSales', 'No sales recorded yet')}</Text>
            </View>
          ) : (
            <View style={[styles.sheetTable, glass.card, { borderWidth: 1 }]}>
              <View style={[styles.tRow, { borderBottomColor: colors.divider, backgroundColor: colors.accent + '1F' }]}>
                <Text style={[styles.tCell, styles.tDate, styles.tHead, { color: colors.text }]}>{t('date', 'Date')}</Text>
                <Text style={[styles.tCell, styles.tName, styles.tHead, { color: colors.text }]}>{t('smColName', 'Name')}</Text>
                <Text style={[styles.tCell, styles.tService, styles.tHead, { color: colors.text }]}>{t('services', 'Services')}</Text>
                <Text style={[styles.tCell, styles.tAmount, styles.tHead, { color: colors.text }]}>{t('amount', 'Amount')}</Text>
              </View>
              {detail?.days.flatMap((day) =>
                day.bills.map((b) => (
                  <View key={b.id} style={[styles.tRow, { borderBottomColor: colors.divider }]}>
                    <Text numberOfLines={1} style={[styles.tCell, styles.tDate, { color: colors.textDim }]}>
                      {shortDate(day.dateKey)}
                    </Text>
                    <Text style={[styles.tCell, styles.tName, { color: colors.text, fontWeight: '700' }]}>
                      {b.customerName || t('walkIn', 'Walk-in')}
                    </Text>
                    <Text style={[styles.tCell, styles.tService, { color: colors.textDim }]}>
                      {b.services.length > 0 ? b.services.join(', ') : t('smGeneralService', 'General service')}
                    </Text>
                    <Text style={[styles.tCell, styles.tAmount, { color: colors.text, fontWeight: '800' }]}>
                      {inrFromMinor(b.priceMinor)}
                    </Text>
                  </View>
                ))
              )}
              <View style={[styles.tRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.tCell, { flex: 1, color: colors.text, fontWeight: '800' }]}>
                  {t('smMonthTotal', 'Month sales total')}
                </Text>
                <Text style={[styles.tCell, { color: colors.accent, fontWeight: '800', textAlign: 'right' }]}>
                  {inrFromMinor(detail?.totals.salesMinor || 0)}
                </Text>
              </View>
            </View>
          )}

          {/* Expenses Breakdown in Month (if any) */}
          {detail?.expenses && detail.expenses.length > 0 && (
            <View style={[styles.sheetTable, glass.card, { borderWidth: 1, marginTop: 12 }]}>
              <View style={[styles.tRow, { borderBottomColor: colors.divider, backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                <Text style={[styles.tCell, styles.tDate, styles.tHead, { color: colors.text }]}>{t('date', 'Date')}</Text>
                <Text style={[styles.tCell, styles.tName, styles.tHead, { color: colors.text }]}>{t('category', 'Category')}</Text>
                <Text style={[styles.tCell, styles.tService, styles.tHead, { color: colors.text }]}>{t('notes', 'Note')}</Text>
                <Text style={[styles.tCell, styles.tAmount, styles.tHead, { color: colors.text }]}>{t('amount', 'Amount')}</Text>
              </View>
              {detail.expenses.map((ex) => (
                <View key={ex.id} style={[styles.tRow, { borderBottomColor: colors.divider }]}>
                  <Text numberOfLines={1} style={[styles.tCell, styles.tDate, { color: colors.textDim }]}>
                    {shortDate(dateKeyOf(ex.time))}
                  </Text>
                  <Text style={[styles.tCell, styles.tName, { color: colors.text, fontWeight: '700' }]}>
                    {ex.categoryName || 'General'}
                  </Text>
                  <Text style={[styles.tCell, styles.tService, { color: colors.textDim }]}>
                    {ex.note || '—'}
                  </Text>
                  <Text style={[styles.tCell, styles.tAmount, { color: colors.error, fontWeight: '800' }]}>
                    {inrFromMinor(ex.amountMinor)}
                  </Text>
                </View>
              ))}
              <View style={[styles.tRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.tCell, { flex: 1, color: colors.text, fontWeight: '800' }]}>
                  {t('totalExpenses', 'Total Expenses')}
                </Text>
                <Text style={[styles.tCell, { color: colors.error, fontWeight: '800', textAlign: 'right' }]}>
                  {inrFromMinor(detail.totals.expensesMinor || 0)}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.tileRow}>
            {downloadTile('csv', true)}
            {downloadTile('pdf', true)}
          </View>
        </>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  sub: { fontSize: 12, marginBottom: 10 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  crumb: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  empty: { paddingVertical: 28, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  monthKpiCard: { borderRadius: 16, padding: 14, marginBottom: 12 },
  monthKpiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  kpiLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  netProfitValue: { fontSize: 24, fontWeight: '800', marginTop: 3 },
  marginBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill },
  marginText: { fontSize: 11.5, fontWeight: '700' },
  kpiGrid: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 10, gap: 8 },
  kpiCol: { flex: 1 },
  kpiSubLabel: { fontSize: 11, fontWeight: '700' },
  kpiSubValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  kpiCount: { fontSize: 10.5, marginTop: 1 },
  sheetTable: { borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  tRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1 },
  tCell: { fontSize: 12, paddingHorizontal: 3 },
  tHead: { fontWeight: '800', fontSize: 11.5 },
  tDate: { width: 56 },
  tName: { flex: 1.1 },
  tService: { flex: 1.3 },
  tAmount: { width: 78, flexShrink: 0, textAlign: 'right' },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 17 },
  rowAmount: { fontSize: 15, fontWeight: '800' },
  chevron: { fontSize: 22, marginLeft: 8, marginTop: -2 },
  tileRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  tile: { flex: 1, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center', gap: 10 },
  tileCompact: { flex: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tileIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tileIconSmall: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
  tileHint: { fontSize: 12, marginTop: 2, textAlign: 'center' },
});
