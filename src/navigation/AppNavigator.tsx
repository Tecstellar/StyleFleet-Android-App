import React, { useState, useEffect, useRef } from 'react';
import { openWhatsAppPreferred } from '../services/whatsappLauncher';
import { View, StyleSheet, ActivityIndicator, Alert, Platform, StatusBar as RNStatusBar, Linking, BackHandler, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useLanguage } from '../i18n/LanguageContext';
import { loadAppFonts } from '../theme/initFonts';
import { ScreenName, MainTab, Customer, Bill, Appointment, Service, Offer, StaffMember, Expense, ServiceCategory, ReminderItem, StylistPermissions, DEFAULT_STYLIST_PERMISSIONS, SocialLinks } from '../types/domain';
import { BottomTabBar } from '../components/common/BottomTabBar';
import { PlanSelectionModal } from '../components/subscription/PlanSelectionModal';
import { PlanId } from '../config/planConfig';

// Repositories & Services
import { INVITE_SHOP_KEY } from '../repositories/staffRepository';
import { authRepository, AuthUser } from '../repositories/authRepository';
import { shopRepository, ShopRow, ShopRegistrationData } from '../repositories/shopRepository';
import { customerRepository } from '../repositories/customerRepository';
import { staffRepository } from '../repositories/staffRepository';
import {
  canAccessScreen,
  canShareBills,
  expensesVisibleTo,
  requiredPermission,
  resolvePermissions,
  billsVisibleTo,
  ownBillsOf,
  STYLIST_MODULE_LABELS,
} from '../utils/stylistAccess';
import { serviceRepository } from '../repositories/serviceRepository';
import { offerRepository } from '../repositories/offerRepository';
import { appointmentRepository } from '../repositories/appointmentRepository';
import { billingRepository } from '../repositories/billingRepository';
import { expenseRepository } from '../repositories/expenseRepository';
import { reminderRepository, ReminderRule } from '../repositories/reminderRepository';
import { supportRepository } from '../repositories/supportRepository';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { WhatsAppAudience } from '../repositories/whatsappRepository';
import { authService } from '../services/authService';
import { billingService } from '../services/billingService';
import { appointmentService } from '../services/appointmentService';
import { telemetryService } from '../services/telemetryService';
import { systemLogService } from '../services/systemLogService';

// Screens
import { SplashScreen } from '../screens/splash/SplashScreen';
import { WelcomeTourScreen } from '../screens/onboarding/WelcomeTourScreen';
import { onboardingRepository } from '../repositories/onboardingRepository';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { WorkersScreen } from '../screens/auth/WorkersScreen';
import { CustomersScreen } from '../screens/customers/CustomersScreen';
import { CustomerDetailScreen } from '../screens/customers/CustomerDetailScreen';
import { SalesScreen } from '../screens/sales/SalesScreen';
import { NewBillScreen } from '../screens/billing/NewBillScreen';
import { InvoiceScreen } from '../screens/billing/InvoiceScreen';
import { SentScreen } from '../screens/billing/SentScreen';
import { AccountsScreen } from '../screens/accounts/AccountsScreen';
import { ExpensesScreen } from '../screens/expenses/ExpensesScreen';
import { AppointmentsScreen } from '../screens/appointments/AppointmentsScreen';
import { BookingScreen } from '../screens/appointments/BookingScreen';
import { RemindersScreen } from '../screens/reminders/RemindersScreen';
import { BulkWhatsAppScreen } from '../screens/whatsapp/BulkWhatsAppScreen';
import { BulkSentScreen } from '../screens/whatsapp/BulkSentScreen';
import { StaffScreen } from '../screens/staff/StaffScreen';
import { PricingScreen } from '../screens/pricing/PricingScreen';
import { ShopProfileScreen } from '../screens/profile/ShopProfileScreen';
import { ReportsScreen } from '../screens/reports/ReportsScreen';
import { OnboardingTourModal } from '../components/common/OnboardingTourModal';
import { versionService, VersionCheckResult } from '../services/versionService';
import { UpdateRequiredModal } from '../components/common/UpdateRequiredModal';
import { appReviewService } from '../services/appReviewService';
import { AppReviewModal } from '../components/common/AppReviewModal';
import { QuickBookSuggestion } from '../services/quickBookService';
import { resolveFreeSalesLimit } from '../utils/subscriptionUtils';

