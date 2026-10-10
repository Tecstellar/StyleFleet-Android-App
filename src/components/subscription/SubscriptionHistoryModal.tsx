import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { radii, spacing, shadows } from '../../theme/spacing';
import { subscriptionRepository, SubscriptionInfo } from '../../repositories/subscriptionRepository';
import { billingRepository } from '../../repositories/billingRepository';
import { SubscriptionRecord } from '../../types/domain';
import { getPlanById, formatPriceInRupees } from '../../config/planConfig';
import { CheckIcon, SparklesIcon, ClockIcon } from '../common/SvgIcons';
import { FREE_SALES_LIMIT } from '../../utils/subscriptionUtils';

interface SubscriptionHistoryModalProps {
  visible: boolean;
  shopId: string;
  shopName: string;
  registrationDateIso?: string | null;
  totalSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  onClose: () => void;
  onUpgradePlan?: () => void;
}

export const SubscriptionHistoryModal: React.FC<SubscriptionHistoryModalProps> = ({
  visible,
  shopId,
  shopName,
  registrationDateIso,
  totalSalesCount = 0,
  freeSalesLimit = FREE_SALES_LIMIT,
  onClose,
  onUpgradePlan,
}) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<SubscriptionRecord[]>([]);
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [historyData, currentInfo] = await Promise.all([
        subscriptionRepository.getSubscriptionHistory(shopId),
        subscriptionRepository.getSubscriptionInfo(shopId),
      ]);
      setHistory(historyData);
      setSubInfo(currentInfo);
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to load subscription history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [shopId]);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      loadData();
    }
  }, [visible, loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  // Derive current status details
  const isPaidActive = subInfo?.type === 'subscription' && !subInfo.subscription?.isExpired;
  const isStarterLimitReached = totalSalesCount >= freeSalesLimit;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.bg, borderColor: colors.divider }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.divider }]}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <SparklesIcon size={16} color="#D9A441" />
                <Text style={[styles.title, { color: colors.text }]}>
                  {t('subscriptionHistory', 'Subscription History')}
                </Text>
              </View>
              <Text style={[styles.subtitle, { color: colors.textDim }]}>
                {shopName} • {t('billingInvoices', 'Plan invoices & payment records')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.closeButton, { backgroundColor: colors.surface, borderColor: colors.divider }]}
              accessibilityLabel={t('close', 'Close')}
            >
              <Text style={{ color: colors.textDim, fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[styles.loadingText, { color: colors.textDim }]}>
                Loading billing history...
              </Text>
            </View>
          ) : errorMessage ? (
            <View style={styles.centerContainer}>
              <Text style={[styles.errorText, { color: '#EF4444' }]}>{errorMessage}</Text>
              <TouchableOpacity
                onPress={loadData}
                style={[styles.retryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
              }
            >
              {/* CURRENT ACTIVE PLAN SUMMARY CARD */}
              <View
                style={[
                  styles.currentPlanCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isPaidActive ? '#22C55E' : isStarterLimitReached ? '#EF4444' : colors.accent,
                  },
                ]}
              >
                <View style={styles.currentPlanHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.currentPlanLabel, { color: colors.textDim }]}>
                      CURRENT PLAN STATUS
                    </Text>
                    <Text style={[styles.currentPlanName, { color: colors.text }]}>
                      {isPaidActive
                        ? subInfo?.subscription?.planName || 'StyleFleet Pro'
                        : isStarterLimitReached
                        ? 'Starter Limit Reached (100 Sales)'
                        : 'Free Starter Plan'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: isPaidActive
                          ? 'rgba(34, 197, 94, 0.15)'
                          : isStarterLimitReached
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(217, 164, 65, 0.15)',
                        borderColor: isPaidActive
                          ? '#22C55E'
                          : isStarterLimitReached
                          ? '#EF4444'
                          : colors.accent,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color: isPaidActive
                            ? '#22C55E'
                            : isStarterLimitReached
                            ? '#EF4444'
                            : colors.accent,
                        },
                      ]}
                    >
                      {isPaidActive
                        ? '✓ PRO ACTIVE'
                        : isStarterLimitReached
                        ? '⚠️ LIMIT REACHED'
                        : '⭐ FREE STARTER'}
                    </Text>
                  </View>
                </View>

                <View style={styles.validityRow}>
                  <ClockIcon size={14} color={colors.textDim} />
                  <Text style={[styles.validityText, { color: colors.textMuted }]}>
                    {isPaidActive
                      ? `Valid until ${subInfo?.subscription?.endDateFormatted} (${subInfo?.subscription?.remainingDays} days remaining)`
                      : isStarterLimitReached
                      ? '100 free sales limit reached. Upgrade to Pro for unlimited billing & appointments.'
                      : `${totalSalesCount}/${freeSalesLimit} free sales used • Free billing & appointments until ${freeSalesLimit} sales`}
                  </Text>
                </View>

                {onUpgradePlan && (
                  <TouchableOpacity
                    onPress={() => {
                      onClose();
                      onUpgradePlan();
                    }}
                    style={[styles.upgradeCardBtn, { backgroundColor: colors.accent }]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.upgradeCardBtnText}>
                      {isPaidActive ? 'Renew / Upgrade Plan →' : 'Upgrade to Pro →'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* SECTION TITLE: BILLING TRANSACTIONS */}
              <View style={styles.historySectionHeader}>
                <Text style={[styles.sectionHeading, { color: colors.accent }]}>
                  BILLING & PAYMENT INVOICES
                </Text>
                <Text style={[styles.sectionCount, { color: colors.textDim }]}>
                  {history.length} {history.length === 1 ? 'record' : 'records'}
                </Text>
              </View>

              {/* HISTORY LIST */}
              {history.map((record) => {
                const planConfig = getPlanById(record.plan_id);
                const planName = planConfig?.name || record.plan_id;
                const isItemActive = record.status === 'active';
                const formattedAmt =
                  record.amount_minor > 0
                    ? formatPriceInRupees(Math.round(record.amount_minor / 100))
                    : planConfig
                    ? formatPriceInRupees(planConfig.priceInRupees)
                    : '₹0';

                return (
                  <View
                    key={record.id}
                    style={[
                      styles.invoiceCard,
                      { backgroundColor: colors.surface, borderColor: colors.divider },
                    ]}
                  >
                    {/* Top Row: Plan & Badge */}
                    <View style={styles.invoiceTopRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.invoicePlanName, { color: colors.text }]}>
                          {planName}
                        </Text>
                        <Text style={[styles.invoiceOrderId, { color: colors.textDim }]}>
                          ID: {record.cashfree_order_id || record.id}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.invoiceBadge,
                          {
                            backgroundColor: isItemActive
                              ? 'rgba(34, 197, 94, 0.12)'
                              : 'rgba(156, 163, 175, 0.12)',
                            borderColor: isItemActive ? '#22C55E' : '#6B7280',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.invoiceBadgeText,
                            { color: isItemActive ? '#22C55E' : '#9CA3AF' },
                          ]}
                        >
                          {isItemActive ? 'ACTIVE' : 'COMPLETED'}
                        </Text>
                      </View>
                    </View>

                    {/* Middle Row: Amount & Date */}
                    <View style={styles.invoiceDetailsRow}>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailItemLabel, { color: colors.textDim }]}>
                          Amount Paid
                        </Text>
                        <Text style={[styles.detailItemValue, { color: colors.accent }]}>
                          {formattedAmt}
                        </Text>
                      </View>

                      <View style={styles.detailItem}>
                        <Text style={[styles.detailItemLabel, { color: colors.textDim }]}>
                          Payment Date
                        </Text>
                        <Text style={[styles.detailItemValue, { color: colors.text }]}>
                          {formatDateTime(record.created_at)}
                        </Text>
                      </View>
                    </View>

                    {/* Validity Period Bar */}
                    <View
                      style={[
                        styles.periodBox,
                        { backgroundColor: colors.bg, borderColor: colors.divider },
                      ]}
                    >
                      <Text style={[styles.periodBoxText, { color: colors.textDim }]}>
                        Validity:{' '}
                        <Text style={{ color: colors.text, fontWeight: '600' }}>
                          {formatDate(record.subscription_start_date || record.created_at)}
                        </Text>{' '}
                        →{' '}
                        <Text style={{ color: colors.text, fontWeight: '600' }}>
                          {formatDate(record.subscription_end_date)}
                        </Text>
                      </Text>
                    </View>
                  </View>
                );
              })}

              {/* FREE STARTER INITIAL RECORD (Always shown for audit transparency) */}
              <View
                style={[
                  styles.invoiceCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.divider,
                    opacity: 0.9,
                  },
                ]}
              >
                <View style={styles.invoiceTopRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.invoicePlanName, { color: colors.text }]}>
                      Free Starter Plan (100 Sales)
                    </Text>
                    <Text style={[styles.invoiceOrderId, { color: colors.textDim }]}>
                      Salon Registration Welcome Benefit
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.invoiceBadge,
                      {
                        backgroundColor: isPaidActive
                          ? 'rgba(156, 163, 175, 0.12)'
                          : isStarterLimitReached
                          ? 'rgba(239, 68, 68, 0.12)'
                          : 'rgba(217, 164, 65, 0.12)',
                        borderColor: isPaidActive
                          ? '#6B7280'
                          : isStarterLimitReached
                          ? '#EF4444'
                          : colors.accent,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.invoiceBadgeText,
                        {
                          color: isPaidActive
                            ? '#9CA3AF'
                            : isStarterLimitReached
                            ? '#EF4444'
                            : colors.accent,
                        },
                      ]}
                    >
                      {isPaidActive ? 'COMPLETED' : isStarterLimitReached ? 'LIMIT REACHED' : 'STARTER'}
                    </Text>
                  </View>
                </View>

                <View style={styles.invoiceDetailsRow}>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailItemLabel, { color: colors.textDim }]}>
                      Amount
                    </Text>
                    <Text style={[styles.detailItemValue, { color: '#22C55E' }]}>
                      ₹0 (Free)
                    </Text>
                  </View>

                  <View style={styles.detailItem}>
                    <Text style={[styles.detailItemLabel, { color: colors.textDim }]}>
                      Registration Date
                    </Text>
                    <Text style={[styles.detailItemValue, { color: colors.text }]}>
                      {formatDate(registrationDateIso)}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.periodBox,
                    { backgroundColor: colors.bg, borderColor: colors.divider },
                  ]}
                >
                  <Text style={[styles.periodBoxText, { color: colors.textDim }]}>
                    Plan Benefit:{' '}
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      Up to 100 free sales (billing & appointments)
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Footnote */}
              <Text style={[styles.footnote, { color: colors.textSubtle }]}>
                🔒 Official StyleFleet subscription payments are secured via Razorpay. Tax invoices are automatically registered to your salon account.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  container: {
    maxHeight: '90%',
    minHeight: '65%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 10,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  retryBtnText: {
    color: '#0D0F14',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  currentPlanCard: {
    borderRadius: radii.md,
    borderWidth: 1.5,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  currentPlanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  currentPlanLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  currentPlanName: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  validityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  validityText: {
    fontSize: 12,
    fontWeight: '500',
  },
  upgradeCardBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  upgradeCardBtnText: {
    color: '#0D0F14',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  invoiceCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 13,
    marginBottom: 10,
    ...shadows.sm,
  },
  invoiceTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  invoicePlanName: {
    fontSize: 15,
    fontWeight: '700',
  },
  invoiceOrderId: {
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  invoiceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  invoiceBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  invoiceDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 8,
  },
  detailItem: {
    flex: 1,
  },
  detailItemLabel: {
    fontSize: 10.5,
    marginBottom: 2,
  },
  detailItemValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  periodBox: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  periodBoxText: {
    fontSize: 11,
  },
  footnote: {
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 12,
  },
});
