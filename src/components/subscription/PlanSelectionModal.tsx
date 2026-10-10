import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radii } from '../../theme/spacing';
import { useLanguage } from '../../i18n/LanguageContext';
import { fmt, localeFor } from '../../i18n/format';
import {
  PlanId,
  SubscriptionPlanConfig,
  calculateSavingsPercent,
  calculateSavingsRupees,
  formatPriceInRupees,
  getSubscriptionPlans,
} from '../../config/planConfig';
import {
  isWithinFirst30DaysOfRegistration,
  getRemainingLaunchOfferDays,
  getLaunchOfferEndDate,
} from '../../utils/subscriptionUtils';
import { shopRepository } from '../../repositories/shopRepository';
import { subscriptionRepository } from '../../repositories/subscriptionRepository';
import { SparklesIcon } from '../common/SvgIcons';

interface PlanSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  shopId: string;
  ownerName: string;
  phone: string;
  initialPlanId?: PlanId;
  onPlanActivated: (planId: PlanId) => void;
  registrationDateIso?: string | null;
}

export const PlanSelectionModal: React.FC<PlanSelectionModalProps> = ({
  visible,
  onClose,
  shopId,
  ownerName,
  phone,
  initialPlanId,
  onPlanActivated,
  registrationDateIso,
}) => {
  const { colors } = useTheme();
  const { t, language } = useLanguage();

  const [resolvedRegDate, setResolvedRegDate] = useState<string | null>(registrationDateIso || null);

  useEffect(() => {
    if (registrationDateIso) {
      setResolvedRegDate(registrationDateIso);
    } else {
      shopRepository.getCachedShop().then((shop) => {
        if (shop?.created_at) {
          setResolvedRegDate(shop.created_at);
        }
      }).catch(() => {});
    }
  }, [registrationDateIso, visible]);

  const isLaunchOfferActive = useMemo(() => {
    return isWithinFirst30DaysOfRegistration(resolvedRegDate);
  }, [resolvedRegDate]);

  const remainingLaunchDays = useMemo(() => {
    return getRemainingLaunchOfferDays(resolvedRegDate);
  }, [resolvedRegDate]);

  const activePlans = useMemo(() => {
    return getSubscriptionPlans(isLaunchOfferActive);
  }, [isLaunchOfferActive]);

  // Default to initialPlanId or the 6-Month plan
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>(initialPlanId || '6_months');

  useEffect(() => {
    if (initialPlanId) {
      setSelectedPlanId(initialPlanId);
    }
  }, [initialPlanId, visible]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const selectedPlan =
    activePlans.find((p) => p.id === selectedPlanId) || activePlans[0];

  const verifyAndActivate = useCallback(
    async (orderIdToVerify: string) => {
      if (isVerifying) return;
      setIsVerifying(true);
      try {
        const verifyRes = await subscriptionRepository.verifyPaymentOrder({
          orderId: orderIdToVerify,
          shopId,
          planId: selectedPlanId,
          isLaunchOffer: isLaunchOfferActive,
        });

        if (verifyRes.success) {
          setPendingOrderId(null);
          Alert.alert(
            t('paymentSuccess', 'Payment Successful!'),
            `${selectedPlan.name} Premium is now active for your salon.`
          );
          onPlanActivated(selectedPlanId);
          onClose();
        } else {
          // Strictly do NOT activate plan - inform user payment is pending or incomplete
          Alert.alert(
            'Payment Pending or Incomplete',
            'Your payment was not completed or has not yet been confirmed by the bank. Your Free Trial remains active.'
          );
        }
      } catch (err: any) {
        Alert.alert('Payment Status', err.message || 'Could not verify payment');
      } finally {
        setIsVerifying(false);
      }
    },
    [isVerifying, shopId, selectedPlanId, isLaunchOfferActive, selectedPlan.name, onPlanActivated, onClose, t]
  );

  const handleProceedPayment = async () => {
    if (isProcessing || isVerifying) return;
    setIsProcessing(true);
    try {
      // 1. The server creates the order and decides the price
      const order = await subscriptionRepository.createPaymentOrder({
        shopId,
        planId: selectedPlanId,
        customerName: ownerName || 'Salon Owner',
        customerPhone: phone || '9999999999',
        isLaunchOffer: isLaunchOfferActive,
        registrationDateIso: resolvedRegDate || undefined,
      });
      setPendingOrderId(order.orderId);

      // 2. Razorpay's own payment screen opens inside the app
      try {
        await RazorpayCheckout.open({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'StyleFleet',
          description: `${selectedPlan.name} Premium`,
          prefill: {
            name: order.customer.name,
            contact: order.customer.phone,
            email: order.customer.email,
          },
          theme: { color: colors.accent },
        });
      } catch (checkoutError: any) {
        // Razorpay code 2 means the owner closed the payment screen: nothing was paid
        if (checkoutError?.code === 2) {
          setPendingOrderId(null);
          return;
        }
        Alert.alert(
          'Payment Gateway Notice',
          checkoutError?.description || 'The payment could not be completed. If money was deducted, tap "Verify & Activate".'
        );
        return;
      }

      // 3. Paid on the phone: the server confirms it with Razorpay before the plan turns on
      await verifyAndActivate(order.orderId);
    } catch (err: any) {
      Alert.alert(
        'Payment Gateway Notice',
        err.message || 'Unable to connect to the payment gateway. Please check your internet connection and try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const offerEndDate = useMemo(() => getLaunchOfferEndDate(resolvedRegDate), [resolvedRegDate]);
  const offerEndText = offerEndDate
    ? offerEndDate.toLocaleDateString(localeFor(language), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
  const daysLeftText =
    remainingLaunchDays <= 0
      ? t('plOfferEndsToday', 'Ends today')
      : remainingLaunchDays === 1
      ? fmt(t('plOfferDayLeft', '{n} day left'), { n: remainingLaunchDays })
      : fmt(t('plOfferDaysLeft', '{n} days left'), { n: remainingLaunchDays });

  const monthlyOf = (p: SubscriptionPlanConfig) => Math.round(p.price / p.durationMonths);
  const selectedSavings = calculateSavingsRupees(selectedPlan);

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View
            style={[
              styles.container,
              {
                backgroundColor: colors.bg,
                borderColor: colors.divider,
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.divider }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>
                  {t('choosePlan', 'Choose a Plan')}
                </Text>
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                  {t('selectSubscriptionPlan', 'Select a subscription plan for your salon')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.closeButton, { backgroundColor: colors.surface }]}
              >
                <Text style={{ color: colors.textMuted, fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Pending Verification Banner (shown when payment was opened in browser) */}
            {pendingOrderId ? (
              <View
                style={[
                  styles.pendingBanner,
                  {
                    backgroundColor: 'rgba(217, 164, 65, 0.12)',
                    borderColor: colors.accent,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  {isVerifying ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Text style={{ fontSize: 18 }}>💳</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pendingTitle, { color: colors.text }]}>
                      Payment started
                    </Text>
                    <Text style={[styles.pendingSub, { color: colors.textMuted }]}>
                      Already paid? Tap to check and activate.
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={isVerifying}
                  onPress={() => verifyAndActivate(pendingOrderId)}
                  style={[styles.verifyButton, { backgroundColor: colors.accent }]}
                >
                  <Text style={styles.verifyButtonText}>
                    {isVerifying ? 'Checking...' : 'Verify & Activate ✓'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {/* Launch offer banner, or the plain "regular price" note once the offer is over */}
              {isLaunchOfferActive ? (
                <View
                  style={[
                    styles.offerBanner,
                    { backgroundColor: colors.surface, borderColor: colors.accent },
                  ]}
                >
                  <View style={styles.offerBannerTop}>
                    <View style={styles.offerBannerTitleRow}>
                      <SparklesIcon size={16} color={colors.accent} />
                      <Text style={[styles.offerBannerTitle, { color: colors.accent }]}>
                        {t('plLaunchTitle', 'Launch offer')}
                      </Text>
                    </View>
                    <View style={[styles.daysLeftPill, { backgroundColor: colors.accent }]}>
                      <Text style={styles.daysLeftText}>{daysLeftText}</Text>
                    </View>
                  </View>
                  {offerEndText ? (
                    <Text style={[styles.offerEndsOn, { color: colors.text }]}>
                      {fmt(t('plOfferEndsOn', 'Offer ends on {date}'), { date: offerEndText })}
                    </Text>
                  ) : null}
                  <Text style={[styles.offerNote, { color: colors.textMuted }]}>
                    {t('plOfferNote', 'This offer is only for the first 30 days after you registered.')}
                  </Text>
                </View>
              ) : (
                <View style={[styles.regularNote, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                  <Text style={[styles.offerNote, { color: colors.textMuted }]}>
                    {t('plRegularNote', 'The 30-day launch offer has ended for your salon. Regular prices apply.')}
                  </Text>
                </View>
              )}

              {/* Plan cards */}
              {activePlans.map((plan: SubscriptionPlanConfig) => {
                const isSelected = plan.id === selectedPlanId;
                const savings = calculateSavingsRupees(plan);
                const percent = calculateSavingsPercent(plan);
                const badgeText =
                  savings > 0
                    ? plan.isBestValue
                      ? `${t('plBestValue', 'BEST VALUE')} · ${fmt(t('plSavePercent', 'Save {n}%'), { n: percent })}`
                      : fmt(t('plSavePercent', 'Save {n}%'), { n: percent })
                    : null;

                return (
                  <TouchableOpacity
                    key={plan.id}
                    activeOpacity={0.9}
                    onPress={() => setSelectedPlanId(plan.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.planCard,
                      {
                        backgroundColor: isSelected ? colors.accent900 : colors.surface,
                        borderColor: isSelected ? colors.accent : colors.divider,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    {badgeText && (
                      <View
                        style={[
                          styles.badgeTag,
                          { backgroundColor: plan.isBestValue ? colors.accent : '#22C55E' },
                        ]}
                      >
                        <Text style={styles.badgeText} numberOfLines={1}>
                          {badgeText}
                        </Text>
                      </View>
                    )}

                    <View style={styles.cardTop}>
                      <View
                        style={[styles.radioOuter, { borderColor: isSelected ? colors.accent : colors.divider }]}
                      >
                        {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
                      </View>

                      <View style={styles.planTitleContainer}>
                        <Text style={[styles.planName, { color: colors.text }]}>
                          {fmt(t('plMonths', '{n} Months'), { n: plan.durationMonths })}
                        </Text>
                        <Text style={[styles.planSubMuted, { color: colors.textMuted }]}>
                          {fmt(t('plAccessDays', '{n} days of access'), { n: plan.durationDays })}
                        </Text>
                      </View>

                      <View style={styles.priceContainer}>
                        <Text style={[styles.planPrice, { color: colors.text }]}>
                          {formatPriceInRupees(plan.priceInRupees)}
                        </Text>
                        {savings > 0 && (
                          <Text style={[styles.originalPrice, { color: colors.textDim }]}>
                            {formatPriceInRupees(plan.originalPrice)}
                          </Text>
                        )}
                      </View>
                    </View>

                    <View style={[styles.cardBottom, { borderTopColor: colors.divider }]}>
                      <Text style={[styles.perMonth, { color: colors.textMuted }]}>
                        {fmt(t('plPerMonth', '{amt} / month'), { amt: formatPriceInRupees(monthlyOf(plan)) })}
                      </Text>
                      {savings > 0 ? (
                        <View style={styles.savePill}>
                          <Text style={styles.savePillText}>
                            {fmt(t('plSaveAmount', 'You save {amt}'), { amt: formatPriceInRupees(savings) })}
                          </Text>
                        </View>
                      ) : isLaunchOfferActive ? (
                        <Text style={[styles.noOffer, { color: colors.textDim }]}>{t('plNoOffer', 'No offer')}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* What every plan includes, once, instead of repeating it on each card */}
              <View style={[styles.includesCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <Text style={[styles.includesTitle, { color: colors.textDim }]}>
                  {t('plIncludes', 'Every plan includes')}
                </Text>
                {[
                  t('unlimitedBillGen', 'Unlimited Bill Generation'),
                  t('unlimitedReports', 'Unlimited Report Downloads (PDF & Excel)'),
                  t('teamAndAccounts', 'Team Management & Stylist Commissions'),
                ].map((line) => (
                  <View key={line} style={styles.includeRow}>
                    <Text style={[styles.includeTick, { color: colors.accent }]}>✓</Text>
                    <Text style={[styles.includeText, { color: colors.text }]}>{line}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Footer: solid, always visible */}
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.divider,
                },
              ]}
            >
              <View style={styles.summaryRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>
                    {t('plTotal', 'Total')} · {fmt(t('plMonths', '{n} Months'), { n: selectedPlan.durationMonths })}
                  </Text>
                  <Text style={[styles.summaryTotal, { color: colors.text }]}>
                    {formatPriceInRupees(selectedPlan.priceInRupees)}
                  </Text>
                  {selectedSavings > 0 && (
                    <Text style={styles.summarySave}>
                      {fmt(t('plYouSaveTotal', 'You save {amt} with this plan'), {
                        amt: formatPriceInRupees(selectedSavings),
                      })}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={isProcessing || isVerifying}
                  onPress={handleProceedPayment}
                  style={[
                    styles.payButton,
                    {
                      backgroundColor: colors.accent,
                      opacity: isProcessing || isVerifying ? 0.7 : 1,
                    },
                  ]}
                >
                  {isProcessing ? (
                    <ActivityIndicator color="#0D0F14" size="small" />
                  ) : (
                    <Text style={styles.payButtonText}>{t('proceedToPayment', 'Proceed to Payment')} →</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Cashfree Security Trust Badge */}
              <View style={styles.trustBadgeContainer}>
                <Text style={[styles.trustBadgeText, { color: colors.textDim }]}>
                  🔒 {t('securedByRazorpay', '100% Secure Checkout powered by Razorpay')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  pendingSub: {
    fontSize: 11,
    marginTop: 2,
  },
  verifyButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  verifyButtonText: {
    color: '#0D0F14',
    fontSize: 12,
    fontWeight: '800',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  offerBanner: {
    borderRadius: radii.md,
    borderWidth: 1.5,
    padding: spacing.md,
    gap: 6,
  },
  offerBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  offerBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  offerBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 1,
  },
  daysLeftPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  daysLeftText: {
    color: '#0D0F14',
    fontSize: 12,
    fontWeight: '800',
  },
  offerEndsOn: {
    fontSize: 14,
    fontWeight: '700',
  },
  offerNote: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  regularNote: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  planCard: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    position: 'relative',
    overflow: 'hidden',
  },
  badgeTag: {
    position: 'absolute',
    top: 0,
    right: 0,
    maxWidth: '70%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: radii.sm,
  },
  badgeText: {
    color: '#0D0F14',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  planTitleContainer: {
    flex: 1,
  },
  planName: {
    fontSize: 17,
    fontWeight: '800',
  },
  planSubMuted: {
    fontSize: 12,
    marginTop: 2,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  planPrice: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  originalPrice: {
    fontSize: 13,
    marginTop: 1,
    textDecorationLine: 'line-through',
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  perMonth: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  savePill: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  savePillText: {
    color: '#22C55E',
    fontSize: 13.5,
    fontWeight: '800',
  },
  noOffer: {
    fontSize: 13,
    fontWeight: '600',
  },
  includesCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: 8,
  },
  includesTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  includeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  includeTick: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  includeText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  summaryLabel: {
    fontSize: 12.5,
  },
  summaryTotal: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  summarySave: {
    color: '#22C55E',
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 1,
  },
  payButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonText: {
    color: '#0D0F14',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  trustBadgeContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  trustBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