export const AppNavigator = () => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  // Navigation state - starts strictly with splash screen
  const [screen, setScreen] = useState<ScreenName>('splash');
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [history, setHistory] = useState<ScreenName[]>([]);
  const initialDestinationRef = useRef<ScreenName>('home');
  // The price list asks before leaving with unsaved changes
  const pricingBackGuardRef = useRef<(() => boolean) | null>(null);
  const [initialDestination, setInitialDestinationState] = useState<ScreenName>('home');
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const setInitialDestination = (dest: ScreenName) => {
    initialDestinationRef.current = dest;
    setInitialDestinationState(dest);
  };

  // Auth & Shop context
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentShop, setCurrentShop] = useState<ShopRow | null>(null);
  const [ownerName, setOwnerName] = useState<string>('Owner');
  const [authPhone, setAuthPhone] = useState('');
  const [authMode, setAuthMode] = useState<'owner' | 'stylist'>('owner');
  const [authSessionId, setAuthSessionId] = useState<string | undefined>();
  const [pendingRegistration, setPendingRegistration] = useState<ShopRegistrationData | null>(null);
  const [showTour, setShowTour] = useState<boolean>(false);
  const [showPlanSelectionModal, setShowPlanSelectionModal] = useState<boolean>(false);
  const [selectedPlanForModal, setSelectedPlanForModal] = useState<PlanId>('6_months');

  // Real Domain data (100% genuine from Supabase)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [rules, setRules] = useState<ReminderRule[]>([]);

  // Selected screen data targets
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [totalSalesCount, setTotalSalesCount] = useState<number>(0);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [pendingAppointmentToBill, setPendingAppointmentToBill] = useState<Appointment | null>(null);
  const [initialBillServiceId, setInitialBillServiceId] = useState<string | null>(null);
  const [initialBillServiceIds, setInitialBillServiceIds] = useState<string[]>([]);
  const [initialBillServiceQuantities, setInitialBillServiceQuantities] = useState<Record<string, number>>({});
  const [initialBillStaffId, setInitialBillStaffId] = useState<string | null>(null);
  const [bulkAudience, setBulkAudience] = useState<WhatsAppAudience>({
    id: 1,
    label: 'All Customers',
    count: 0,
  });
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  // Services/stylist pre-chosen when the full booking screen is opened from Home's quick booking
  const [bookingPreset, setBookingPreset] = useState<{ serviceIds: string[]; staffIds: string[] } | null>(null);

  useEffect(() => {
    if (screen !== 'booking') setBookingPreset(null);
  }, [screen]);

  // App version enforcement state
  const [versionCheck, setVersionCheck] = useState<VersionCheckResult | null>(null);

  const runVersionCheck = async () => {
    try {
      const res = await versionService.checkAppVersion();
      setVersionCheck(res);
    } catch (err) {
      console.warn('App version check notice:', err);
    }
  };

  useEffect(() => {
    runVersionCheck();

    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        runVersionCheck();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, []);

  // Stylist invitation deep link context (only invited stylists see stylist login)
  const [stylistInviteContext, setStylistInviteContext] = useState<{ phone?: string; valid: boolean } | null>(null);

  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      try {
        const lowerUrl = url.toLowerCase();
        if (
          lowerUrl.includes('stylist-invite') ||
          lowerUrl.includes('/invite') ||
          lowerUrl.includes('mode=stylist') ||
          lowerUrl.includes('role=stylist')
        ) {
          const phoneMatch = url.match(/[?&]phone=([0-9+]+)/);
          const rawPhone = phoneMatch ? phoneMatch[1] : '';
          const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
          // Remember which salon sent the invite, as the same number can be a stylist in several
          const shopMatch = url.match(/[?&]shop=([0-9a-fA-F-]{36})/);
          if (shopMatch) {
            await AsyncStorage.setItem(INVITE_SHOP_KEY, shopMatch[1]).catch(() => {});
          }

          if (cleanPhone.length === 10) {
            const stylist = await staffRepository.getStylistByPhone(cleanPhone);
            if (stylist && stylist.is_active) {
              setStylistInviteContext({ phone: cleanPhone, valid: true });
              return;
            }
          }
          setStylistInviteContext({ valid: true });
        }
      } catch (e) {
        console.warn('Error checking stylist invitation deep link:', e);
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  // Sync current shop with telemetry stream
  useEffect(() => {
    telemetryService.setShopId(currentShop?.id || null);
  }, [currentShop?.id]);

  // Verify real session and shop on startup (persistent login)
  useEffect(() => {
    let isMounted = true;
    telemetryService.startStream(currentShop?.id || null);

    (async () => {
      try {
        // Guarantee font load is kicked off without blocking instant session check
        loadAppFonts().catch(() => {});

        // 1. FAST PATH: Check local cache & local session first (sub-5ms)
        const [cachedShop, cachedUser, lastPhone, currentShopId] = await Promise.all([
          shopRepository.getCachedShop(),
          authRepository.getSession(),
          shopRepository.getLastPhone(),
          authRepository.getCurrentShopId(),
        ]);

        if (cachedShop) {
          // Reconnect to the database in the background so owner-only saves are accepted
          authRepository.ensureSupabaseSession().catch(() => {});
          if (isMounted) {
            setCurrentShop(cachedShop);
            shopRepository.resolveOwnerName(cachedShop.owner_profile_id).then((oName) => {
              if (oName && isMounted) setOwnerName(oName);
            });
            const user: AuthUser = cachedUser || {
              id: cachedShop.owner_profile_id || 'user_' + (cachedShop.phone || 'salon'),
              phone: cachedShop.phone || lastPhone || '',
              role: 'owner',
            };
            if (user.role === 'stylist') {
              setAuthMode('stylist');
            } else {
              setAuthMode('owner');
            }
            setCurrentUser(user);
            await authRepository.saveSession(user);
            await authRepository.setCurrentShopId(cachedShop.id);
            setActiveTab('home');
            setInitialDestination('home');
            setIsInitializing(false);
            setScreen((prev) => (prev === 'splash' ? prev : 'home'));
          }

          // Owners see the saved copy at once. A stylist's view is limited by permissions, so it waits for the server.
          if (cachedUser?.role !== 'stylist') {
            hydrateFromSavedCopy(cachedShop.id).catch(() => {});
          }

          // Background sync of live data (never blocks splash dismiss)
          loadShopData(cachedShop.id).catch((err) =>
            console.warn('Background sync notice:', err)
          );
          return;
        }

        // 2. No cached shop locally - check Supabase session or currentShopId or last phone
        let user = cachedUser;
        if (!user) {
          user = await authRepository.getSession();
        }

        let shop: ShopRow | null = null;
        if (currentShopId) {
          shop = await shopRepository.getShopById(currentShopId);
        }

        if (!shop && user) {
          if (isMounted) {
            setCurrentUser(user);
            if (user.role === 'stylist') setAuthMode('stylist');
            else setAuthMode('owner');
          }
          if (user.shopId) {
            shop = await shopRepository.getShopById(user.shopId);
          }
          if (!shop && user.role === 'stylist' && user.phone) {
            const clean = user.phone.replace(/\D/g, '').slice(-10);
            const stylist = await staffRepository.getStylistByPhone(clean);
            if (stylist) {
              shop = await shopRepository.getShopById(stylist.shop_id);
            }
          }
          if (!shop) {
            shop = await shopRepository.getShopForUser(user.id);
          }
          if (!shop && user.phone) {
            shop = await shopRepository.getShopByPhone(user.phone);
          }
        }

        if (!shop && lastPhone) {
          shop = await shopRepository.getShopByPhone(lastPhone);
        }

        if (shop) {
          if (isMounted) {
            setCurrentShop(shop);
            shopRepository.resolveOwnerName(shop.owner_profile_id).then((oName) => {
              if (oName && isMounted) setOwnerName(oName);
            });
            await shopRepository.cacheShop(shop);
            await authRepository.setCurrentShopId(shop.id);
            const resolvedUser: AuthUser = user || {
              id: shop.owner_profile_id || 'user_' + (shop.phone || 'salon'),
              phone: shop.phone || lastPhone || '',
              role: 'owner',
              shopId: shop.id,
            };
            setCurrentUser(resolvedUser);
            await authRepository.saveSession(resolvedUser);
            setActiveTab('home');
            setInitialDestination('home');
            setIsInitializing(false);
            setScreen((prev) => (prev === 'splash' ? prev : 'home'));
          }
          loadShopData(shop.id).catch(() => {});
          return;
        }

        // 3. User authenticated but no shop found in DB yet -> Go to register
        if (user) {
          if (isMounted) {
            setInitialDestination('register');
            setIsInitializing(false);
          }
          return;
        }

        // 4. Brand new visitor -> Phone login
        if (isMounted) {
          setInitialDestination('phone');
          setIsInitializing(false);
        }
      } catch (e) {
        systemLogService.error('APP_INITIALIZATION', 'Failed to initialize session', e);
        const shop = await shopRepository.getCachedShop().catch(() => null);
        if (shop && isMounted) {
          setCurrentShop(shop);
          telemetryService.setShopId(shop.id);
          setActiveTab('home');
          setInitialDestination('home');
          setScreen((prev) => (prev === 'splash' ? prev : 'home'));
        } else if (isMounted) {
          setInitialDestination('phone');
        }
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      telemetryService.stopStream();
    };
  }, []);

  const freeSalesLimit = resolveFreeSalesLimit(currentShop?.free_sales_limit);

  // Set once fresh data from the server is on screen, so a slower read of the saved copy never overwrites it
  const freshDataLoaded = useRef(false);

  const hydrateFromSavedCopy = async (shopId: string) => {
    const [c, st, cats, sv, o, a, b, ex, rem, r] = await Promise.all([
      customerRepository.getCachedCustomers(shopId),
      staffRepository.getCachedStaff(shopId),
      serviceRepository.getCachedCategories(shopId),
      serviceRepository.getCachedServices(shopId),
      offerRepository.getCachedOffers(shopId),
      appointmentRepository.getCachedAppointments(shopId),
      billingRepository.getCachedBills(shopId),
      expenseRepository.getCachedExpenses(shopId),
      reminderRepository.getCachedReminders(shopId),
      reminderRepository.getRules(shopId),
    ]);
    if (freshDataLoaded.current) return;
    if (c) setCustomers(c);
    if (st) setStaff(st);
    if (cats) setCategories(cats);
    if (sv) setServices(sv);
    if (o) setOffers(o);
    if (a) setAppointments(a);
    if (b) setBills(b);
    if (ex) setExpenses(ex);
    if (rem) setReminders(rem);
    if (r) setRules(r);
  };

  const refreshShopData = async () => {
    if (currentShop) await loadShopData(currentShop.id);
  };

  const loadShopData = async (shopId: string) => {
    try {
      let activeShopId = shopId;
      const isStylistUser = currentUser?.role === 'stylist';

      const loadEverything = (id: string, perms: StylistPermissions | null) =>
        Promise.all([
          !isStylistUser || perms?.customers !== false
            ? customerRepository.getCustomers(id)
            : Promise.resolve([]),
          staffRepository.getStaff(id),
          serviceRepository.getCategories(id),
          serviceRepository.getServices(id),
          offerRepository.getOffers(id),
          !isStylistUser || perms?.appointments !== false
            ? appointmentRepository.getAppointments(id)
            : Promise.resolve([]),
          !isStylistUser || perms?.sales !== false
            ? billingRepository.getBills(id)
            : Promise.resolve([]),
          !isStylistUser || perms?.expenses !== false
            ? expenseRepository.getExpenses(id)
            : Promise.resolve([]),
          !isStylistUser || perms?.reminders !== false
            ? reminderRepository.getReminders(id)
            : Promise.resolve([]),
          !isStylistUser || perms?.reminders !== false
            ? reminderRepository.getRules(id)
            : Promise.resolve([]),
          billingRepository.getTotalSalesCreatedCount(id),
        ]);

      // Owners can see everything, so their data is requested while the shop is still being confirmed.
      // Stylists wait: what they may load depends on their saved permissions.
      const earlyBatch = isStylistUser ? null : loadEverything(shopId, null);
      earlyBatch?.catch(() => {});

      const verified = await shopRepository.getShopById(shopId);
      if (!verified) {
        // Shop not found in DB by ID! Attempt to find by phone
        const phoneToTry = currentShop?.phone || currentUser?.phone;
        const recoveredShop = phoneToTry ? await shopRepository.getShopByPhone(phoneToTry) : null;
        if (recoveredShop) {
          activeShopId = recoveredShop.id;
          setCurrentShop(recoveredShop);
          await shopRepository.cacheShop(recoveredShop);
          await authRepository.setCurrentShopId(recoveredShop.id);
        } else {
          // Shop does not exist in remote DB (e.g. database reset, wrong region, or deleted shop)
          console.warn('Stale shop not found in remote DB. Redirecting to registration.');
          await shopRepository.clearCachedShop();
          setCurrentShop(null);
          setScreen('register');
          return;
        }
      }

      let perms = isStylistUser ? resolvePermissions(currentUser?.permissions) : null;

      if (isStylistUser && currentUser?.phone) {
        const clean = currentUser.phone.replace(/\D/g, '').slice(-10);
        const freshStylist = await staffRepository.getStylistByPhone(clean);
        if (freshStylist && freshStylist.permissions) {
          perms = resolvePermissions(freshStylist.permissions);
          setCurrentUser((prev) => (prev ? { ...prev, permissions: freshStylist.permissions } : prev));
        }
      }

      // The plan check runs on its own: a failure in any other fetch below must not make a paid shop look free
      const subInfoPromise = subscriptionRepository.getSubscriptionInfo(activeShopId).catch(() => null);
      subInfoPromise.then((info) => {
        setIsPro(Boolean(info && info.type === 'subscription' && !info.subscription?.isExpired));
      });

      // Reuse the early request unless the shop turned out to be a different one
      const [c, st, cats, sv, o, a, b, ex, rem, r, salesCount] = await (earlyBatch && activeShopId === shopId
        ? earlyBatch
        : loadEverything(activeShopId, perms));
      freshDataLoaded.current = true;
      setCustomers(c);
      setStaff(st);
      setCategories(cats);
      setServices(sv);
      setOffers(o);
      setAppointments(a);
      setBills(b);
      setExpenses(ex);
      setReminders(rem);
      setRules(r);
      setTotalSalesCount(salesCount);

      // Check milestone for Play Store review prompt on app startup (requires both 10 customers and 10 bills)
      const totalBillsCompleted = Math.max(salesCount, b.length);
      appReviewService.shouldPromptReview(c.length, totalBillsCompleted).then((shouldPrompt) => {
        if (shouldPrompt) {
          setTimeout(() => setShowReviewModal(true), 1500);
        }
      }).catch(() => {});
    } catch (e) {
      console.warn('Error loading shop data:', e);
    }
  };

  // Realtime subscription for admin panel support message answers
  useEffect(() => {
    if (!currentShop?.id) return;
    const unsub = supportRepository.subscribeToSupportAnswers(currentShop.id, (answer) => {
      reminderRepository.getReminders(currentShop.id).then((rems) => setReminders(rems));
      Alert.alert(
        '💬 Message from Support',
        `${answer.admin_name || 'StyleFleet Support'}:\n\n"${answer.answer}"`,
        [
          { text: 'View in Reminders', onPress: () => navigateTo('reminders') },
          { text: 'OK', style: 'cancel' },
        ]
      );
    });

    return () => {
      unsub();
    };
  }, [currentShop?.id]);

  // Navigation helpers & Stylist Access Control
  const isStylist = currentUser?.role === 'stylist';
  const stylistPerms = isStylist ? resolvePermissions(currentUser?.permissions) : null;
  // Stylists without "past expenses" only ever see today's expenses, wherever expenses are shown.
  const visibleExpenses = expensesVisibleTo(expenses, isStylist, stylistPerms);
  // Stylists see only the bills they served today; "full reports" widens that for the Reports screen.
  const stylistName = staff.find((s) => s.id === currentUser?.stylistId)?.name || currentUser?.fullName;
  const ownBills = billsVisibleTo(bills, isStylist, stylistPerms, currentUser?.stylistId, stylistName);
  const salesBills = isStylist ? ownBillsOf(bills, currentUser?.stylistId, stylistName) : bills;
  const reportBills = billsVisibleTo(bills, isStylist, stylistPerms, currentUser?.stylistId, stylistName, true);
  const reportsFullAccess = !isStylist || stylistPerms?.reportsHistory === true;

  const checkStylistAccess = (moduleName: keyof StylistPermissions, label: string): boolean => {
    if (isStylist && stylistPerms && stylistPerms[moduleName] !== true) {
      Alert.alert(
        'Access Restricted',
        `You do not have permission to access ${label}. Please contact your salon owner.`
      );
      return false;
    }
    return true;
  };

  // Where Reports opens: normally the daily report, or the summary when the Home revenue tile sent the owner here
  const [reportsStart, setReportsStart] = useState<{ view: 'report' | 'summary'; period: 'Day' | 'Week' | 'Month' }>({
    view: 'report',
    period: 'Day',
  });
  useEffect(() => {
    if (screen !== 'reports') setReportsStart({ view: 'report', period: 'Day' });
  }, [screen]);

  const navigateTo = (nextScreen: ScreenName, resetHistory = false) => {
    if (isStylist && !canAccessScreen(nextScreen, true, stylistPerms)) {
      const key = requiredPermission(nextScreen);
      if (key) checkStylistAccess(key, STYLIST_MODULE_LABELS[key]);
      return;
    }

    if (resetHistory) {
      setHistory([]);
    } else {
      setHistory((prev) => [...prev, screen]);
    }
    if ((nextScreen === 'reports' || nextScreen === 'staff') && currentShop) {
      loadShopData(currentShop.id).catch(() => {});
    }
    setScreen(nextScreen);
  };

  // The user is already signed in here, so reopening the app lands back on register (no OTP again).
  const confirmCancelRegistration = () => {
    Alert.alert(
      "Cancel registration?",
      "Your shop is not registered yet. Do you want to cancel before registering?",
      [
        { text: "No", style: "cancel" },
        { text: "Yes", onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: true }
    );
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory((old) => old.slice(0, old.length - 1));
      setScreen(prev);
    } else {
      setScreen(activeTab);
    }
  };

  const handleTabSelect = (tab: MainTab) => {
    if (isStylist && !canAccessScreen(tab, true, stylistPerms)) {
      const key = requiredPermission(tab);
      if (key) checkStylistAccess(key, STYLIST_MODULE_LABELS[key]);
      return;
    }

    setActiveTab(tab);
    setHistory([]);
    setSelectedCustomer(null);
    setInitialBillServiceId(null);
    setInitialBillServiceIds([]);
    setInitialBillStaffId(null);
    setPendingAppointmentToBill(null);
    setScreen(tab);
  };

  const handleRateApp = async () => {
    setShowReviewModal(false);
    await appReviewService.openAppReview();
  };

  const handleDismissReview = async () => {
    setShowReviewModal(false);
    await appReviewService.dismissReviewPrompt();
  };

  // Android Hardware Back Button Handling & App Exit Confirmation
  useEffect(() => {
    const onBackPress = () => {
      // 1. While on splash screen or initializing, ignore back press
      if (screen === 'splash' || screen === 'welcomeTour' || isInitializing) {
        return true;
      }

      if (screen === 'pricing' && pricingBackGuardRef.current?.()) {
        return true;
      }

      if (screen === 'invoice') {
        handleTabSelect('sales');
        return true;
      }

      // 2. If there is navigation history, pop back to the previous screen
      if (history.length > 0) {
        goBack();
        return true;
      }

      const mainTabs: MainTab[] = ['home', 'customers', 'sales', 'accounts'];

      // 3. If on an inner sub-screen (e.g. newBill, booking, customerDetail, shopProfile) without history stack
      if (!mainTabs.includes(screen as MainTab)) {
        if (currentUser && currentShop) {
          handleTabSelect(activeTab || 'home');
          return true;
        }
      }

      // 4. If roaming on another tab (e.g. accounts, sales, customers, appointments), navigate to home
      if (activeTab !== 'home' || screen !== 'home') {
        if (currentUser && currentShop) {
          handleTabSelect('home');
          return true;
        }
      }

      // 5. If on auth sub-screens, navigate back to phone entry
      if (screen === 'register') {
        confirmCancelRegistration();
        return true;
      }
      if (['otp', 'workers'].includes(screen)) {
        setScreen('phone');
        return true;
      }

      // 6. If on home page (or unauthenticated phone root), confirm app exit
      if (screen === 'home' || screen === 'phone') {
        Alert.alert(
          'Exit StyleFleet',
          'Are you sure you want to exit?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Yes',
              onPress: () => BackHandler.exitApp(),
            },
          ],
          { cancelable: true }
        );
        return true;
      }

      return false;
    };

    const backHandlerSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );

    return () => backHandlerSubscription.remove();
  }, [screen, activeTab, history, isInitializing, currentUser, currentShop]);

  // Auth flow handlers
  const handleSendOtp = async (phone: string, mode: 'owner' | 'stylist' = 'owner') => {
    setAuthMode(mode);
    setAuthPhone(phone);
    await shopRepository.saveLastPhone(phone);
    const res = await authService.sendOtp(phone);
    setAuthSessionId(res.sessionId);
    navigateTo('otp');
  };

  // The owner's real name is used wherever the owner is chosen as the stylist (new bill, booking, invoice).
  // Load it right after a fresh login too, not only when the app restarts.
  const loadOwnerName = (ownerProfileId: string | null) => {
    shopRepository
      .resolveOwnerName(ownerProfileId)
      .then((name) => {
        if (name) setOwnerName(name);
      })
      .catch(() => {});
  };

  const handleVerifyOtp = async (otp: string) => {
    const res = await authService.verifyOtp(authPhone, otp, authSessionId);
    if (res.success && res.user) {
      if (authMode === 'stylist') {
        const clean = authPhone.replace(/\D/g, '').slice(-10);
        const stylist = await staffRepository.getStylistByPhone(clean);
        if (!stylist || !stylist.is_active) {
          Alert.alert(
            'Access Denied',
            'This phone number is not registered as an active stylist. Please contact your salon owner.'
          );
          return;
        }

        // 1. Link stylist profileId in staff and shop_members immediately to satisfy RLS
        await staffRepository.markStylistActive(stylist.shop_id, stylist.id, res.user.id, clean);

        // 2. Fetch the genuine store profile (now readable by stylist via RLS)
        let shop = await shopRepository.getShopById(stylist.shop_id);
        if (!shop) {
          shop = await shopRepository.getCachedShop();
        }
        if (!shop) {
          Alert.alert('Salon Not Found', 'Could not locate the salon linked to your stylist account.');
          return;
        }

        const stylistUser: AuthUser = {
          id: stylist.id,
          phone: clean,
          fullName: stylist.name,
          shopId: stylist.shop_id,
          role: 'stylist',
          stylistId: stylist.id,
          permissions: stylist.permissions || DEFAULT_STYLIST_PERMISSIONS,
        };

        setAuthMode('stylist');
        setCurrentUser(stylistUser);
        await authRepository.saveSession(stylistUser);
        await authRepository.setCurrentShopId(stylist.shop_id);
        await shopRepository.saveLastPhone(clean);
        setCurrentShop(shop);
        loadOwnerName(shop.owner_profile_id);
        await shopRepository.cacheShop(shop);
        await loadShopData(shop.id);
        handleTabSelect('home');
        return;
      }

      // Owner mode
      // Check if this phone number or user already has a registered shop in Supabase
      let shop = await shopRepository.getShopByPhone(authPhone);
      if (!shop && res.user.id) {
        shop = await shopRepository.getShopForUser(res.user.id);
      }
      if (!shop) {
        shop = await shopRepository.getCachedShop();
      }

      const ownerUser: AuthUser = {
        ...res.user,
        role: 'owner',
        shopId: shop?.id || undefined,
      };
      setAuthMode('owner');
      setCurrentUser(ownerUser);
      await authRepository.saveSession(ownerUser);
      await shopRepository.saveLastPhone(authPhone);

      if (shop) {
        setCurrentShop(shop);
        loadOwnerName(shop.owner_profile_id);
        await shopRepository.cacheShop(shop);
        await authRepository.setCurrentShopId(shop.id);
        await loadShopData(shop.id);
        handleTabSelect('home');
      } else {
        navigateTo('register');
      }
    } else {
      Alert.alert('Verification Failed', res.error || 'Please enter the correct 6-digit OTP');
    }
  };

  const handleRegisterNext = (data: ShopRegistrationData) => {
    setPendingRegistration(data);
    navigateTo('workers');
  };

  const handleFinishSetup = async (staffDraft: { name: string; role: string; phone?: string }[]) => {
    if (pendingRegistration) {
      try {
        const phoneToUse = pendingRegistration.phone || authPhone;
        const regDataWithPhone: ShopRegistrationData = {
          ...pendingRegistration,
          phone: phoneToUse,
        };
        const userId = currentUser?.id || `user_${Date.now()}`;
        const shop = await authService.registerShop(userId, regDataWithPhone);
        setCurrentShop(shop);
        if (pendingRegistration.ownerName) {
          setOwnerName(pendingRegistration.ownerName);
          await shopRepository.saveOwnerName(pendingRegistration.ownerName);
        }
        await shopRepository.cacheShop(shop);
        await authRepository.setCurrentShopId(shop.id);
        if (phoneToUse) {
          await shopRepository.saveLastPhone(phoneToUse);
        }
        if (currentUser) {
          await authRepository.saveSession({
            ...currentUser,
            shopId: shop.id,
            phone: phoneToUse || currentUser.phone,
          });
        }

        const savedStaffList: StaffMember[] = [];
        for (let i = 0; i < staffDraft.length; i++) {
          const s = staffDraft[i];
          const cleanPhone = s.phone ? s.phone.replace(/\D/g, '').slice(-10) : '';
          const phoneToSave = cleanPhone.length === 10 ? cleanPhone : `980000000${i + 1}`;
          try {
            const added = await staffRepository.addStaff(shop.id, s.name, s.role || 'Stylist', phoneToSave);
            if (added) {
              savedStaffList.push(added);
            }
          } catch (staffErr) {
            console.warn('Failed to add staff member during onboarding:', s.name, staffErr);
          }
        }
        if (savedStaffList.length > 0) {
          setStaff(savedStaffList);
          await staffRepository.cacheStaff(shop.id, savedStaffList);
        }
        await loadShopData(shop.id);
        handleTabSelect('home');
        setShowTour(true);
      } catch (err: any) {
        console.error('Registration failed:', err);
        Alert.alert(
          'Registration Notice',
          err.message || 'Could not save salon to database. Please check your connection and try again.'
        );
      }
    }
  };

  // Business actions
  const handleToggleStar = async (customerId: string) => {
    if (!currentShop) return;
    try {
      const newStar = await customerRepository.toggleStar(currentShop.id, customerId);
      setCustomers((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, is_starred: newStar } : c))
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update the VIP star');
    }
  };

  const handleSettleDue = async (
    customerId: string,
    method: 'cash' | 'upi' = 'cash',
    amountMinor?: number
  ) => {
    if (!currentShop) return;
    try {
      const remainingCustDue = await customerRepository.settleDues(
        currentShop.id,
        customerId,
        method,
        amountMinor
      );
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId ? { ...c, outstanding_due_minor: remainingCustDue } : c
        )
      );
      if (selectedCustomer && selectedCustomer.id === customerId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, outstanding_due_minor: remainingCustDue } : null));
      }
      const b = await billingRepository.getBills(currentShop.id);
      setBills(b);
      const isFull = remainingCustDue === 0;
      Alert.alert(
        isFull ? 'Due Fully Settled' : 'Partial Due Payment Recorded',
        isFull
          ? 'Outstanding balance has been cleared in full.'
          : `Payment recorded. Remaining customer due: ₹${Math.round(remainingCustDue / 100).toLocaleString('en-IN')}`
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not settle dues');
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!currentShop) return;
    try {
      const target = customers.find((c) => c.id === customerId);
      const isCurrentlyInactive = target?.is_active === false;
      await customerRepository.setCustomerInactive(currentShop.id, customerId, !isCurrentlyInactive);
      setCustomers((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, is_active: isCurrentlyInactive } : c))
      );
      if (selectedCustomer && selectedCustomer.id === customerId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, is_active: isCurrentlyInactive } : null));
      }
      goBack();
      Alert.alert(
        isCurrentlyInactive ? 'Customer Reactivated' : 'Customer Inactive',
        isCurrentlyInactive
          ? 'Customer is now active.'
          : 'Customer has been moved to Inactive. All past bills, appointments, and report history remain safely preserved.'
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update customer status');
    }
  };

  const saveBillAndOpenInvoice = async (billData: {
    customerName: string;
    customerId: string | null;
    staffName: string;
    staffId: string | null;
    staffIds?: string[];
    items: { name: string; priceMinor: number; isColour?: boolean }[];
    paymentMethod: string;
    discountMinor: number;
    tipMinor?: number;
    paidAmountMinor?: number;
    dueAmountMinor?: number;
  }) => {
    if (!currentShop) return;

    if (editingBill) {
      // Update existing bill in Supabase and local cache
      const updated = await billingRepository.updateBill(
        currentShop.id,
        editingBill.id,
        {
          items: billData.items,
          discountMinor: billData.discountMinor,
          tipMinor: billData.tipMinor,
          paymentMethod: billData.paymentMethod,
          staffName: billData.staffName,
          staffId: billData.staffId,
          paidAmountMinor: billData.paidAmountMinor,
          dueAmountMinor: billData.dueAmountMinor,
          customerName: billData.customerName,
          customerId: billData.customerId,
        },
        editingBill
      );

      const targetBill: Bill = updated || {
        ...editingBill,
        customer_name: billData.customerName,
        customer_id: billData.customerId,
        staff_name: billData.staffName,
        staff_id: billData.staffId,
        payment_method: billData.paymentMethod,
        discount_minor: billData.discountMinor,
        tip_minor: billData.tipMinor || 0,
        paid_amount_minor: billData.paidAmountMinor,
        due_amount_minor: billData.dueAmountMinor,
        total_minor: Math.max(0, billData.items.reduce((a, b) => a + b.priceMinor, 0) - billData.discountMinor + (billData.tipMinor || 0)),
        items: billData.items.map((it) => {
          const qty = (it as any).quantity || 1;
          const unitPrice = (it as any).unitPriceMinor || Math.round(it.priceMinor / qty);
          return {
            id: undefined,
            service_id: null,
            service_name_snapshot: it.name,
            quantity: qty,
            unit_price_minor: unitPrice,
            discount_minor: 0,
            tax_minor: 0,
            line_total_minor: it.priceMinor,
            staff_id: billData.staffId,
          };
        }),
        payments: (billData.paidAmountMinor || 0) > 0 ? [
          {
            id: editingBill.payments?.[0]?.id || `pay_${Date.now()}`,
            amount_minor: billData.paidAmountMinor || 0,
            method: billData.paymentMethod,
            paid_at: editingBill.payments?.[0]?.paid_at || editingBill.created_at || new Date().toISOString(),
          }
        ] : [],
        is_edited: true,
      };

      // In-place replacement of the existing bill - NEVER creates a duplicate
      setBills((prev) =>
        prev.map((b) =>
          b.id === editingBill.id || (editingBill.invoice_number && b.invoice_number === editingBill.invoice_number)
            ? targetBill
            : b
        )
      );
      setSelectedBill(targetBill);
      setEditingBill(null);

      // Instant customer update on client screen
      if (billData.customerId) {
        const oldPaid = editingBill.paid_amount_minor !== undefined ? editingBill.paid_amount_minor : editingBill.total_minor;
        const newPaid = targetBill.paid_amount_minor !== undefined ? targetBill.paid_amount_minor : targetBill.total_minor;
        const paidDiff = newPaid - oldPaid;

        const oldDue = editingBill.due_amount_minor !== undefined ? editingBill.due_amount_minor : (editingBill.status === 'pending' ? editingBill.total_minor : 0);
        const newDue = targetBill.due_amount_minor !== undefined ? targetBill.due_amount_minor : (targetBill.status === 'pending' ? targetBill.total_minor : 0);
        const dueDiff = newDue - oldDue;

        setCustomers((prev) =>
          prev.map((c) => {
            if (c.id === billData.customerId) {
              return {
                ...c,
                lifetime_spend_minor: Math.max(0, (c.lifetime_spend_minor || 0) + paidDiff),
                outstanding_due_minor: Math.max(0, (c.outstanding_due_minor || 0) + dueDiff),
                last_visit_date: `${new Date().getDate()} ${new Date().toLocaleString('en-US', { month: 'short' })}`,
              };
            }
            return c;
          })
        );

        if (selectedCustomer && selectedCustomer.id === billData.customerId) {
          setSelectedCustomer((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              lifetime_spend_minor: Math.max(0, (prev.lifetime_spend_minor || 0) + paidDiff),
              outstanding_due_minor: Math.max(0, (prev.outstanding_due_minor || 0) + dueDiff),
            };
          });
        }
      }

      // Supabase background sync
      customerRepository.getCustomers(currentShop.id).then((freshCusts) => {
        setCustomers(freshCusts);
        if (selectedCustomer) {
          const freshSel = freshCusts.find((c) => c.id === selectedCustomer.id);
          if (freshSel) setSelectedCustomer(freshSel);
        }
      }).catch(() => {});

      navigateTo('invoice');
      return;
    }

    const newBill = await billingRepository.createBill(
      currentShop.id,
      billData.customerName,
      billData.customerId,
      billData.staffName,
      billData.staffId,
      billData.items,
      billData.paymentMethod,
      billData.discountMinor,
      billData.paidAmountMinor,
      billData.dueAmountMinor,
      billData.tipMinor || 0,
      billData.staffIds,
      (billData as any).billDate
    );
    setBills((prev) => {
      const filtered = prev.filter(
        (b) => b.id !== newBill.id && b.invoice_number !== newBill.invoice_number
      );
      return [newBill, ...filtered];
    });
    setSelectedBill(newBill);
    const updatedSalesCount = (totalSalesCount || bills.length) + 1;
    setTotalSalesCount((prev) => prev + 1);

    // Prompt user for Play Store review after generating 10 bills and having 10 customers
    appReviewService.shouldPromptReview(customers.length, updatedSalesCount).then((shouldPrompt) => {
      if (shouldPrompt) {
        setTimeout(() => setShowReviewModal(true), 1200);
      }
    }).catch(() => {});

    // Instant zero-delay customer update in local state
    if (billData.customerId) {
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id === billData.customerId) {
            return {
              ...c,
              visits_count: (c.visits_count || 0) + 1,
              lifetime_spend_minor: (c.lifetime_spend_minor || 0) + (newBill.paid_amount_minor || 0),
              outstanding_due_minor: (c.outstanding_due_minor || 0) + (newBill.due_amount_minor || 0),
              last_visit_date: `${new Date().getDate()} ${new Date().toLocaleString('en-US', { month: 'short' })}`,
              due_start_date:
                (newBill.due_amount_minor || 0) > 0 && !c.due_start_date
                  ? `${new Date().getDate()} ${new Date().toLocaleString('en-US', { month: 'short' })}`
                  : c.due_start_date,
            };
          }
          return c;
        })
      );
    }

    // Instant customer lifetime values & dues update from Supabase
    customerRepository.getCustomers(currentShop.id).then((freshCusts) => {
      setCustomers(freshCusts);
      if (selectedCustomer) {
        const freshSel = freshCusts.find((c) => c.id === selectedCustomer.id);
        if (freshSel) setSelectedCustomer(freshSel);
      }
    }).catch(() => {});

    // If billing an in-chair appointment, advance it to Done
    if (pendingAppointmentToBill) {
      try {
        await appointmentRepository.updateStatus(currentShop.id, pendingAppointmentToBill.id, 'Done');
        setAppointments((prev) =>
          prev.map((a) => (a.id === pendingAppointmentToBill.id ? { ...a, status: 'Done' } : a))
        );
      } catch (e: any) {
        // The bill itself is saved at this point, so say exactly that
        Alert.alert(
          'Bill saved',
          `The bill was saved, but the appointment could not be marked as Done: ${e?.message || 'please try again'}`
        );
      }
      setPendingAppointmentToBill(null);
      setInitialBillServiceId(null);
      setInitialBillServiceIds([]);
      setInitialBillServiceQuantities({});
      setInitialBillStaffId(null);
    }

    navigateTo('invoice');
  };

  const savingBillRef = useRef(false);
  const [isSavingBill, setIsSavingBill] = useState(false);

  const handleProceedToInvoice = async (billData: Parameters<typeof saveBillAndOpenInvoice>[0]) => {
    if (savingBillRef.current) return; // a second tap must not create a second bill
    savingBillRef.current = true;
    setIsSavingBill(true);
    try {
      await saveBillAndOpenInvoice(billData);
    } catch (e: any) {
      Alert.alert('Bill not saved', e?.message || 'Could not save the bill. Please try again.');
    } finally {
      savingBillRef.current = false;
      setIsSavingBill(false);
    }
  };

  const handleDeleteBill = async (billId: string) => {
    if (!currentShop) return;
    const isStylistUser = authMode === 'stylist' || currentUser?.role === 'stylist';
    const deleterName = isStylistUser
      ? currentUser?.fullName || 'Stylist'
      : currentUser?.fullName || ownerName || 'Owner';
    const deleterRole: 'owner' | 'stylist' = isStylistUser ? 'stylist' : 'owner';

    await billingRepository.deleteBill(currentShop.id, billId, deleterName, deleterRole);
    const [updatedBills, freshCusts] = await Promise.all([
      billingRepository.getBills(currentShop.id),
      customerRepository.getCustomers(currentShop.id),
    ]);
    setBills(updatedBills);
    setCustomers(freshCusts);
    if (selectedCustomer) {
      const freshSel = freshCusts.find((c) => c.id === selectedCustomer.id);
      if (freshSel) setSelectedCustomer(freshSel);
    }
    const current = updatedBills.find((b) => b.id === billId);
    if (current) {
      setSelectedBill(current);
    } else {
      goBack();
    }
  };

  const handleRestoreBill = async (billId: string) => {
    if (!currentShop) return;
    await billingRepository.restoreBill(currentShop.id, billId);
    const [updatedBills, freshCusts] = await Promise.all([
      billingRepository.getBills(currentShop.id),
      customerRepository.getCustomers(currentShop.id),
    ]);
    setBills(updatedBills);
    setCustomers(freshCusts);
    if (selectedCustomer) {
      const freshSel = freshCusts.find((c) => c.id === selectedCustomer.id);
      if (freshSel) setSelectedCustomer(freshSel);
    }
    const current = updatedBills.find((b) => b.id === billId);
    if (current) {
      setSelectedBill(current);
    }
  };

  const handleUpdateBillCommunicationStatus = async (
    billId: string,
    updates: { reminder_status?: 'Not Sent' | 'Sent' | 'Pending'; confirmation_status?: 'Pending' | 'Confirmed' }
  ) => {
    if (!currentShop) return;
    try {
      const updated = await billingRepository.updateBillCommunicationStatus(
        currentShop.id,
        billId,
        updates
      );
      setBills((prev) => prev.map((b) => (b.id === billId || b.invoice_number === billId ? updated : b)));
      if (selectedBill && (selectedBill.id === billId || selectedBill.invoice_number === billId)) {
        setSelectedBill(updated);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save the message status');
    }
  };

  const handleQuickAddCustomer = async (name: string, phone: string) => {
    if (!currentShop) throw new Error('No active shop found');
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const existing = customers.find((c) => c.phone.replace(/\D/g, '').slice(-10) === cleanPhone);
    if (existing) {
      Alert.alert(
        'Customer Already Exists',
        `A customer with mobile +91 ${cleanPhone} is already present on file (${existing.name}).\n\nSelected existing customer.`
      );
      return existing;
    }
    const newCust = await customerRepository.addCustomer(currentShop.id, name, phone, 0, false);
    setCustomers((prev) => [newCust, ...prev]);
    return newCust;
  };

  const handleSendInvoiceWhatsApp = async (bill: Bill) => {
    await billingService.shareInvoiceWhatsApp(bill);
    navigateTo('sent');
  };

  // Only the owner decides whether an expense counts in profit; a stylist's expenses always count.
  const handleAddExpense = async (
    cat: string,
    amt: number,
    note: string,
    includeInProfit = true,
    staffId: string | null = null
  ) => {
    if (!currentShop) return;
    try {
      const newExp = await expenseRepository.addExpense(
        currentShop.id,
        cat,
        amt,
        note,
        'UPI',
        isStylist ? true : includeInProfit,
        isStylist ? null : staffId
      );
      setExpenses((prev) => [newExp, ...prev]);
      const refreshed = await expenseRepository.getExpenses(currentShop.id);
      setExpenses(refreshed);
    } catch (e: any) {
      Alert.alert('Expense Error', e.message || 'Could not save expense.');
      throw e;
    }
  };

  const handleUpdateExpense = async (
    expenseId: string,
    category: string,
    amountRupees: number,
    note: string,
    includeInProfit?: boolean,
    staffId?: string | null
  ) => {
    if (!currentShop) return;
    try {
      const updated = await expenseRepository.updateExpense(currentShop.id, expenseId, {
        categoryName: category,
        amountRupees,
        note,
        includeInProfit: isStylist ? undefined : includeInProfit,
        staffId: isStylist ? undefined : staffId,
      });
      if (updated) {
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? updated : e)));
      }
      const refreshed = await expenseRepository.getExpenses(currentShop.id);
      setExpenses(refreshed);
    } catch (e: any) {
      Alert.alert('Expense Error', e.message || 'Could not update expense.');
      throw e;
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!currentShop) return;
    try {
      await expenseRepository.deleteExpense(currentShop.id, expenseId);
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      const refreshed = await expenseRepository.getExpenses(currentShop.id);
      setExpenses(refreshed);
    } catch (e: any) {
      Alert.alert('Expense Error', e.message || 'Could not delete expense.');
      throw e;
    }
  };

  const handleUpdateStaffPermissions = async (staffId: string, permissions: StylistPermissions) => {
    if (!currentShop) throw new Error('No salon selected');
    // Errors propagate to the permissions sheet, which shows them.
    await staffRepository.updateStaffPermissions(currentShop.id, staffId, permissions);
    setStaff((prev) =>
      prev.map((s) => (s.id === staffId ? { ...s, permissions } : s))
    );
  };

  const handleUpdateStaff = async (staffId: string, name: string, phone: string, role?: string) => {
    if (!currentShop) return;
    const updated = await staffRepository.updateStaff(currentShop.id, staffId, { name, phone, role });
    if (updated) {
      setStaff((prev) => prev.map((s) => (s.id === staffId ? updated : s)));
    }
  };

  const handleUpdateStaffRating = async (staffId: string, rating: string) => {
    if (!currentShop) return;
    const updated = await staffRepository.updateStaffRating(currentShop.id, staffId, rating);
    if (updated) {
      setStaff((prev) => prev.map((s) => (s.id === staffId ? updated : s)));
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!currentShop) return;
    await staffRepository.toggleStaffStatus(currentShop.id, staffId);
    setStaff((prev) =>
      prev.map((s) => (s.id === staffId ? { ...s, is_active: !s.is_active } : s))
    );
  };

  const handleSaveShopUpiId = async (newUpi: string) => {
    if (!currentShop) return;
    try {
      const updated = await shopRepository.updateShop(currentShop.id, { upi_id: newUpi });
      setCurrentShop((prev) => (prev ? { ...prev, upi_id: newUpi } : null));
    } catch (e) {
      console.warn('Notice saving shop UPI ID:', e);
    }
  };

  const handleConfirmBooking = async (data: {
    customerName: string;
    customerId?: string | null;
    customerPhone?: string | null;
    serviceName: string;
    serviceId?: string | null;
    serviceIds?: string[];
    stylistName: string;
    stylistId?: string | null;
    stylistIds?: string[];
    serviceQuantities?: Record<string, number>;
    durationMinutes?: number;
    slot: string;
    dateStr: string;
    amountRupees: number;
    sendConfirm: boolean;
  }) => {
    if (!currentShop) return;
    const newAppt = await appointmentRepository.addAppointment({
      shopId: currentShop.id,
      customerName: data.customerName,
      customerId: data.customerId,
      customerPhone: data.customerPhone,
      serviceName: data.serviceName,
      serviceId: data.serviceId,
      serviceIds: data.serviceIds,
      stylistName: data.stylistName,
      stylistId: data.stylistId,
      stylistIds: data.stylistIds,
      serviceQuantities: data.serviceQuantities,
      durationMinutes: data.durationMinutes,
      slot: data.slot,
      dateStr: data.dateStr,
      amountRupees: data.amountRupees,
      sendConfirm: data.sendConfirm,
    });
    setAppointments((prev) => [...prev, newAppt]);
    navigateTo('appointments');
  };

  // Booking screen: wait for the save, tell the user if it failed, ignore a second tap while saving
  const bookingInFlightRef = useRef(false);
  const handleBookingFromScreen = async (data: Parameters<typeof handleConfirmBooking>[0]) => {
    if (bookingInFlightRef.current) return;
    bookingInFlightRef.current = true;
    try {
      await handleConfirmBooking(data);
    } catch (e: any) {
      Alert.alert('Booking failed', e?.message || 'Could not save the booking. Please try again.');
    } finally {
      bookingInFlightRef.current = false;
    }
  };

  // One-tap "Book again" from Home. Returns true when the booking was saved.
  const handleQuickConfirm = async (s: QuickBookSuggestion): Promise<boolean> => {
    if (!checkStylistAccess('appointments', 'Appointments')) return false;

    // Same free-sales limit the full booking screen enforces
    if (totalSalesCount >= freeSalesLimit && !isPro) {
      Alert.alert(
        '100-Sales Limit Reached',
        'You have completed the free limit of 100 sales on this salon account.\n\nPlease upgrade to Pro to continue booking appointments and creating bills.',
        [
          {
            text: 'Upgrade to Pro',
            onPress: () => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setSelectedPlanForModal('6_months');
              setShowPlanSelectionModal(true);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return false;
    }

    try {
      await handleConfirmBooking({
        customerName: s.customer.name,
        customerId: s.customer.id,
        customerPhone: s.customer.phone,
        serviceName: s.services.map((sv) => sv.name).join(' + '),
        serviceId: s.services[0]?.id || null,
        serviceIds: s.services.map((sv) => sv.id),
        stylistName: s.stylist.name,
        stylistId: s.stylist.id,
        stylistIds: s.stylist.id ? [s.stylist.id] : [],
        slot: s.slot,
        dateStr: s.dateStr,
        amountRupees: s.amountRupees,
        sendConfirm: true,
      });
      Alert.alert(t('bookedTitle', 'Booked'), `${s.customer.name} · ${s.slot.replace(/^0/, '')}`);
      return true;
    } catch (e: any) {
      Alert.alert('Booking failed', e?.message || 'Could not save the booking. Please try again.');
      return false;
    }
  };

  const handleAdvanceStatus = async (apptId: string) => {
    if (!currentShop) return;
    try {
      const nextStatus = await appointmentRepository.advanceStatus(currentShop.id, apptId);
      if (nextStatus) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === apptId ? { ...a, status: nextStatus } : a))
        );
      }
    } catch (e: any) {
      Alert.alert('Appointment not updated', e?.message || 'Could not update the appointment. Please try again.');
    }
  };

  const handleEditAppointment = async (
    apptId: string,
    updates: {
      starts_at: string;
      duration_minutes?: number;
      staff_name?: string;
      staff_id?: string | null;
      notes?: string | null;
    }
  ) => {
    if (!currentShop) return;
    const updated = await appointmentRepository.updateAppointment(currentShop.id, apptId, updates);
    setAppointments((prev) =>
      prev.map((a) => (a.id === apptId ? { ...a, ...updates, ...(updated || {}) } : a))
    );
  };

  const handleDeleteAppointment = async (
    apptId: string,
    deletedBy?: { role: 'owner' | 'stylist'; name: string }
  ) => {
    if (!currentShop) return;
    const resolvedRole = deletedBy?.role || (currentUser?.role === 'stylist' ? 'stylist' : 'owner');
    const resolvedName =
      deletedBy?.name ||
      currentUser?.fullName ||
      (resolvedRole === 'stylist' ? 'Stylist' : ownerName || 'Owner');
    await appointmentRepository.deleteAppointment(currentShop.id, apptId, {
      role: resolvedRole,
      name: resolvedName,
    });
    setAppointments((prev) => prev.filter((a) => a.id !== apptId));
  };

  const handleDismissReminder = async (reminderId: string) => {
    if (!currentShop) return;
    try {
      await reminderRepository.dismissReminder(currentShop.id, reminderId);
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not dismiss the reminder');
    }
  };

  const handleToggleRule = async (ruleId: string) => {
    if (!currentShop) return;
    const newOn = await reminderRepository.toggleRule(currentShop.id, ruleId);
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, on: newOn } : r))
    );
  };

  const handleSendDueReminderWhatsApp = (r: ReminderItem) => {
    let custPhone = r.customer_phone;
    let custName = r.customer_name;
    let dueAmt = r.amount_minor ? Math.round(r.amount_minor / 100) : 0;

    if (!custPhone && r.customer_id) {
      const c = customers.find((cust) => cust.id === r.customer_id);
      if (c) {
        custPhone = c.phone;
        custName = c.name;
        if (!dueAmt) dueAmt = Math.round(c.outstanding_due_minor / 100);
      }
    }

    if (!custPhone) {
      const match = customers.find(
        (c) => r.title.toLowerCase().includes(c.name.toLowerCase())
      );
      if (match) {
        custPhone = match.phone;
        custName = match.name;
        if (!dueAmt) dueAmt = Math.round(match.outstanding_due_minor / 100);
      }
    }

    if (!dueAmt) {
      const amtMatch = r.title.match(/₹\s*(\d+[\d,]*)/);
      if (amtMatch && amtMatch[1]) {
        dueAmt = parseInt(amtMatch[1].replace(/,/g, ''), 10);
      }
    }

    const cleanPhone = (custPhone || '').replace(/\D/g, '').slice(-10);
    const sName = currentShop?.name || 'StyleFleet';
    const amountFormatted = dueAmt > 0 ? `₹${dueAmt.toLocaleString('en-IN')}` : 'your pending amount';

    const message =
      `Hello ${custName || 'there'}! 👋\n\n` +
      `This is a gentle payment reminder from *${sName}*.\n` +
      `You are having a due amount of *${amountFormatted}*, please pay.\n\n` +
      `If you have already settled this payment, kindly ignore this reminder.\n\n` +
      `Thank you!\n*${sName}*`;

    if (cleanPhone.length === 10) {
      openWhatsAppPreferred(cleanPhone, message).catch((e: unknown) => Alert.alert('WhatsApp', e instanceof Error ? e.message : 'Could not open WhatsApp.'));
    } else {
      Alert.alert(
        'Phone Number Missing',
        `No valid 10-digit mobile number found for ${custName || 'this customer'}. Please update their mobile number in the Customers tab.`
      );
    }
  };

  const handleSignOut = async () => {
    try {
      await authRepository.signOut();
      await shopRepository.clearCachedShop();
      await AsyncStorage.removeItem('@salon_os_last_phone');
    } catch (e) {
      console.warn('Sign out cleanup error:', e);
    }
    setCurrentUser(null);
    setCurrentShop(null);
    setOwnerName('Owner');
    setBills([]);
    setCustomers([]);
    setStaff([]);
    setExpenses([]);
    setAppointments([]);
    setReminders([]);
    setCategories([]);
    setServices([]);
    setOffers([]);
    setInitialDestination('phone');
    setScreen('phone');
  };

  const isMainTabScreen = ['home', 'customers', 'sales', 'accounts'].includes(screen);

  const insets = useSafeAreaInsets();
  // Safe top padding on Android to comfortably clear status bar icons, clock, and camera punch hole
  const androidTopInset =
    Platform.OS === 'android'
      ? Math.max(insets.top, RNStatusBar.currentHeight || 28) + 12
      : 0;
  const screenTopPadding = screen === 'splash' || screen === 'home' ? 0 : androidTopInset;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <RNStatusBar
        barStyle={colors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
        animated
      />
      {/* Screen Router - SafeAreaView inside child screens manages top insets */}
      <View style={{ flex: 1 }}>
        {screen === 'splash' && (
          <SplashScreen
            isReady={!isInitializing}
            onFinish={async () => {
              const target = initialDestinationRef.current;
              // First-time visitors (not signed in) get a short app tour before login
              if (target === 'phone' && !(await onboardingRepository.hasSeenWelcomeTour())) {
                setScreen('welcomeTour');
                return;
              }
              setScreen(target);
              if (
                target === 'home' ||
                target === 'sales' ||
                target === 'customers' ||
                target === 'accounts'
              ) {
                setActiveTab(target as MainTab);
              }
            }}
          />
        )}

        {screen === 'welcomeTour' && (
          <WelcomeTourScreen
            onFinish={() => {
              onboardingRepository.markWelcomeTourSeen();
              setScreen(initialDestinationRef.current);
            }}
          />
        )}

        {screen === 'home' && (
          <HomeScreen
            onRefresh={refreshShopData}
            shopName={currentShop?.name}
            logoUrl={currentShop?.logo_path}
            remindersCount={reminders.length}
            bills={ownBills}
            isStylist={isStylist}
            totalSalesCount={totalSalesCount}
            shopCreatedAt={currentShop?.created_at}
            isPro={isPro}
            shopId={currentShop?.id}
            customers={customers}
            appointments={appointments}
            services={services}
            staff={staff}
            ownerName={ownerName}
            onBookSlot={() => {
              setSelectedCustomer(null);
              setBookingPreset(null);
              navigateTo('booking');
            }}
            onUpgradePlan={
              currentUser?.role === 'stylist'
                ? undefined
                : () => {
                    setSelectedPlanForModal('6_months');
                    setShowPlanSelectionModal(true);
                  }
            }
            onQuickConfirm={handleQuickConfirm}
            preferredStaffId={isStylist ? currentUser?.stylistId ?? null : null}
            onBookForCustomer={(customer, suggestion) => {
              setSelectedCustomer(customer);
              setBookingPreset(
                suggestion
                  ? {
                      serviceIds: suggestion.services.map((sv) => sv.id),
                      staffIds: suggestion.stylist.id ? [suggestion.stylist.id] : [],
                    }
                  : null
              );
              navigateTo('booking');
            }}
            onNavigateAppointments={() => navigateTo('appointments')}
            onOpenReportsSummary={(period) => {
              setReportsStart({ view: 'summary', period });
              navigateTo('reports');
            }}
            onNavigateSales={() => navigateTo('sales')}
            onNavigateReminders={() => navigateTo('reminders')}
            onNavigateProfile={() => navigateTo('profile')}
            onOpenInvoice={(bill) => {
              setSelectedBill(bill);
              navigateTo('invoice');
            }}
          />
        )}

        {screen === 'phone' && (
          <PhoneScreen
            onSendOtp={(p, m) => handleSendOtp(p, m)}
            onRegisterShop={() => navigateTo('register')}
            stylistInviteContext={stylistInviteContext}
          />
        )}

        {screen === 'otp' && (
          <OtpScreen
            phone={authPhone || 'your mobile'}
            onVerify={handleVerifyOtp}
            onBack={goBack}
            onResendOtp={async () => {
              if (authPhone) {
                await handleSendOtp(authPhone, authMode);
              }
            }}
          />
        )}

        {screen === 'register' && (
          <RegisterScreen
            initialData={pendingRegistration || undefined}
            onNext={handleRegisterNext}
            onBack={confirmCancelRegistration}
          />
        )}

        {screen === 'workers' && (
          <WorkersScreen
            onFinish={handleFinishSetup}
            onBack={goBack}
          />
        )}

        {screen === 'customers' && (
          <CustomersScreen
            allowContactImport={!isStylist}
            onRefresh={refreshShopData}
            customers={customers}
            shopId={currentShop?.id}
            onSelectCustomer={(c) => {
              setSelectedCustomer(c);
              navigateTo('customer');
            }}
            onToggleStar={handleToggleStar}
            onAddCustomer={async (newCust) => {
              let nextCount = customers.length;
              setCustomers((prev) => {
                const cleanPhone = (newCust.phone || '').replace(/\D/g, '').slice(-10);
                const filtered = prev.filter(
                  (c) => (c.phone || '').replace(/\D/g, '').slice(-10) !== cleanPhone
                );
                const next = [newCust, ...filtered];
                nextCount = next.length;
                return next;
              });
              appReviewService.shouldPromptReview(nextCount, totalSalesCount || bills.length).then((shouldPrompt) => {
                if (shouldPrompt) setTimeout(() => setShowReviewModal(true), 1200);
              }).catch(() => {});
              if (currentShop) {
                const refreshed = await billingRepository.getBills(currentShop.id);
                setBills(refreshed);
              }
            }}
            onBatchAddCustomers={async (newCusts) => {
              let nextCount = customers.length;
              setCustomers((prev) => {
                const incomingPhones = new Set(
                  newCusts.map((c) => (c.phone || '').replace(/\D/g, '').slice(-10))
                );
                const filtered = prev.filter(
                  (c) => !incomingPhones.has((c.phone || '').replace(/\D/g, '').slice(-10))
                );
                const next = [...newCusts, ...filtered];
                nextCount = next.length;
                return next;
              });
              appReviewService.shouldPromptReview(nextCount, totalSalesCount || bills.length).then((shouldPrompt) => {
                if (shouldPrompt) setTimeout(() => setShowReviewModal(true), 1200);
              }).catch(() => {});
              if (currentShop) {
                const refreshed = await billingRepository.getBills(currentShop.id);
                setBills(refreshed);
              }
            }}
            onUpdateCustomer={async (updated) => {
              setCustomers((prev) =>
                prev.map((c) => (c.id === updated.id ? updated : c))
              );
              if (selectedCustomer?.id === updated.id) {
                setSelectedCustomer(updated);
              }
              if (currentShop) {
                const refreshed = await billingRepository.getBills(currentShop.id);
                setBills(refreshed);
              }
            }}
            onSettleDue={handleSettleDue}
          />
        )}

        {screen === 'customer' && selectedCustomer && (
          <CustomerDetailScreen
            customer={selectedCustomer}
            bills={bills}
            shopId={currentShop?.id}
            onBack={() => {
              setSelectedCustomer(null);
              goBack();
            }}
            onToggleStar={handleToggleStar}
            onStartBill={(c) => {
              setSelectedCustomer(c);
              setInitialBillServiceId(null);
              setInitialBillServiceIds([]);
              setInitialBillStaffId(null);
              setPendingAppointmentToBill(null);
              navigateTo('bill');
            }}
            onBookSlot={(c) => {
              setSelectedCustomer(c);
              navigateTo('booking');
            }}
            onWhatsApp={() => navigateTo('bulk')}
            onOpenInvoice={(bill) => {
              setSelectedBill(bill);
              navigateTo('invoice');
            }}
            onSettleDue={handleSettleDue}
            onUpdateCustomer={(updated) => {
              setSelectedCustomer(updated);
              setCustomers((prev) =>
                prev.map((c) => (c.id === updated.id ? updated : c))
              );
            }}
            onDeleteCustomer={handleDeleteCustomer}
          />
        )}

        {screen === 'sales' && (
          <SalesScreen
            onRefresh={refreshShopData}
            bills={salesBills}
            shopName={currentShop?.name}
            isStylist={isStylist}
            onOpenInvoice={(bill) => {
              setSelectedBill(bill);
              navigateTo('invoice');
            }}
            onNewBill={() => {
              setEditingBill(null);
              setSelectedCustomer(null);
              setInitialBillServiceId(null);
              setInitialBillServiceIds([]);
              setInitialBillStaffId(null);
              setPendingAppointmentToBill(null);
              navigateTo('bill');
            }}
            onRestoreBill={handleRestoreBill}
          />
        )}

        {screen === 'bill' && (
          <NewBillScreen
            customers={customers}
            services={services}
            staff={staff}
            bills={bills}
            shopId={currentShop?.id}
            shopUpiId={currentShop?.upi_id}
            onSaveUpiId={handleSaveShopUpiId}
            initialCustomerId={selectedCustomer?.id || null}
            initialServiceId={initialBillServiceId}
            initialServiceIds={initialBillServiceIds}
            initialServiceQuantities={initialBillServiceQuantities}
            initialStaffId={initialBillStaffId}
            defaultStaffId={isStylist ? currentUser?.stylistId ?? null : null}
            initialStaffName={pendingAppointmentToBill?.staff_name || null}
            ownerName={ownerName}
            isPro={isPro}
            totalSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            editingBill={editingBill}
            onUpgradePlan={() => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setShowPlanSelectionModal(true);
            }}
            onBack={() => {
              setEditingBill(null);
              setSelectedCustomer(null);
              setInitialBillServiceId(null);
              setInitialBillServiceIds([]);
              setInitialBillServiceQuantities({});
              setInitialBillStaffId(null);
              setPendingAppointmentToBill(null);
              goBack();
            }}
            onAddNewCustomer={handleQuickAddCustomer}
            onProceedToInvoice={handleProceedToInvoice}
            isSavingBill={isSavingBill}
          />
        )}

        {screen === 'invoice' && selectedBill && (
          <InvoiceScreen
            bill={selectedBill}
            shopId={currentShop?.id}
            shopName={currentShop?.name || 'My Salon'}
            shopPhone={currentShop?.phone || authPhone}
            shopUpiId={currentShop?.upi_id}
            onSaveUpiId={handleSaveShopUpiId}
            shopAddress={
              currentShop
                ? `${currentShop.address}, ${currentShop.city} ${currentShop.pin_code}`
                : undefined
            }
            shopGstin={currentShop?.gstin || undefined}
            shopLogoUrl={currentShop?.logo_path || null}
            socialLinks={(currentShop as any)?.social_links || null}
            customerPhone={
              (selectedBill.customer_id
                ? customers.find((c) => c.id === selectedBill.customer_id)?.phone
                : null) ||
              selectedCustomer?.phone ||
              customers.find(
                (c) =>
                  c.name.trim().toLowerCase() ===
                  selectedBill.customer_name.trim().toLowerCase()
              )?.phone ||
              null
            }
            userRole={currentUser?.role}
            isStylist={currentUser?.role === 'stylist'}
            canShareBills={canShareBills(isStylist, stylistPerms)}
            onBack={() => handleTabSelect('sales')}
            onSendWhatsApp={handleSendInvoiceWhatsApp}
            onEditBill={(b) => {
              setEditingBill(b);
              navigateTo('bill');
            }}
            onDeleteBill={handleDeleteBill}
            onRestoreBill={handleRestoreBill}
          />
        )}

        {screen === 'sent' && selectedBill && (
          <SentScreen
            bill={selectedBill}
            shopName={currentShop?.name || 'My Salon'}
            onUpdateStatus={handleUpdateBillCommunicationStatus}
            onNextBill={() => {
              setSelectedCustomer(null);
              navigateTo('bill', true);
            }}
            onDone={() => handleTabSelect('sales')}
          />
        )}

        {screen === 'accounts' && (
          <AccountsScreen
            onRefresh={refreshShopData}
            openRemindersCount={reminders.length}
            bills={bills}
            expenses={visibleExpenses}
            shopId={currentShop?.id}
            shopName={currentShop?.name || 'My Salon'}
            userPhone={currentShop?.phone || authPhone}
            userId={currentUser?.id || currentShop?.owner_profile_id || undefined}
            currentUserRole={currentUser?.role === 'stylist' ? 'stylist' : 'owner'}
            stylistPermissions={stylistPerms}
            initialSocialLinks={currentShop?.social_links as SocialLinks | null}
            onUpdateSocialLinks={async (links) => {
              if (currentShop) {
                setCurrentShop((prev) => (prev ? { ...prev, social_links: links as any } : null));
              }
            }}
            onNavigate={(dest) => navigateTo(dest)}
            onUpgradePlan={
              currentUser?.role === 'stylist'
                ? undefined
                : () => setShowPlanSelectionModal(true)
            }
            isPro={isPro}
            planSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            onAccountDeleted={handleSignOut}
            onSignOut={handleSignOut}
            onPhoneUpdated={(newPhone) => {
              setAuthPhone(newPhone);
              setCurrentShop((prev) => (prev ? { ...prev, phone: newPhone } : null));
            }}
          />
        )}

        {screen === 'expenses' && (
          <ExpensesScreen
            onRefresh={refreshShopData}
            expenses={visibleExpenses}
            todayOnly={isStylist && stylistPerms?.expensesHistory !== true}
            canChooseProfit={!isStylist}
            staff={staff}
            canTagStylist={!isStylist}
            isDownloadLocked={!isPro && totalSalesCount >= freeSalesLimit}
            shopName={currentShop?.name}
            onUpgradePlan={() => setShowPlanSelectionModal(true)}
            onBack={goBack}
            onAddExpense={handleAddExpense}
            onEditExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
          />
        )}

        {screen === 'appointments' && (
          <AppointmentsScreen
            onRefresh={refreshShopData}
            appointments={appointments}
            staff={staff}
            shopId={currentShop?.id}
            shopName={currentShop?.name}
            currentUserRole={currentUser?.role === 'stylist' ? 'stylist' : 'owner'}
            currentUserName={currentUser?.fullName || (currentUser?.role === 'stylist' ? 'Stylist' : ownerName || 'Owner')}
            onBack={goBack}
            onBook={() => {
              setSelectedCustomer(null);
              navigateTo('booking');
            }}
            onAdvanceStatus={handleAdvanceStatus}
            onEditAppointment={handleEditAppointment}
            onDeleteAppointment={handleDeleteAppointment}
            onBillAndClose={(appt) => {
              const matchedCustomer =
                (appt.customer_id ? customers.find((cust) => cust.id === appt.customer_id) : null) ||
                (appt.customer_phone ? customers.find((cust) => cust.phone === appt.customer_phone) : null) ||
                customers.find(
                  (cust) => cust.name.trim().toLowerCase() === appt.customer_name.trim().toLowerCase()
                ) ||
                (appt.customer_phone
                  ? ({
                      id: appt.customer_id || '',
                      name: appt.customer_name,
                      phone: appt.customer_phone,
                      visits: 1,
                      spend: 0,
                      dues: 0,
                      is_starred: false,
                      outstanding_due_minor: 0,
                      total_spend_minor: 0,
                      total_visits: 1,
                    } as any)
                  : null);
              setSelectedCustomer(matchedCustomer);

              // Resolve ALL services and quantities for this appointment
              const apptQuantities: Record<string, number> = {};
              let matchedIds: string[] = [];

              // 1. Direct parsed JSON from notes
              if (appt.notes) {
                try {
                  const parsed = JSON.parse(appt.notes);
                  if (parsed?.service_quantities && typeof parsed.service_quantities === 'object') {
                    for (const [sId, q] of Object.entries(parsed.service_quantities)) {
                      if (q && typeof q === 'number' && q > 0) {
                        apptQuantities[sId] = q;
                        if (!matchedIds.includes(sId)) matchedIds.push(sId);
                      }
                    }
                  }
                  if (matchedIds.length === 0 && Array.isArray(parsed?.service_ids) && parsed.service_ids.length > 0) {
                    for (const sId of parsed.service_ids) {
                      apptQuantities[sId] = (apptQuantities[sId] || 0) + 1;
                      if (!matchedIds.includes(sId)) matchedIds.push(sId);
                    }
                  }
                } catch {
                  // regular string
                }
              }

              // 2. Direct service_ids array
              if (matchedIds.length === 0 && appt.service_ids && appt.service_ids.length > 0) {
                for (const sId of appt.service_ids) {
                  apptQuantities[sId] = (apptQuantities[sId] || 0) + 1;
                  if (!matchedIds.includes(sId)) matchedIds.push(sId);
                }
              }

              // 3. Match services by name (e.g. "Hair Cut × 2 + Beard Trim × 1" or "Haircut + Beard Trim")
              if (appt.service_name) {
                const parts = appt.service_name.split(/\s*[\+,]\s*/);
                for (const part of parts) {
                  const match = part.match(/^(.*?)(?:\s*[×x*]\s*(\d+))?$/i);
                  const rawName = match ? match[1].trim() : part.trim();
                  const qty = match && match[2] ? parseInt(match[2], 10) : 1;
                  const cleaned = rawName.toLowerCase();
                  if (cleaned) {
                    const found = services.find(
                      (s) => s.name.trim().toLowerCase() === cleaned
                    );
                    if (found) {
                      if (!matchedIds.includes(found.id)) {
                        matchedIds.push(found.id);
                        apptQuantities[found.id] = (apptQuantities[found.id] || 0) + (qty || 1);
                      }
                    }
                  }
                }
              }

              // 4. Fallback to single service_id if none matched
              if (matchedIds.length === 0 && appt.service_id) {
                matchedIds.push(appt.service_id);
                apptQuantities[appt.service_id] = 1;
              }

              for (const id of matchedIds) {
                if (!apptQuantities[id]) apptQuantities[id] = 1;
              }

              setInitialBillServiceIds(matchedIds);
              setInitialBillServiceQuantities(apptQuantities);
              setInitialBillServiceId(matchedIds[0] || null);
              setInitialBillStaffId(appt.staff_id || null);
              setPendingAppointmentToBill(appt);
              navigateTo('bill');
            }}
          />
        )}

        {screen === 'booking' && (
          <BookingScreen
            customers={customers}
            services={services}
            staff={staff}
            appointments={appointments}
            initialCustomerId={selectedCustomer?.id || null}
            initialServiceIds={bookingPreset?.serviceIds}
            initialStaffIds={bookingPreset?.staffIds}
            ownerName={ownerName}
            totalSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            isPro={isPro}
            onBack={() => {
              setSelectedCustomer(null);
              goBack();
            }}
            onAddNewCustomer={handleQuickAddCustomer}
            categories={categories}
            onAddNewService={async (cat: string, name: string, priceRupees: number, durationMinutes: number) => {
              if (!currentShop) throw new Error('No active shop');
              const created = await serviceRepository.addService(currentShop.id, cat, name, priceRupees, durationMinutes);
              setServices((prev) => [...prev.filter((x) => x.id !== created.id), created]);
              const reloadedCats = await serviceRepository.getCategories(currentShop.id);
              setCategories(reloadedCats);
              return created;
            }}
            onConfirmBooking={handleBookingFromScreen}
            defaultStaffId={isStylist ? currentUser?.stylistId ?? null : null}
            onUpgradePlan={() => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setSelectedPlanForModal('6_months');
              setShowPlanSelectionModal(true);
            }}
          />
        )}

        {screen === 'reminders' && (
          <RemindersScreen
            onRefresh={refreshShopData}
            reminders={reminders}
            rules={rules}
            onBack={goBack}
            onAction={(r) => {
              if (r.kind === 'support') {
                Alert.alert(
                  r.title,
                  r.sub,
                  [
                    {
                      text: 'Mark as Read',
                      onPress: () => handleDismissReminder(r.id),
                    },
                    { text: 'Close', style: 'cancel' },
                  ]
                );
              } else if (r.kind === 'money') {
                handleSendDueReminderWhatsApp(r);
              } else {
                navigateTo('appointments');
              }
            }}
            onDismiss={handleDismissReminder}
            onToggleRule={handleToggleRule}
          />
        )}

        {screen === 'bulk' && (
          <BulkWhatsAppScreen
            shopName={currentShop?.name || 'My Salon'}
            customers={customers}
            onBack={goBack}
            onSendBulk={({ audience }) => {
              setBulkAudience(audience);
              navigateTo('bulksent');
            }}
          />
        )}

        {screen === 'bulksent' && (
          <BulkSentScreen
            audience={bulkAudience}
            onNewCampaign={() => navigateTo('bulk', true)}
            onDone={() => handleTabSelect('sales')}
          />
        )}

        {screen === 'staff' && (
          <StaffScreen
            onRefresh={refreshShopData}
            staff={staff}
            bills={bills}
            shopId={currentShop?.id}
            shopName={currentShop?.name || 'My Salon'}
            ownerName={ownerName}
            isPro={isPro}
            totalSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            onUpgradePlan={() => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setShowPlanSelectionModal(true);
            }}
            onBack={goBack}
            onAddStaff={async (name, role, phone) => {
              if (!currentShop) return;
              const newMember = await staffRepository.addStaff(currentShop.id, name, role, phone);
              setStaff((prev) => [...prev, newMember]);
            }}
            onUpdateStaff={handleUpdateStaff}
            onUpdateStaffRating={handleUpdateStaffRating}
            onDeleteStaff={handleDeleteStaff}
            onToggleStaffStatus={handleDeleteStaff}
            onUpdateStaffPermissions={handleUpdateStaffPermissions}
            onManage={() => {}}
          />
        )}

        {screen === 'pricing' && (
          <PricingScreen
            services={services}
            offers={offers}
            categories={categories}
            customers={customers}
            shopId={currentShop?.id}
            shopName={currentShop?.name || 'My Salon'}
            onBack={goBack}
            backGuardRef={pricingBackGuardRef}
            onAddCategory={async (catName: string) => {
              if (!currentShop) throw new Error('No active shop');
              const created = await serviceRepository.addCategory(currentShop.id, catName);
              setCategories((prev) => [...prev.filter((c) => c.id !== created.id), created]);
              return created;
            }}
            onAddService={async (cat: string, name: string, price: number) => {
              if (!currentShop) return;
              const created = await serviceRepository.addService(currentShop.id, cat, name, price);
              setServices((prev) => [...prev, created]);
              const reloadedCats = await serviceRepository.getCategories(currentShop.id);
              setCategories(reloadedCats);
            }}
            onUpdateService={async (serviceId, updates) => {
              if (!currentShop) return;
              const updated = await serviceRepository.updateService(currentShop.id, serviceId, updates);
              setServices(updated);
            }}
            onRemoveService={async (serviceId: string) => {
              if (!currentShop) return;
              await serviceRepository.removeService(currentShop.id, serviceId);
              setServices((prev) => prev.filter((s) => s.id !== serviceId));
            }}
            onToggleOffer={async (offerId: string) => {
              if (!currentShop) return;
              const next = await offerRepository.toggleOffer(currentShop.id, offerId);
              setOffers((prev) =>
                prev.map((o) => (o.id === offerId ? { ...o, is_active: next } : o))
              );
            }}
            onRemoveOffer={async (offerId: string) => {
              if (!currentShop) return;
              await offerRepository.removeOffer(currentShop.id, offerId);
              setOffers((prev) => prev.filter((o) => o.id !== offerId));
            }}
            onAddOffer={async (name, description, discountType, discountValue) => {
              if (!currentShop) return;
              const created = await offerRepository.addOffer(currentShop.id, name, description, discountType, discountValue);
              setOffers((prev) => [...prev, created]);
            }}
            onImportMenuAI={async (items) => {
              if (!currentShop) return;
              const knownIds = new Set(services.map((sv) => sv.id));
              let imported: Service[];
              try {
                imported = await serviceRepository.importMenuFromAI(currentShop.id, items);
              } catch (e) {
                // Whatever was saved before the failure is real, so show it before reporting the error
                setServices(await serviceRepository.getServices(currentShop.id));
                setCategories(await serviceRepository.getCategories(currentShop.id));
                throw e;
              }
              setServices(imported);
              const reloadedCats = await serviceRepository.getCategories(currentShop.id);
              setCategories(reloadedCats);
              return { added: imported.filter((sv) => !knownIds.has(sv.id)).length };
            }}
          />
        )}

        {screen === 'profile' && currentShop && (
          <ShopProfileScreen
            shopId={currentShop.id}
            shopName={currentShop.name}
            ownerName={ownerName}
            phone={currentShop.phone || authPhone || '9800000000'}
            userId={currentUser?.id || currentShop.owner_profile_id || undefined}
            address={currentShop.address || ''}
            city={currentShop.city || ''}
            pinCode={currentShop.pin_code || ''}
            gstin={currentShop.gstin || undefined}
            upiId={currentShop.upi_id || ''}
            logoUrl={currentShop.logo_path}
            currentGstRate={currentShop.gst_rate}
            teamCount={staff.length}
            invoicePrefix={(currentShop as any).invoice_prefix}
            shopCreatedAt={currentShop.created_at}
            isPro={isPro}
            totalSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            onBack={goBack}
            onUpgradePlan={() => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setSelectedPlanForModal('6_months');
              setShowPlanSelectionModal(true);
            }}
            onUpdateUpiId={handleSaveShopUpiId}
            onUpdateInvoicePrefix={async (prefix: string) => {
              await shopRepository.setInvoicePrefix(currentShop.id, prefix);
              setCurrentShop((prev) => (prev ? { ...prev, invoice_prefix: prefix } : null));
            }}
            onUpdateShop={async (updatedShopData) => {
              setCurrentShop((prev) => (prev ? { ...prev, ...updatedShopData } : null));
              if (updatedShopData?.owner_name) {
                setOwnerName(updatedShopData.owner_name);
              }
            }}
            onUpdateLogo={async (logoPath) => {
              const updated = await shopRepository.updateShop(currentShop.id, { logo_path: logoPath });
              setCurrentShop((prev) => (prev ? { ...prev, logo_path: updated?.logo_path || logoPath } : null));
            }}
            onUpdateGstRate={async (gstRate) => {
              await shopRepository.updateShop(currentShop.id, { gst_rate: gstRate });
              setCurrentShop((prev) => (prev ? { ...prev, gst_rate: gstRate } : null));
            }}
            onAccountDeleted={handleSignOut}
            onPhoneUpdated={(newPhone) => {
              setAuthPhone(newPhone);
              setCurrentShop((prev) => (prev ? { ...prev, phone: newPhone } : null));
            }}
          />
        )}

        {screen === 'reports' && (
          <ReportsScreen
            initialView={reportsStart.view}
            initialPeriod={reportsStart.period}
            bills={reportBills}
            expenses={reportsFullAccess ? visibleExpenses : []}
            staff={staff}
            customers={customers}
            appointments={appointments}
            shopId={currentShop?.id}
            shopName={currentShop?.name || 'My Salon'}
            ownerName={ownerName}
            shopAddress={
              currentShop
                ? `${currentShop.address || ''}, ${currentShop.city || ''} ${currentShop.pin_code || ''}`.trim()
                : undefined
            }
            shopGstin={currentShop?.gstin || undefined}
            isPro={isPro}
            totalSalesCount={totalSalesCount}
            freeSalesLimit={freeSalesLimit}
            onUpgradePlan={() => {
              if (currentUser?.role === 'stylist') {
                Alert.alert('Owner Action Only', 'Only the salon owner can upgrade subscription plans.');
                return;
              }
              setShowPlanSelectionModal(true);
            }}
            onRefresh={async () => {
              if (currentShop) {
                await loadShopData(currentShop.id);
              }
            }}
            onBack={goBack}
          />
        )}
      </View>

      {/* Persistent Bottom Tab Bar (shown exclusively on main tabs) */}
      {isMainTabScreen && (
        <BottomTabBar
          currentTab={activeTab}
          onTabSelect={handleTabSelect}
          isStylist={isStylist}
          stylistPermissions={stylistPerms}
        />
      )}

      {/* Interactive App Onboarding Tour */}
      <OnboardingTourModal
        visible={showTour}
        shopName={currentShop?.name}
        onFinish={() => setShowTour(false)}
        onTabChange={(tab) => handleTabSelect(tab)}
      />

      {/* Plan Selection Modal (Home & Accounts upgrade trigger) */}
      <PlanSelectionModal
        visible={showPlanSelectionModal}
        onClose={() => setShowPlanSelectionModal(false)}
        shopId={currentShop?.id || ''}
        ownerName={ownerName || currentShop?.name || 'Owner'}
        phone={currentShop?.phone || authPhone || ''}
        registrationDateIso={currentShop?.created_at || (currentUser as any)?.created_at || null}
        initialPlanId={selectedPlanForModal}
        onPlanActivated={async () => {
          setShowPlanSelectionModal(false);
          setIsPro(true);
          if (currentShop) {
            await loadShopData(currentShop.id);
          }
          Alert.alert('Plan Activated', 'Your StyleFleet subscription has been activated successfully!');
        }}
      />

      {/* Mandatory Version Update Modal (blocks app when outdated) */}
      {versionCheck && (
        <UpdateRequiredModal
          visible={versionCheck.isMandatoryUpdateRequired}
          currentVersion={versionCheck.currentVersion}
          latestVersion={versionCheck.latestVersion}
          releaseNotes={versionCheck.releaseNotes}
          storeUrl={versionCheck.storeUrl}
          onUpdate={() => versionService.openAppUpdateStore(versionCheck.storeUrl)}
          onCheckAgain={runVersionCheck}
        />
      )}

      {/* 10 Bills Milestone App Review Modal */}
      <AppReviewModal
        visible={showReviewModal}
        onRate={handleRateApp}
        onRemindLater={handleDismissReview}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
