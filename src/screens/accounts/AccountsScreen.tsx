import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Keyboard,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../../i18n/translations';
import { Period, Bill, Expense, SocialLinks, StylistPermissions } from '../../types/domain';
import { financialService } from '../../services/financialService';
import { fmt } from '../../i18n/format';
import { inrFromMinor } from '../../utils/format';
import { supportRepository, SupportMessageAnswer } from '../../repositories/supportRepository';
import { shopRepository } from '../../repositories/shopRepository';
import { appReviewService } from '../../services/appReviewService';
import {
  WalletIcon,
  CalendarIcon,
  BellIcon,
  ChatIcon,
  UsersIcon,
  TagIcon,
  StoreIcon,
  ChartIcon,
  StarIcon,
  SparklesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  EditIcon,
  TrashIcon,
  InstagramIcon,
  FacebookIcon,
  YouTubeIcon,
  WebsiteIcon,
} from '../../components/common/SvgIcons';
import { ChangePhoneModal } from '../../components/accounts/ChangePhoneModal';
import { radii } from '../../theme/spacing';
import { PlanStatusCard } from '../../components/subscription/PlanStatusCard';
import { usePullRefresh } from '../../hooks/usePullRefresh';

interface AccountsScreenProps {
  onRefresh?: () => Promise<void>;
  openRemindersCount: number;
  bills?: Bill[];
  expenses?: Expense[];
  shopId?: string;
  shopName?: string;
  userPhone?: string;
  userId?: string;
  currentUserRole?: 'owner' | 'stylist';
  stylistPermissions?: StylistPermissions | null;
  initialSocialLinks?: SocialLinks | null;
  onUpdateSocialLinks?: (links: SocialLinks) => Promise<void>;
  onNavigate: (
    screen:
      | 'expenses'
      | 'appointments'
      | 'reminders'
      | 'bulk'
      | 'staff'
      | 'pricing'
      | 'profile'
      | 'reports'
  ) => void;
  onUpgradePlan?: () => void;
  /** Plan status for the "Your plan" card (owners only) */
  isPro?: boolean;
  /** How many sales the salon has created in total (what the free limit counts, including deleted ones) */
  planSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  onAccountDeleted?: () => void;
  onSignOut?: () => void;
  onPhoneUpdated?: (newPhone: string) => void;
}

export const AccountsScreen = ({
  onRefresh,
  openRemindersCount,
  bills = [],
  expenses = [],
  shopId = '',
  shopName = 'My Salon',
  userPhone = '',
  userId,
  currentUserRole = 'owner',
  stylistPermissions = null,
  initialSocialLinks = null,
  onUpdateSocialLinks,
  onNavigate,
  onUpgradePlan,
  isPro = false,
  planSalesCount = 0,
  freeSalesLimit,
  onAccountDeleted,
  onSignOut,
  onPhoneUpdated,
}: AccountsScreenProps) => {
  const pullRefresh = usePullRefresh(onRefresh);
  const { colors } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [period, setPeriod] = useState<Period>('Day');

  // Modals state
  const [showLangModal, setShowLangModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChangePhoneModal, setShowChangePhoneModal] = useState(false);
  const [activeUserPhone, setActiveUserPhone] = useState(userPhone);

  useEffect(() => {
    setActiveUserPhone(userPhone);
  }, [userPhone]);

  const [selectedDeleteReason, setSelectedDeleteReason] = useState('Closing or Pausing Salon Business');
  const [deleteCustomNote, setDeleteCustomNote] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountMgmtExpanded, setAccountMgmtExpanded] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleOpenPrivacyPolicy = async () => {
    const url = 'https://www.tecstellar.com/privacy-policy';
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        setShowPrivacyModal(true);
      }
    } catch {
      setShowPrivacyModal(true);
    }
  };

  // Social Media Links State (Moved to Settings & Help)
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(initialSocialLinks || {});
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<keyof SocialLinks | null>(null);
  const [platformUrlInput, setPlatformUrlInput] = useState('');
  const [isSavingSocial, setIsSavingSocial] = useState(false);
  const [socialActionMenuPlatform, setSocialActionMenuPlatform] = useState<keyof SocialLinks | null>(null);

  useEffect(() => {
    if (initialSocialLinks) {
      setSocialLinks(initialSocialLinks);
    }
  }, [initialSocialLinks]);

  const activeSocialCount = Object.values(socialLinks || {}).filter(
    (v) => typeof v === 'string' && (v as string).trim().length > 0
  ).length;

  const handleStartEditLink = (platform: keyof SocialLinks, currentUrl: string) => {
    setEditingPlatform(platform);
    setPlatformUrlInput(currentUrl);
  };

  const handleSaveSingleLink = async (platform: keyof SocialLinks, url: string) => {
    if (!shopId) return;
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert('URL Required', 'Please enter a valid link/URL.');
      return;
    }
    setIsSavingSocial(true);
    try {
      const updated: SocialLinks = { ...socialLinks, [platform]: trimmed };
      await shopRepository.updateShop(shopId, {
        social_links: updated as any,
      });
      setSocialLinks(updated);
      if (onUpdateSocialLinks) {
        await onUpdateSocialLinks(updated);
      }
      setEditingPlatform(null);
      setPlatformUrlInput('');
      Alert.alert('Link Saved', `${platform.toUpperCase()} link has been saved to database.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save link');
    } finally {
      setIsSavingSocial(false);
    }
  };

  const handleDeleteSingleLink = (platform: keyof SocialLinks) => {
    if (!shopId) return;
    Alert.alert(
      t('deleteLink', 'Delete Link'),
      t('confirmDeleteLink', 'Are you sure you want to delete this link?'),
      [
        { text: t('cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('delete', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            setIsSavingSocial(true);
            try {
              const updated: SocialLinks = { ...socialLinks };
              delete updated[platform];
              await shopRepository.updateShop(shopId, {
                social_links: updated as any,
              });
              setSocialLinks(updated);
              if (onUpdateSocialLinks) {
                await onUpdateSocialLinks(updated);
              }
              if (editingPlatform === platform) {
                setEditingPlatform(null);
                setPlatformUrlInput('');
              }
              Alert.alert('Link Deleted', t('linkDeleted', 'Link deleted successfully'));
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not delete link');
            } finally {
              setIsSavingSocial(false);
            }
          },
        },
      ]
    );
  };

  const handleAppReview = async () => {
    try {
      await appReviewService.openAppReview();
    } catch {
      Alert.alert('Store Notice', 'Opening StyleFleet store listing...');
    }
  };

  // Support ticket form
  const [supportMessage, setSupportMessage] = useState('');
  const [supportContact, setSupportContact] = useState(userPhone);
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [supportAnswers, setSupportAnswers] = useState<SupportMessageAnswer[]>([]);

  const handlePermanentDelete = async () => {
    setIsDeleting(true);
    try {
      const fullReason = deleteCustomNote.trim()
        ? `${selectedDeleteReason} - ${deleteCustomNote.trim()}`
        : selectedDeleteReason;

      await supportRepository.permanentlyDeleteAccount({
        shopId,
        shopName,
        phone: userPhone,
        reason: fullReason,
      });
      setIsDeleting(false);
      setShowDeleteModal(false);
      Alert.alert(
        'Account Permanently Deleted',
        'All your salon data and business records have been completely wiped from the database. You will need to register again if you wish to use StyleFleet.',
        [
          {
            text: 'OK',
            onPress: () => {
              if (onAccountDeleted) onAccountDeleted();
            },
          },
        ]
      );
    } catch (e: any) {
      setIsDeleting(false);
      Alert.alert('Error', e.message || 'Failed to delete account');
    }
  };

  useEffect(() => {
    if (showSupportModal && shopId) {
      supportRepository.getSupportMessageAnswers(shopId).then((ans) => {
        setSupportAnswers(ans);
      });
    }
  }, [showSupportModal, shopId]);

  const pnl = financialService.getPnLMetrics(period, bills, expenses);
  const totalSalesCount = useMemo(() => {
    return bills.filter((b) => !(b as any).is_deleted).length;
  }, [bills]);

  const deleteWarningText = t(
    'deleteAccountWarning',
    'Deleting your account will permanently wipe all bills, clients, staff records, service catalogs, and history for "{shopName}" from the Supabase database.'
  ).replace('{shopName}', shopName);

  const tools = [
    {
      id: 'expenses' as const,
      label: t('expenses'),
      sub: t('expensesSub', 'Log & categorise'),
      icon: <WalletIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'expenses' as const,
    },
    {
      id: 'appointments' as const,
      label: t('appointments'),
      sub: t('appointmentsSub', 'Day agenda'),
      icon: <CalendarIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'appointments' as const,
    },
    {
      id: 'reminders' as const,
      label: t('reminders'),
      sub: t('remindersSub', 'Auto & manual'),
      icon: <BellIcon size={20} color={colors.accent} />,
      badge: openRemindersCount > 0 ? String(openRemindersCount) : '',
      moduleKey: 'reminders' as const,
    },
    {
      id: 'bulk' as const,
      label: t('whatsApp', 'WhatsApp'),
      sub: t('whatsAppSub', 'Offers & ads'),
      icon: <ChatIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'reminders' as const,
    },
    {
      id: 'staff' as const,
      label: t('team'),
      sub: t('staffSub', 'Who delivers what'),
      icon: <UsersIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'team' as const,
    },
    {
      id: 'pricing' as const,
      label: t('priceList', 'Price List'),
      sub: t('priceListSub', 'Manage services & pricing'),
      icon: <TagIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: null,
    },
    {
      id: 'reports' as const,
      label: t('reports', 'Reports'),
      sub: t('reportsSub', 'Export PDF & Excel'),
      icon: <ChartIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'reports' as const,
    },
    {
      id: 'profile' as const,
      label: t('shopProfile'),
      sub: t('profileSub', 'Logo, theme, GST'),
      icon: <StoreIcon size={20} color={colors.accent} />,
      badge: '',
      moduleKey: 'profile' as const,
    },
  ].filter((tool) => {
    if (currentUserRole === 'stylist' && stylistPermissions && tool.moduleKey) {
      return stylistPermissions[tool.moduleKey] !== false;
    }
    return true;
  });

  const handleSendSupportTicket = async () => {
    if (!supportMessage.trim()) {
      Alert.alert('Required', 'Please enter your message or question.');
      return;
    }
    setIsSubmittingTicket(true);
    try {
      await supportRepository.submitSupportMessage({
        shop_id: shopId,
        message: supportMessage.trim(),
        contact_info: supportContact.trim(),
      });
      setIsSubmittingTicket(false);
      setSupportMessage('');
      setShowSupportModal(false);
      Alert.alert(
        'Ticket Submitted',
        'Your support request has been logged in Supabase. Our team will review it shortly.'
      );
    } catch (err: any) {
      setIsSubmittingTicket(false);
      Alert.alert('Error', err.message || 'Failed to submit support ticket.');
    }
  };



  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const cardBorderColor = colors.isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)';
  const cardBorderWidth = colors.isDark ? 1.2 : 1.5;

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{t('accounts')}</Text>
          <Text style={[styles.todayLabel, { color: colors.textDim }]}>{todayStr}</Text>
        </View>

        <View style={[styles.periodTabsRow, { borderColor: colors.divider }]}>
          {(['Day', 'Week', 'Month'] as const).map((p) => {
            const isSelected = period === p;
            return (
              <TouchableOpacity
                key={p}
                activeOpacity={0.8}
                onPress={() => setPeriod(p)}
                style={[
                  styles.periodTab,
                  {
                    backgroundColor: isSelected ? colors.surface : 'transparent',
                    borderRightWidth: p !== 'Month' ? 1 : 0,
                    borderRightColor: colors.divider,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.periodTabText,
                    {
                      color: isSelected ? colors.text : colors.textDim,
                      fontWeight: isSelected ? '600' : '400',
                    },
                  ]}
                >
                  {p === 'Day' ? t('today', 'Today') : p === 'Week' ? t('week') : t('month')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} refreshControl={pullRefresh}>
        {/* Net Profit Summary */}
        <View style={styles.pnlHeaderRow}>
          <View>
            <Text style={[styles.pnlSubLabel, { color: colors.textDim }]}>
              {period === 'Day' ? `${t('today')} · ${t('netProfit')}` : `${period === 'Week' ? t('week') : t('month')} · ${t('netProfit')}`}
            </Text>
            <Text
              style={[
                styles.pnlMainAmt,
                { color: pnl.net_minor >= 0 ? colors.accent : colors.error },
              ]}
            >
              {inrFromMinor(pnl.net_minor)}
            </Text>
          </View>
          <View style={styles.pnlMarginBadge}>
            <Text style={[styles.pnlMarginText, { color: colors.accent200 }]}>
              {pnl.margin_pct}% {t('marginLabel', 'margin')}
            </Text>
          </View>
        </View>

        {/* Income vs Expenses Cards */}
        <View style={styles.twoColCards}>
          <View
            style={[
              styles.statCard,
              {
                ...getGlass(colors.isDark).card,
                borderColor: cardBorderColor,
                borderWidth: cardBorderWidth,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.textDim }]}>{t('totalIncome')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.text }]}>
              {inrFromMinor(pnl.income_minor)}
            </Text>
            <Text style={[styles.statSub, { color: colors.textMuted }]}>
              {bills.length} bills
            </Text>
          </View>

          <View
            style={[
              styles.statCard,
              {
                ...getGlass(colors.isDark).card,
                borderColor: cardBorderColor,
                borderWidth: cardBorderWidth,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.textDim }]}>{t('totalExpenses')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.error }]}>
              {inrFromMinor(pnl.expense_minor)}
            </Text>
            <Text style={[styles.statSub, { color: colors.textMuted }]}>
              {expenses.length} entries
              {pnl.excluded_minor > 0
                ? ` · ${fmt(t('exNotCounted', '{amt} not counted in profit'), { amt: inrFromMinor(pnl.excluded_minor) })}`
                : ''}
            </Text>
          </View>
        </View>

        {/* Where the money went (Expenses breakdown) */}
        {pnl.categories.length > 0 ? (
          <View style={[styles.card, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.cardHeader, { color: colors.textDim }]}>
              {t('whereMoneyWent', 'WHERE THE MONEY WENT')}
            </Text>
            {pnl.categories.map((c, i) => (
              <View key={i} style={styles.expenseCatItem}>
                <View style={styles.expenseCatLabelRow}>
                  <Text style={[styles.expenseCatName, { color: colors.text }]}>{c.label}</Text>
                  <Text style={[styles.expenseCatAmt, { color: colors.textMuted }]}>
                    {inrFromMinor(c.amt_minor)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.expenseCatProgressTrack,
                    { backgroundColor: 'rgba(255,255,255,0.1)' },
                  ]}
                >
                  <View
                    style={[
                      styles.expenseCatProgressFill,
                      {
                        width: `${c.pct}%`,
                        backgroundColor: i === 0 ? colors.accent : colors.accent700,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Outstanding Dues Card */}
        {pnl.dues_minor > 0 ? (
          <View style={[styles.duesCard, { backgroundColor: colors.accent900 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.duesLabel, { color: colors.accent200 }]}>
                {t('outstandingDues')}
              </Text>
              <Text style={[styles.duesAmount, { color: colors.accent100 }]}>
                {inrFromMinor(pnl.dues_minor)}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.chaseButton, { backgroundColor: colors.accent800 }]}
              onPress={() => onNavigate('reminders')}
              activeOpacity={0.8}
            >
              <Text style={[styles.chaseButtonText, { color: colors.accent100 }]}>Chase</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Your plan: owners only, since only the owner can upgrade */}
        {onUpgradePlan && currentUserRole !== 'stylist' ? (
          <PlanStatusCard isPro={isPro} totalSalesCount={planSalesCount} freeSalesLimit={freeSalesLimit} onUpgrade={onUpgradePlan} />
        ) : null}

        {/* Manage Tools Header */}
        <Text style={[styles.manageTitle, { color: colors.textDim }]}>
          {t('operationsAndTools', 'OPERATIONS & TOOLS')}
        </Text>


        {/* Operations & Tools: Compact 4x2 Grid (Wordings on Left, Icon on Right) */}
        <View style={styles.toolsGrid}>
          {tools.map((t) => (
            <TouchableOpacity
              key={t.id}
              activeOpacity={0.75}
              onPress={() => onNavigate(t.id)}
              style={[
                styles.toolCard,
                {
                  ...getGlass(colors.isDark).card,
                  borderColor: cardBorderColor,
                  borderWidth: cardBorderWidth,
                },
              ]}
            >
              <View
                style={[
                  styles.toolIconContainer,
                  {
                    backgroundColor: colors.isDark ? 'rgba(217, 119, 6, 0.12)' : 'rgba(217, 119, 6, 0.08)',
                    borderColor: colors.isDark ? 'rgba(217, 119, 6, 0.25)' : 'rgba(217, 119, 6, 0.18)',
                  },
                ]}
              >
                {t.icon}
                {t.badge ? (
                  <View style={[styles.toolBadgeFloat, { backgroundColor: colors.accent }]}>
                    <Text style={styles.toolBadgeFloatText}>{t.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={2} style={[styles.toolTitle, { color: colors.text, flex: 1 }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ======================================================== */}
        {/* NEW SETTINGS & SUPPORT BOX (Per user explicit request)     */}
        {/* ======================================================== */}
        <Text style={[styles.manageTitle, { color: colors.textDim, marginTop: 24 }]}>
          {t('settingsAndHelp')}
        </Text>

        <View style={[styles.settingsBox, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          {/* App Language */}
          <TouchableOpacity
            style={[styles.settingsRow, { borderBottomColor: colors.divider }]}
            onPress={() => setShowLangModal(true)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text numberOfLines={2} style={[styles.settingsRowTitle, { color: colors.text }]}>{t('appLanguage')}</Text>
              <Text numberOfLines={2} style={[styles.settingsRowSub, { color: colors.accent }]}>
                {SUPPORTED_LANGUAGES.find((l) => l.code === language)?.nativeLabel || 'English'}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          {/* Social Media Links */}
          <TouchableOpacity
            style={[styles.settingsRow, { borderBottomColor: colors.divider }]}
            onPress={() => setShowSocialModal(true)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text numberOfLines={2} style={[styles.settingsRowTitle, { color: colors.text }]}>
                {t('socialLinks', 'Social Media Links')}
              </Text>
              <Text numberOfLines={2} style={[styles.settingsRowSub, { color: activeSocialCount > 0 ? colors.accent : colors.textDim }]}>
                {activeSocialCount > 0
                  ? `${activeSocialCount} ${t('linksAdded', 'links added')}`
                  : t('socialLinksSub', 'Add Instagram, Facebook, YouTube, Website')}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          {/* App Review & Feedback */}
          <TouchableOpacity
            style={[styles.settingsRow, { borderBottomColor: colors.divider }]}
            onPress={handleAppReview}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text numberOfLines={2} style={[styles.settingsRowTitle, { color: colors.text }]}>
                {t('appReview', 'Rate & Review StyleFleet')}
              </Text>
              <Text numberOfLines={2} style={[styles.settingsRowSub, { color: colors.textDim }]}>
                {t('appReviewSub', 'Share your experience on Play Store / App Store')}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          {/* Help Desk Support */}
          <TouchableOpacity
            style={[styles.settingsRow, { borderBottomColor: colors.divider }]}
            onPress={() => setShowSupportModal(true)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text numberOfLines={2} style={[styles.settingsRowTitle, { color: colors.text }]}>
                {t('helpDesk')}
              </Text>
              <Text numberOfLines={2} style={[styles.settingsRowSub, { color: colors.textDim }]}>
                {t('helpDeskSub', 'Submit an inquiry or view answers from support')}
              </Text>
            </View>
            <View style={[styles.supportBadge, { backgroundColor: colors.accent800 }]}>
              <Text style={[styles.supportBadgeText, { color: colors.accent100 }]}>Support</Text>
            </View>
          </TouchableOpacity>

          {/* Expandable Account Management Section */}
          <TouchableOpacity
            style={[
              styles.settingsRow,
              {
                borderBottomColor: colors.divider,
                borderBottomWidth: accountMgmtExpanded ? 0 : 1,
              },
            ]}
            onPress={() => setAccountMgmtExpanded((prev) => !prev)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text numberOfLines={2} style={[styles.settingsRowTitle, { color: colors.text, fontWeight: '600' }]}>
                {t('accountManagement', 'Account Management')}
              </Text>
              <Text numberOfLines={2} style={[styles.settingsRowSub, { color: colors.textDim }]}>
                {t('accountManagementSub', 'Privacy policy, FAQ, sign out & account closure')}
              </Text>
            </View>
            {accountMgmtExpanded ? (
              <ChevronDownIcon size={18} color={colors.accent} />
            ) : (
              <ChevronRightIcon size={18} color={colors.accent} />
            )}
          </TouchableOpacity>

          {/* Nested Account Management Items */}
          {accountMgmtExpanded && (
            <View style={[styles.nestedAccountBox, { backgroundColor: colors.bg, borderColor: colors.divider }]}>
              {/* 1. Privacy Policy (In-App) */}
              <TouchableOpacity
                style={[styles.nestedRow, { borderBottomColor: colors.divider }]}
                onPress={() => setShowPrivacyModal(true)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text numberOfLines={3} style={[styles.nestedRowTitle, { color: colors.text }]}>
                    {t('privacyPolicy', 'Privacy Policy')}
                  </Text>
                  <Text numberOfLines={3} style={[styles.nestedRowSub, { color: colors.textDim }]}>
                    {t('privacyPolicySub', 'Customer data privacy and security terms')}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 16 }}>›</Text>
              </TouchableOpacity>

              {/* 2. FAQ */}
              <TouchableOpacity
                style={[styles.nestedRow, { borderBottomColor: colors.divider }]}
                onPress={() => setShowFaqModal(true)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text numberOfLines={3} style={[styles.nestedRowTitle, { color: colors.text }]}>
                    {t('faq', 'Frequently Asked Questions (FAQ)')}
                  </Text>
                  <Text numberOfLines={3} style={[styles.nestedRowSub, { color: colors.textDim }]}>
                    {t('faqSub', 'Billing, backups, GST and staff queries')}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
              </TouchableOpacity>

              {/* Change Phone Number */}
              <TouchableOpacity
                style={[styles.nestedRow, { borderBottomColor: colors.divider }]}
                onPress={() => setShowChangePhoneModal(true)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text numberOfLines={3} style={[styles.nestedRowTitle, { color: colors.text }]}>
                    {t('changePhoneNumber', 'Change Phone Number')}
                  </Text>
                  <Text numberOfLines={3} style={[styles.nestedRowSub, { color: colors.textDim }]}>
                    {t('changePhoneNumberSub', 'Verify with OTP and update account mobile number')}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
              </TouchableOpacity>

              {/* 3. Sign Out */}
              {onSignOut && (
                <TouchableOpacity
                  style={[styles.nestedRow, { borderBottomColor: colors.divider }]}
                  onPress={() => {
                    Alert.alert(
                      t('signOut', 'Sign out'),
                      'Are you sure you want to sign out from your salon account?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: t('signOut', 'Sign out'),
                          style: 'destructive',
                          onPress: onSignOut,
                        },
                      ]
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text numberOfLines={3} style={[styles.nestedRowTitle, { color: colors.text }]}>
                      {t('signOut', 'Sign out')}
                    </Text>
                    <Text numberOfLines={3} style={[styles.nestedRowSub, { color: colors.textDim }]}>
                      {t('signOutSub', 'Exit session on this device')}
                    </Text>
                  </View>
                  <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              )}

              {/* 4. Permanently Delete Account */}
              <TouchableOpacity
                style={[styles.nestedRow, { borderBottomWidth: 0, backgroundColor: 'rgba(255, 59, 48, 0.05)' }]}
                onPress={() => setShowDeleteModal(true)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text numberOfLines={3} style={[styles.nestedRowTitle, { color: colors.error }]}>
                    {t('deleteAccount', 'Permanently Delete Account')}
                  </Text>
                  <Text numberOfLines={3} style={[styles.nestedRowSub, { color: colors.textDim }]}>
                    {t('deleteAccountSub', 'Wipe salon database records and close account')}
                  </Text>
                </View>
                <Text style={{ color: colors.error, fontSize: 18 }}>›</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ---------------------------------------------------- */}
      {/* 1. PRIVACY POLICY MODAL                              */}
      {/* ---------------------------------------------------- */}
      <Modal visible={showPrivacyModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Privacy Policy</Text>
              <TouchableOpacity onPress={() => setShowPrivacyModal(false)}>
                <Text style={{ color: colors.accent, fontSize: 16 }}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400, marginTop: 12 }}>
              <Text style={[styles.policyText, { color: colors.textMuted }]}>
                Salon OS is committed to protecting the confidentiality and privacy of salon owners and
                their clients. All customer records, phone numbers, visit histories, and financial transactions
                are stored exclusively in dedicated, Row-Level-Security (RLS) protected Supabase PostgreSQL databases.
                {'\n\n'}
                1. Data Ownership: You retain 100% ownership of your business and customer data. We never sell,
                rent, or share customer contact lists with third parties.
                {'\n\n'}
                2. Security & Encryption: Data in transit is protected using TLS 1.3 encryption. Passwords and
                session tokens are managed via secure Supabase authentication.
                {'\n\n'}
                3. Permanent Erasure: At any time, salon owners may exercise their right to be forgotten and
                permanently delete their account and associated data.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ---------------------------------------------------- */}
      {/* 2. FAQ MODAL                                         */}
      {/* ---------------------------------------------------- */}
      <Modal visible={showFaqModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Frequently Asked Questions</Text>
              <TouchableOpacity onPress={() => setShowFaqModal(false)}>
                <Text style={{ color: colors.accent, fontSize: 16 }}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400, marginTop: 12 }}>
              <View style={styles.faqItem}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>
                  Q: Where is my salon data saved?
                </Text>
                <Text style={[styles.faqAnswer, { color: colors.textMuted }]}>
                  All records including bills, customers, team members, and expenses are saved directly to your
                  secure cloud Supabase database, with offline-first synchronization.
                </Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>
                  Q: How do WhatsApp receipts work?
                </Text>
                <Text style={[styles.faqAnswer, { color: colors.textMuted }]}>
                  Upon generating an invoice, tap 'Share via WhatsApp' to open a pre-formatted itemized receipt
                  ready to be dispatched directly to your client.
                </Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>
                  Q: How do I adjust staff commissions?
                </Text>
                <Text style={[styles.faqAnswer, { color: colors.textMuted }]}>
                  Go to Accounts &gt; Team to manage individual roles, active statuses, and service delivery metrics.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ---------------------------------------------------- */}
      {/* 3. HELP DESK SUPPORT MODAL (Stores in support_messages)*/}
      {/* ---------------------------------------------------- */}
      <Modal visible={showSupportModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setShowSupportModal(false)}
            />
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'center',
                paddingBottom: Math.max(20, keyboardHeight + 20),
              }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={true}
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Help Desk Support</Text>
                  <TouchableOpacity onPress={() => setShowSupportModal(false)}>
                    <Text style={{ color: colors.accent, fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.modalSub, { color: colors.textDim }]}>
                  Enter your query or technical issue below. It will be recorded into our Supabase support desk.
                </Text>

                {supportAnswers.length > 0 && (
                  <View style={{ marginVertical: 10 }}>
                    <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                      💬 Replies from Support ({supportAnswers.length})
                    </Text>
                    {supportAnswers.slice(0, 3).map((a) => (
                      <View
                        key={a.id}
                        style={{
                          backgroundColor: colors.bg,
                          borderRadius: radii.sm,
                          borderWidth: 1,
                          borderColor: a.is_read ? colors.divider : colors.accent,
                          padding: 10,
                          marginBottom: 6,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                          <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
                            {a.admin_name || 'StyleFleet Support'}
                          </Text>
                          {!a.is_read && (
                            <TouchableOpacity
                              onPress={async () => {
                                await supportRepository.markAnswerAsRead(shopId, a.id);
                                setSupportAnswers((prev) =>
                                  prev.map((item) => (item.id === a.id ? { ...item, is_read: true } : item))
                                );
                              }}
                            >
                              <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '600' }}>
                                Mark Read ✓
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <Text style={{ color: colors.text, fontSize: 12 }}>{a.answer}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <TextInput
                  style={[
                    styles.ticketInput,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.divider,
                      color: colors.text,
                    },
                  ]}
                  multiline
                  numberOfLines={4}
                  placeholder="Describe your issue or question in detail..."
                  placeholderTextColor={colors.textDim}
                  value={supportMessage}
                  onChangeText={setSupportMessage}
                />

                <TextInput
                  style={[
                    styles.contactInput,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.divider,
                      color: colors.text,
                    },
                  ]}
                  placeholder="Your contact phone or email (optional)"
                  placeholderTextColor={colors.textDim}
                  value={supportContact}
                  onChangeText={setSupportContact}
                />

                <TouchableOpacity
                  style={[styles.primaryModalButton, { backgroundColor: colors.accent }]}
                  onPress={handleSendSupportTicket}
                  disabled={isSubmittingTicket}
                  activeOpacity={0.8}
                >
                  {isSubmittingTicket ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={styles.primaryModalButtonText}>Submit Support Ticket</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>



      {/* ---------------------------------------------------- */}
      {/* 5. APP LANGUAGE MODAL                                */}
      {/* ---------------------------------------------------- */}
      <Modal visible={showLangModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select App Language</Text>
              <TouchableOpacity onPress={() => setShowLangModal(false)}>
                <Text style={{ color: colors.accent, fontSize: 16 }}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={{ marginTop: 12 }}>
              {SUPPORTED_LANGUAGES.map((l) => {
                const isSelected = language === l.code;
                return (
                  <TouchableOpacity
                    key={l.code}
                    onPress={async () => {
                      await setLanguage(l.code);
                      setShowLangModal(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 11,
                      paddingHorizontal: 12,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.accent : colors.divider,
                      backgroundColor: isSelected ? colors.accent900 : 'transparent',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: isSelected ? '600' : '400' }}>
                      {l.nativeLabel}
                    </Text>
                    <Text style={{ color: colors.textDim, fontSize: 13, marginLeft: 8 }}>
                      ({l.label})
                    </Text>
                    {isSelected && (
                      <Text style={{ color: colors.accent, marginLeft: 'auto', fontWeight: 'bold' }}>✓</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------------------------------------------------- */}
      {/* SOCIAL MEDIA LINKS MODAL (Settings & Help)           */}
      {/* ---------------------------------------------------- */}
      <Modal visible={showSocialModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => {
                setShowSocialModal(false);
                setEditingPlatform(null);
                setSocialActionMenuPlatform(null);
              }}
            />
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    {t('socialLinks', 'Social Media Links')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowSocialModal(false);
                      setEditingPlatform(null);
                      setSocialActionMenuPlatform(null);
                    }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 16 }}>{t('done', 'Done')}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.modalSub, { color: colors.textDim }]}>
                  {t(
                    'socialLinksSub',
                    'Add your salon’s social links to automatically feature them on customer WhatsApp bills. All fields are optional.'
                  )}
                </Text>

                {/* Platforms List */}
                {[
                  { key: 'instagram' as const, label: 'Instagram', placeholder: 'https://instagram.com/yoursalon' },
                  { key: 'facebook' as const, label: 'Facebook', placeholder: 'https://facebook.com/yoursalon' },
                  { key: 'youtube' as const, label: 'YouTube', placeholder: 'https://youtube.com/@yoursalon' },
                  { key: 'website' as const, label: 'Website', placeholder: 'https://yoursalon.com' },
                ].map((item) => {
                  const currentLink = socialLinks[item.key] || '';
                  const hasLink = currentLink.trim().length > 0;
                  const isEditingThis = editingPlatform === item.key;

                  return (
                    <View
                      key={item.key}
                      style={{
                        backgroundColor: colors.bg,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: isEditingThis ? colors.accent : colors.divider,
                        padding: 12,
                        marginBottom: 10,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                          <View
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 17,
                              ...getGlass(colors.isDark).card,
                              justifyContent: 'center',
                              alignItems: 'center',
                              marginRight: 10,
                              borderWidth: 1,
                              borderColor: colors.divider,
                            }}
                          >
                            {item.key === 'instagram' && <InstagramIcon size={18} color="#E1306C" />}
                            {item.key === 'facebook' && <FacebookIcon size={18} color="#1877F2" />}
                            {item.key === 'youtube' && <YouTubeIcon size={18} color="#FF0000" />}
                            {item.key === 'website' && <WebsiteIcon size={18} color="#0284C7" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                              {item.label}
                            </Text>
                            {hasLink && !isEditingThis ? (
                              <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 12, marginTop: 2 }}>
                                {currentLink}
                              </Text>
                            ) : null}
                          </View>
                        </View>

                        {/* Actions for configured link: Three-vertical-dots button */}
                        {hasLink && !isEditingThis ? (
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => setSocialActionMenuPlatform(item.key)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{
                              padding: 7,
                              borderRadius: radii.sm,
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.divider,
                              justifyContent: 'center',
                              alignItems: 'center',
                            }}
                          >
                            <MoreVerticalIcon size={18} color={colors.text} />
                          </TouchableOpacity>
                        ) : !hasLink && !isEditingThis ? (
                          <TouchableOpacity
                            onPress={() => {
                              setSocialActionMenuPlatform(null);
                              handleStartEditLink(item.key, '');
                            }}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 5,
                              borderRadius: radii.sm,
                              backgroundColor: colors.accent900,
                              borderWidth: 1,
                              borderColor: colors.accent,
                            }}
                          >
                            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>
                              {t('addLink', '+ Add Link')}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      {/* Editing input box */}
                      {isEditingThis ? (
                        <View style={{ marginTop: 10 }}>
                          <TextInput
                            style={[
                              styles.modalInput,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.divider,
                                color: colors.text,
                                marginBottom: 10,
                              },
                            ]}
                            placeholder={item.placeholder}
                            placeholderTextColor={colors.textDim}
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={platformUrlInput}
                            onChangeText={setPlatformUrlInput}
                            autoFocus
                          />
                          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                            <TouchableOpacity
                              onPress={() => {
                                setEditingPlatform(null);
                                setPlatformUrlInput('');
                              }}
                              style={{
                                paddingHorizontal: 14,
                                paddingVertical: 7,
                                borderRadius: radii.sm,
                                borderWidth: 1,
                                borderColor: colors.divider,
                              }}
                            >
                              <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '500' }}>
                                {t('cancel', 'Cancel')}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleSaveSingleLink(item.key, platformUrlInput)}
                              disabled={isSavingSocial}
                              style={{
                                paddingHorizontal: 16,
                                paddingVertical: 7,
                                borderRadius: radii.sm,
                                backgroundColor: colors.accent,
                              }}
                            >
                              {isSavingSocial ? (
                                <ActivityIndicator color="#000" size="small" />
                              ) : (
                                <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>
                                  {t('save', 'Save')}
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Three Vertical Dots Action Menu Popup for Edit / Delete */}
            {socialActionMenuPlatform && (
              <View style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
                <TouchableOpacity
                  style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
                  activeOpacity={1}
                  onPress={() => setSocialActionMenuPlatform(null)}
                />
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                  <View
                    style={{
                      width: '100%',
                      maxWidth: 320,
                      backgroundColor: colors.surface,
                      borderRadius: radii.lg,
                      borderWidth: 1,
                      borderColor: colors.divider,
                      padding: 16,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 10,
                      elevation: 10,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 12,
                        paddingBottom: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.divider,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: colors.bg,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                        >
                          {socialActionMenuPlatform === 'instagram' && <InstagramIcon size={16} color="#E1306C" />}
                          {socialActionMenuPlatform === 'facebook' && <FacebookIcon size={16} color="#1877F2" />}
                          {socialActionMenuPlatform === 'youtube' && <YouTubeIcon size={16} color="#FF0000" />}
                          {socialActionMenuPlatform === 'website' && <WebsiteIcon size={16} color="#0284C7" />}
                        </View>
                        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textTransform: 'capitalize' }}>
                          {socialActionMenuPlatform}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setSocialActionMenuPlatform(null)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={{ color: colors.textDim, fontSize: 14 }}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    <Text numberOfLines={1} style={{ color: colors.textDim, fontSize: 12, marginBottom: 14 }}>
                      {socialLinks[socialActionMenuPlatform] || ''}
                    </Text>

                    {/* Edit Option */}
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.divider,
                      }}
                      activeOpacity={0.7}
                      onPress={() => {
                        const platform = socialActionMenuPlatform;
                        setSocialActionMenuPlatform(null);
                        if (platform) {
                          handleStartEditLink(platform, socialLinks[platform] || '');
                        }
                      }}
                    >
                      <EditIcon size={18} color={colors.accent} />
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                        {t('editLink', 'Edit Link')}
                      </Text>
                    </TouchableOpacity>

                    {/* Delete Option */}
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 8,
                      }}
                      activeOpacity={0.7}
                      onPress={() => {
                        const platform = socialActionMenuPlatform;
                        setSocialActionMenuPlatform(null);
                        if (platform) {
                          handleDeleteSingleLink(platform);
                        }
                      }}
                    >
                      <TrashIcon size={18} color="#EF4444" />
                      <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '600' }}>
                        {t('deleteLink', 'Delete Link')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* ---------------------------------------------------- */}
      {/* 6. PERMANENT DELETE MODAL                            */}
      {/* ---------------------------------------------------- */}
      <Modal visible={showDeleteModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => {
                if (!isDeleting) {
                  setShowDeleteModal(false);
                }
              }}
            />
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'center',
                paddingBottom: Math.max(20, keyboardHeight + 20),
              }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={true}
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.error, maxHeight: '90%' }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.error }]}>{t('deleteAccountTitle', 'Delete Salon Account')}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      if (!isDeleting) {
                        setShowDeleteModal(false);
                      }
                    }}
                  >
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>{t('cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginBottom: 12 }}>
                    ⚠️ <Text style={{ fontWeight: '700', color: colors.error }}>{t('irreversibleAction', 'Irreversible Action')}:</Text>{' '}
                    {deleteWarningText}
                  </Text>

                  <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.textDim, marginBottom: 8 }}>
                    Reason for leaving:
                  </Text>

                  {[
                    'Closing or Pausing Salon Business',
                    'Switching to Another Software',
                    'Encountered Bugs / Technical Difficulties',
                    'Temporary Test Account',
                    'Other Reason',
                  ].map((reason) => {
                    const isSelected = selectedDeleteReason === reason;
                    return (
                      <TouchableOpacity
                        key={reason}
                        activeOpacity={0.8}
                        onPress={() => setSelectedDeleteReason(reason)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: radii.sm,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.error : colors.divider,
                          backgroundColor: isSelected ? 'rgba(255, 59, 48, 0.1)' : 'transparent',
                          marginBottom: 6,
                        }}
                      >
                        <View
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 7,
                            borderWidth: 1.5,
                            borderColor: isSelected ? colors.error : colors.textDim,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isSelected && (
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
                          )}
                        </View>
                        <Text style={{ fontSize: 12.5, color: colors.text }}>{reason}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TextInput
                    style={[
                      styles.ticketInput,
                      { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginTop: 8, height: 42, paddingVertical: 8 },
                    ]}
                    placeholder="Additional feedback (optional)"
                    placeholderTextColor={colors.textDim}
                    value={deleteCustomNote}
                    onChangeText={setDeleteCustomNote}
                  />

                  <TouchableOpacity
                    onPress={handlePermanentDelete}
                    disabled={isDeleting}
                    style={[styles.primaryModalButton, { backgroundColor: colors.error, marginTop: 14 }]}
                  >
                    {isDeleting ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>
                        {t('deleteAccountConfirm', 'Confirm Permanent Deletion')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ChangePhoneModal
        visible={showChangePhoneModal}
        currentPhone={activeUserPhone}
        shopId={shopId}
        userId={userId}
        onClose={() => setShowChangePhoneModal(false)}
        onSuccess={(newPhone) => {
          setActiveUserPhone(newPhone);
          onPhoneUpdated?.(newPhone);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  periodTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodTabText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  pnlHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  pnlSubLabel: {
    fontSize: 12,
    fontWeight: '400',
  },
  pnlMainAmt: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  pnlMarginBadge: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(217,164,65,0.15)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pnlMarginText: {
    fontSize: 12,
    fontWeight: '600',
  },
  twoColCards: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: radii.md,
  },
  statLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  statSub: {
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    padding: 14,
    borderRadius: radii.md,
    marginBottom: 14,
  },
  cardHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  expenseCatItem: {
    marginBottom: 10,
  },
  expenseCatLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  expenseCatName: {
    fontSize: 13,
  },
  expenseCatAmt: {
    fontSize: 13,
  },
  expenseCatProgressTrack: {
    height: 5,
    borderRadius: 2.5,
    overflow: 'hidden',
  },
  expenseCatProgressFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  duesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radii.md,
    marginBottom: 16,
  },
  duesLabel: {
    fontSize: 12,
  },
  duesAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  chaseButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  chaseButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  manageTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 9,
    width: '100%',
  },
  toolCard: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radii.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 52,
  },
  toolBadgeFloat: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBadgeFloatText: { color: '#161826', fontSize: 9.5, fontWeight: '800' },
  toolTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  toolContentCol: {
    flex: 1,
    paddingRight: 8,
    justifyContent: 'center',
  },
  toolTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  toolBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  toolBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  toolTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  toolSub: {
    fontSize: 11,
    lineHeight: 14,
  },
  toolIconContainer: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  settingsBox: {
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingsRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  settingsRowSub: {
    fontSize: 11.5,
    marginTop: 2,
  },
  nestedAccountBox: {
    borderTopWidth: 1,
    paddingLeft: 12,
  },
  nestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  nestedRowTitle: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  nestedRowSub: {
    fontSize: 11,
    marginTop: 1,
  },
  supportBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  supportBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 18,
  },
  policyText: {
    fontSize: 13,
    lineHeight: 20,
  },
  faqItem: {
    marginBottom: 14,
  },
  faqQuestion: {
    fontSize: 13.5,
    fontWeight: '600',
    marginBottom: 3,
  },
  faqAnswer: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  ticketInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    fontSize: 13,
    textAlignVertical: 'top',
    height: 100,
    marginBottom: 10,
  },
  contactInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    fontSize: 13,
    marginBottom: 16,
  },
  primaryModalButton: {
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  primaryModalButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    fontSize: 13,
  },
});
