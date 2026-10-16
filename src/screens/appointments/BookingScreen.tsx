import { findDuplicateService } from '../../utils/serviceName';
import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { BackIcon, CheckIcon, SearchIcon, PlusIcon, UserPlusIcon, UsersIcon } from '../../components/common/SvgIcons';
import { Customer, StaffMember, Service, ServiceCategory, Appointment } from '../../types/domain';
import { inr, inrFromMinor, getInitials } from '../../utils/format';
import { radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/common/Button';
import { QuickContactPickerModal } from '../../components/customers/QuickContactPickerModal';
import { shopRepository } from '../../repositories/shopRepository';

import type { BlockedSlot } from '../../services/bookingSlots';
import {
  generateTimeSlots,
  findBlockedSlots,
  formatDuration,
  formatMinutesToAmPm,
  DEFAULT_APPOINTMENT_MINUTES,
} from '../../services/bookingSlots';
import { toLocalDateStr } from '../../utils/dateUtils';
import { getGlass } from '../../theme/glass';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { fmt, localeFor } from '../../i18n/format';
import { orderServicesForQuickPick } from '../../services/servicePriority';
import { FREE_SALES_LIMIT } from '../../utils/subscriptionUtils';

// Re-exported so existing imports from this screen keep working
export {
  parseTimeToMinutes,
  formatMinutesToAmPm,
  generateTimeSlots,
  DEFAULT_ALL_TIME_SLOTS,
} from '../../services/bookingSlots';

interface BookingScreenProps {
  customers: Customer[];
  services: Service[];
  staff: StaffMember[];
  appointments?: Appointment[];
  initialCustomerId?: string | null;
  initialServiceIds?: string[];
  initialStaffIds?: string[];
  /** The logged-in stylist's id (stylist sessions only): pre-selected as the stylist. */
  defaultStaffId?: string | null;
  onBack: () => void;
  onAddNewCustomer?: (name: string, phone: string) => Promise<Customer>;
  categories?: ServiceCategory[];
  onAddNewService?: (category: string, name: string, priceRupees: number, durationMinutes: number) => Promise<Service>;
  onConfirmBooking: (booking: {
    customerName: string;
    customerId?: string | null;
    customerPhone?: string | null;
    serviceName: string;
    serviceId?: string | null;
    serviceIds?: string[];
    serviceQuantities?: Record<string, number>;
    durationMinutes?: number;
    stylistName: string;
    stylistId?: string | null;
    stylistIds?: string[];
    slot: string;
    dateStr: string;
    amountRupees: number;
    sendConfirm: boolean;
  }) => void;
  ownerName?: string;
  totalSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  isPro?: boolean;
  onUpgradePlan?: () => void;
}

export const BookingScreen = ({
  customers,
  services,
  staff,
  appointments = [],
  initialCustomerId,
  initialServiceIds,
  initialStaffIds,
  defaultStaffId = null,
  ownerName = 'Owner',
  totalSalesCount = 0,
  freeSalesLimit = FREE_SALES_LIMIT,
  isPro = false,
  onBack,
  onAddNewCustomer,
  categories = [],
  onAddNewService,
  onConfirmBooking,
  onUpgradePlan,
}: BookingScreenProps) => {
  const { colors } = useTheme();
  const glass = getGlass(colors.isDark);
  const { t, language } = useLanguage();
  const tf = (key: string, fallback: string, vars: Record<string, string | number> = {}) =>
    fmt(t(key, fallback), vars);
  const units = { min: t('unitMin', 'min'), hr: t('unitHr', 'hr') };
  const fd = (minutes: number) => formatDuration(minutes, units);

  // Customer selection state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialCustomerId || null
  );
  const [customerSearch, setCustomerSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);

  // Add-new-service sheet (saved to the price list)
  const DURATION_CHOICES = [15, 30, 45, 60, 90];
  const [isAddServiceOpen, setIsAddServiceOpen] = useState(false);
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcPrice, setNewSvcPrice] = useState('');
  const [newSvcDuration, setNewSvcDuration] = useState(30);
  const [newSvcCategory, setNewSvcCategory] = useState('');
  const [newSvcErrors, setNewSvcErrors] = useState<{ name?: string; price?: string }>({});
  const [isSavingService, setIsSavingService] = useState(false);
  const [clientErrors, setClientErrors] = useState<{ name?: string; phone?: string }>({});
  const [focusedClientField, setFocusedClientField] = useState<'name' | 'phone' | null>(null);

  const orderedServices = useMemo(() => orderServicesForQuickPick(services), [services]);

  const serviceCategoryNames = useMemo(() => {
    const names = categories.map((c) => c.name).filter(Boolean);
    return names.length > 0 ? names : ['Hair', 'Beard', 'Colour', 'Care', 'Packages'];
  }, [categories]);

  const openAddService = () => {
    setNewSvcName('');
    setNewSvcPrice('');
    setNewSvcDuration(30);
    setNewSvcCategory(serviceCategoryNames[serviceCategoryNames.length - 1]);
    setNewSvcErrors({});
    setIsAddServiceOpen(true);
  };

  const closeAddService = () => {
    if (isSavingService) return;
    setIsAddServiceOpen(false);
  };

  const handleSaveNewService = async () => {
    if (isSavingService || !onAddNewService) return;
    const errors: { name?: string; price?: string } = {};
    const trimmed = newSvcName.trim();
    if (!trimmed) errors.name = t('bkErrSvcName', 'Enter the service name');
    else if (findDuplicateService(services, trimmed)) {
      errors.name = t('bkErrSvcDup', 'This service is already in your price list');
    }
    const price = parseFloat(newSvcPrice);
    if (!newSvcPrice.trim() || isNaN(price) || price < 0) errors.price = t('bkErrPrice', 'Enter a valid price');
    setNewSvcErrors(errors);
    if (errors.name || errors.price) return;

    setIsSavingService(true);
    try {
      const created = await onAddNewService(newSvcCategory || serviceCategoryNames[0], trimmed, price, newSvcDuration);
      // Select it right away
      setSelectedServiceIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setServiceQuantities((prev) => ({ ...prev, [created.id]: 1 }));
      setIsAddServiceOpen(false);
    } catch (e: any) {
      Alert.alert(t('bkSvcSaveFail', 'Could not save service'), e?.message || t('bkTryAgain', 'Please try again.'));
    } finally {
      setIsSavingService(false);
    }
  };

  const closeAddClientModal = () => {
    setIsAddClientModalOpen(false);
    setClientErrors({});
    setFocusedClientField(null);
  };
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

  // Dynamic booking hours from shop settings
  const [bookingHours, setBookingHours] = useState<{ startTime: string; endTime: string }>({
    startTime: '09:30 AM',
    endTime: '08:30 PM',
  });

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const hours = await shopRepository.getBookingHours();
        if (isMounted) {
          setBookingHours(hours);
        }
      } catch {
        // default
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const timeSlots = useMemo(() => {
    return generateTimeSlots(bookingHours.startTime, bookingHours.endTime);
  }, [bookingHours.startTime, bookingHours.endTime]);

  // Service multi-selection & Multi-quantity state (no services pre-selected)
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(initialServiceIds || []);
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>(() =>
    (initialServiceIds || []).reduce<Record<string, number>>((acc, id) => {
      acc[id] = 1;
      return acc;
    }, {})
  );

  // Stylist selection: can select 1 or 2 stylists, or "No Stylist (Owner)".
  const [isServicesExpanded, setIsServicesExpanded] = useState(true);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(() => {
    if (initialStaffIds && initialStaffIds.length > 0) return initialStaffIds;
    return defaultStaffId && staff.some((s) => s.id === defaultStaffId && s.is_active !== false) ? [defaultStaffId] : [];
  });
  // No active stylists: only the owner can serve, so the stylist step is skipped and the owner is booked.
  const ownerOnly = !staff.some((s) => s.is_active !== false);
  const [isOwnerSelected, setIsOwnerSelected] = useState<boolean>(ownerOnly);
  useEffect(() => {
    if (ownerOnly) setIsOwnerSelected(true);
  }, [ownerOnly]);

  // Date selection - yesterday (for back-dated entries), today and the next 13 days. Today is pre-selected.
  const [selectedDayOffset, setSelectedDayOffset] = useState<number | null>(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [sendConfirm, setSendConfirm] = useState(true);

  // Yesterday, then today and the next 13 days (offset is relative to today)
  const upcomingDays = useMemo(() => {
    const days: { offset: number; dateStr: string; dayLabel: string; dateNum: number; fullDate: Date }[] = [];
    const now = new Date();
    for (let i = -1; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dayLabel =
        i === -1
          ? t('yesterday', 'Yest.')
          : i === 0
          ? t('today')
          : d.toLocaleDateString(localeFor(language), { weekday: 'short' });
      const dateNum = d.getDate();
      const dateStr = toLocalDateStr(d);
      days.push({ offset: i, dateStr, dayLabel, dateNum, fullDate: d });
    }
    return days;
  }, [t, language]);

  const selectedDay =
    selectedDayOffset !== null ? upcomingDays.find((d) => d.offset === selectedDayOffset) || null : null;

  // Check if slot has already passed if today is selected
  const now = new Date();
  const isSelectedDateToday = selectedDayOffset === 0;

  // Filtered customers for search
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 5);
    const q = customerSearch.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null;

  const selectedStaffMembers = useMemo(() => {
    return selectedStaffIds
      .map((id) => staff.find((s) => s.id === id))
      .filter((s): s is StaffMember => Boolean(s));
  }, [selectedStaffIds, staff]);

  const combinedStylistName = useMemo(() => {
    const names: string[] = [];
    if (isOwnerSelected) {
      names.push(ownerName || 'Owner');
    }
    selectedStaffMembers.forEach((s) => {
      names.push(s.name);
    });

    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }, [isOwnerSelected, selectedStaffMembers, ownerName]);

  const hasStylistSelection = isOwnerSelected || selectedStaffIds.length > 0;
  // A logged-in stylist always books as themselves: no stylist choice is shown
  const stylistLocked = Boolean(defaultStaffId) && staff.some((s) => s.id === defaultStaffId && s.is_active !== false);

  // Total time the new booking needs (sum of service durations x quantity)
  const totalDurationMinutes = useMemo(() => {
    const total = services
      .filter((sv) => selectedServiceIds.includes(sv.id))
      .reduce((acc, sv) => acc + (sv.duration_minutes || 0) * (serviceQuantities[sv.id] || 1), 0);
    return total > 0 ? total : DEFAULT_APPOINTMENT_MINUTES;
  }, [services, selectedServiceIds, serviceQuantities]);

  // Conflicts for every chosen person (named stylists and/or the owner), duration-aware
  const bookedSlotsMap = useMemo(() => {
    if (!hasStylistSelection || !selectedDay) {
      return new Map<string, BlockedSlot>();
    }
    const people: { id: string | null; name: string }[] = selectedStaffMembers.map((m) => ({
      id: m.id,
      name: m.name,
    }));
    if (isOwnerSelected) people.push({ id: null, name: ownerName || 'Owner' });
    return findBlockedSlots(appointments, people, selectedDay.dateStr, timeSlots, totalDurationMinutes);
  }, [
    hasStylistSelection,
    isOwnerSelected,
    ownerName,
    selectedDay,
    selectedStaffMembers,
    appointments,
    timeSlots,
    totalDurationMinutes,
  ]);

  // Deselect slot if it conflicts with a booked slot
  React.useEffect(() => {
    if (selectedSlot && bookedSlotsMap.has(selectedSlot)) {
      setSelectedSlot(null);
    }
  }, [selectedSlot, bookedSlotsMap]);

  // Selected services list & totals with multi-quantity
  const selectedServices = useMemo(() => {
    return services.filter((s) => selectedServiceIds.includes(s.id));
  }, [services, selectedServiceIds]);

  const totalBookingRupees = useMemo(() => {
    return selectedServices.reduce((acc, s) => {
      const qty = serviceQuantities[s.id] || 1;
      return acc + Math.round(s.price_minor / 100) * qty;
    }, 0);
  }, [selectedServices, serviceQuantities]);

  const combinedServiceName = useMemo(() => {
    return selectedServices
      .map((s) => {
        const qty = serviceQuantities[s.id] || 1;
        return qty > 1 ? `${s.name} × ${qty}` : s.name;
      })
      .join(' + ') || '';
  }, [selectedServices, serviceQuantities]);

  const totalSelectedCount = useMemo(() => {
    return selectedServiceIds.reduce((sum, id) => sum + (serviceQuantities[id] || 1), 0);
  }, [selectedServiceIds, serviceQuantities]);

  // Each tap adds one (1 tap = 1, 2 taps = 2 ...). After the max, the next tap removes it; long-press removes at once.
  const MAX_SERVICE_QTY = 5;

  const removeService = (svcId: string) => {
    setSelectedServiceIds((prev) => prev.filter((id) => id !== svcId));
    setServiceQuantities((prev) => {
      const next = { ...prev };
      delete next[svcId];
      return next;
    });
  };

  const toggleService = (svcId: string) => {
    const current = serviceQuantities[svcId] || 0;
    if (current >= MAX_SERVICE_QTY) {
      removeService(svcId);
      return;
    }
    if (current === 0) {
      setSelectedServiceIds((prev) => (prev.includes(svcId) ? prev : [...prev, svcId]));
    }
    setServiceQuantities((prev) => ({ ...prev, [svcId]: current + 1 }));
  };

  // Categorised service groups
  const categoryGroups = useMemo(() => {
    const categories = ['Hair', 'Beard', 'Colour', 'Care', 'Packages'] as const;
    const groups: { category: string; services: Service[] }[] = [];

    for (const cat of categories) {
      const catServices = services.filter((s) => s.category_name === cat);
      if (catServices.length > 0) {
        groups.push({ category: cat, services: catServices });
      }
    }

    const otherServices = services.filter(
      (s) => !categories.includes(s.category_name as any)
    );
    if (otherServices.length > 0) {
      groups.push({ category: 'Other Services', services: otherServices });
    }

    return groups;
  }, [services]);

  // Popular services sorted at top
  const popularServices = useMemo(() => {
    return services.slice(0, 6);
  }, [services]);

  const handleQuickAddClient = async () => {
    if (isSavingClient) return;
    const errors: { name?: string; phone?: string } = {};
    if (!newClientName.trim()) errors.name = t('bkErrName', 'Please enter the customer name');
    const cleanPhone = newClientPhone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) errors.phone = t('bkErrPhone', 'Enter a valid 10-digit mobile number');
    setClientErrors(errors);
    if (errors.name || errors.phone) return;

    // Check if phone already belongs to an existing customer
    const existing = customers.find((c) => c.phone.replace(/\D/g, '').slice(-10) === cleanPhone);
    if (existing) {
      Alert.alert(
        t('bkExistsTitle', 'Customer Already Exists'),
        tf('bkExistsMsg', 'A customer with mobile +91 {phone} already exists ({name}). Selected existing customer.', {
          phone: cleanPhone,
          name: existing.name,
        })
      );
      setSelectedCustomerId(existing.id);
      closeAddClientModal();
      setNewClientName('');
      setNewClientPhone('');
      setCustomerSearch('');
      return;
    }

    setIsSavingClient(true);
    try {
      if (onAddNewCustomer) {
        const created = await onAddNewCustomer(newClientName.trim(), cleanPhone);
        setSelectedCustomerId(created.id);
      }
      closeAddClientModal();
      setNewClientName('');
      setNewClientPhone('');
      setCustomerSearch('');
    } catch (e: any) {
      Alert.alert(t('bkNotice', 'Notice'), e.message || t('bkSaveClientFail', 'Could not save customer'));
    } finally {
      setIsSavingClient(false);
    }
  };

  const isSelectedSlotLocked = Boolean(selectedSlot && bookedSlotsMap.has(selectedSlot));

  // Client is optional: no client books as a walk-in
  const bookIncomplete =
    selectedServices.length === 0 ||
    !hasStylistSelection ||
    selectedDayOffset === null ||
    !selectedDay ||
    !selectedSlot ||
    isSelectedSlotLocked;

  const handleConfirm = () => {
    // 100-sales free limit check: appointments and billing require Pro after 100 sales
    if (totalSalesCount >= freeSalesLimit && !isPro) {
      Alert.alert(
        t('bkLimitTitle', '100-Sales Limit Reached').replace('100', String(freeSalesLimit)),
        t('bkLimitMsg', 'You have completed the free limit of 100 sales on this salon account. Please upgrade to Pro to continue booking appointments and creating bills.').replace('100', String(freeSalesLimit)),
        [
          { text: t('bkUpgrade', 'Upgrade to Pro'), onPress: () => onUpgradePlan?.() },
          { text: t('cancel', 'Cancel'), style: 'cancel' },
        ]
      );
      return;
    }

    if (bookIncomplete || !selectedDay) return;

    const custName = selectedCustomer?.name || t('bkWalkIn', 'Walk-in');
    const custPhone = selectedCustomer?.phone ?? null;
    const stylistName = combinedStylistName || (ownerName || 'Owner');

    onConfirmBooking({
      customerName: custName,
      customerId: selectedCustomer?.id ?? null,
      customerPhone: custPhone,
      serviceName: combinedServiceName,
      serviceId: selectedServiceIds[0] || null,
      serviceIds: selectedServiceIds,
      serviceQuantities: serviceQuantities,
      stylistName: stylistName,
      stylistId: selectedStaffIds[0] || null,
      stylistIds: selectedStaffIds,
      slot: selectedSlot!,
      dateStr: selectedDay.dateStr,
      amountRupees: totalBookingRupees,
      durationMinutes: totalDurationMinutes,
      sendConfirm: sendConfirm && Boolean(selectedCustomer),
    });
  };

  const ctaText = selectedServices.length === 0
    ? t('selectServices')
    : !hasStylistSelection
    ? t('bkCtaSelectStylist', 'Select Stylist')
    : selectedDayOffset === null || !selectedDay
    ? t('bkCtaSelectDate', 'Select Date')
    : !selectedSlot
    ? t('bkCtaSelectSlot', 'Select Time Slot')
    : isSelectedSlotLocked
    ? t('bkCtaLocked', 'Slot Locked · Pick Another Slot')
    : `${t('confirmBooking')} · ${selectedDay.dayLabel} ${selectedSlot}`;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.topBar}>
        <Button variant="icon" onPress={onBack}>
          <BackIcon size={18} color={colors.text} />
        </Button>
        <Text style={[styles.title, { color: colors.text }]}>{t('newAppointment')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(140, keyboardHeight + 80) },
        ]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setIsSearchFocused(false)}
        automaticallyAdjustKeyboardInsets={true}
        showsVerticalScrollIndicator={false}
      >
        {/* ======================================================== */}
        {/* 1. CUSTOMER SELECTION (Exact match to NewBillScreen UX) */}
        {/* ======================================================== */}
        <Text style={[styles.sectionLabel, { color: colors.textDim }]}>{t('client')}</Text>
        <View style={styles.customerActionRow}>
          {/* Customer Search Box */}
          <View
            style={[
              styles.customerSearchBox,
              {
                backgroundColor: glass.card.backgroundColor,
                borderColor: isSearchFocused ? colors.accent : glass.card.borderColor,
                flex: 1,
              },
            ]}
          >
            <SearchIcon size={15} color={colors.textDim} />
            <TextInput
              style={[styles.customerSearchInput, { color: colors.text }]}
              placeholder={t('bkSearchClient', 'Search client name or phone...')}
              placeholderTextColor={colors.placeholder || colors.textDim}
              value={customerSearch}
              onChangeText={(txt) => {
                setCustomerSearch(txt);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
            />
            {customerSearch.length > 0 && (
              <TouchableOpacity onPress={() => setCustomerSearch('')}>
                <Text style={{ color: colors.textDim, paddingHorizontal: 4 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Add Client Button (Icon Only) */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setIsAddClientModalOpen(true)}
            accessibilityLabel={t('addClient', 'Add Client')}
            style={[
              styles.addClientBtn,
              {
                backgroundColor: glass.card.backgroundColor,
                borderColor: glass.card.borderColor,
              },
            ]}
          >
            <UserPlusIcon size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Selected Customer Highlight Card */}
        {selectedCustomer && (
          <View
            style={[
              styles.selectedCustomerCard,
              {
                backgroundColor: colors.accent900,
                borderColor: colors.accent,
              },
            ]}
          >
            <View
              style={[
                styles.smallAvatar,
                { backgroundColor: selectedCustomer.is_starred ? colors.accent : colors.accent800 },
              ]}
            >
              <Text style={{ color: colors.bg, fontSize: 11, fontWeight: '700' }}>
                {getInitials(selectedCustomer.name)}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.selectedCustName, { color: colors.accent100 }]}>
                  {selectedCustomer.name}
                </Text>
                {selectedCustomer.is_starred && (
                  <Text style={{ color: colors.accent, fontSize: 11, fontWeight: 'bold' }}>★ MVP</Text>
                )}
              </View>
              <Text style={{ color: colors.accent200, fontSize: 11 }}>+91 {selectedCustomer.phone}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedCustomerId(null)}
              style={styles.removeSelectedCustBtn}
            >
              <Text style={{ color: colors.accent200, fontSize: 12 }}>{t('bkDeselect', '✕ Deselect')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Customer Search Dropdown */}
        {isSearchFocused && !selectedCustomer && (
          <View
            style={[
              styles.searchDropdown,
              {
                backgroundColor: glass.card.backgroundColor,
                borderColor: glass.card.borderColor,
              },
            ]}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderBottomWidth: 1,
                borderBottomColor: colors.divider,
                backgroundColor: colors.accent + '15',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.accent }}>
                {customerSearch.trim().length === 0
                  ? tf('bkSelectClientCount', 'Select Client ({n} on file)', { n: customers.length })
                  : tf('bkFound', '{n} found', { n: filteredCustomers.length })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setIsSearchFocused(false);
                  Keyboard.dismiss();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ fontSize: 11, color: colors.textDim }}>{t('bkClose', 'Close ✕')}</Text>
              </TouchableOpacity>
            </View>
            {filteredCustomers.length === 0 ? (
              <View style={{ padding: 14, alignItems: 'center' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>
                  {customerSearch.trim().length > 0
                    ? tf('bkNoMatch', 'No customer matching "{name}"', { name: customerSearch })
                    : t('bkNoCustomers', 'No customers on file yet')}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setNewClientName(customerSearch);
                    setIsAddClientModalOpen(true);
                    setIsSearchFocused(false);
                  }}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '600' }}>
                    {customerSearch.trim().length > 0
                      ? tf('bkCreateName', '+ Create "{name}"', { name: customerSearch })
                      : t('bkAddNewClient', '+ Add new client')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 170 }}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={true}
              >
                {filteredCustomers.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedCustomerId(c.id);
                      setCustomerSearch('');
                      setIsSearchFocused(false);
                      Keyboard.dismiss();
                    }}
                    style={[styles.dropdownItem, { borderBottomColor: colors.divider }]}
                  >
                    <Text style={[styles.dropdownName, { color: colors.text }]}>{c.name}</Text>
                    <Text style={[styles.dropdownPhone, { color: colors.textDim }]}>+91 {c.phone}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {filteredCustomers.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setNewClientName(customerSearch);
                  setIsAddClientModalOpen(true);
                  setIsSearchFocused(false);
                }}
                style={{ paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider }}
              >
                <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '600' }}>
                  {customerSearch.trim().length > 0
                    ? tf('bkCreateName', '+ Create "{name}"', { name: customerSearch })
                    : t('bkAddNewClient', '+ Add new client')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!selectedCustomer && !isSearchFocused && (
          <Text style={{ color: colors.textDim, fontSize: 11.5, marginTop: 6 }}>
            {t('noClientHint', 'No client selected. You can still book it as a Walk-in.')}
          </Text>
        )}

        {/* ======================================================== */}
        {/* 2. SERVICES (Expandable Multi-Choice)                   */}
        {/* ======================================================== */}
        {/* ======================================================== */}
        {/* 2. CHOOSE SERVICES TRIGGER BOX                           */}
        {/* ======================================================== */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setIsServicesExpanded((prev) => !prev)}
          accessibilityLabel={isServicesExpanded ? t('bkCollapse', 'Collapse services') : t('bkExpand', 'Expand services')}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 7 }}
        >
          <Text style={[styles.sectionLabel, { color: colors.textDim, marginBottom: 0 }]}>
            {t('services')} ({totalSelectedCount} {t('selected', 'selected')})
          </Text>
          <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '700' }}>
            {isServicesExpanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {!isServicesExpanded && (
          <Text style={{ color: selectedServices.length > 0 ? colors.accent : colors.textDim, fontSize: 12.5, marginBottom: 8 }}>
            {combinedServiceName || t('bkNoSvcSelected', 'No services selected')}
          </Text>
        )}

        {/* Always-visible grid; selected cards get a - qty + stepper */}
        {isServicesExpanded && (
        <>
        <Text style={{ color: colors.textDim, fontSize: 11, marginBottom: 6 }}>
          {t('serviceTapHint', 'Tap once for 1, twice for 2 · hold to remove')}
        </Text>
        <View style={[styles.servicesGridContainer, glass.card]}>
          {services.length === 0 ? (
            <View style={{ paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>{t('bkNoServices', 'No services yet. Tap + to add your first one.')}</Text>
            </View>
          ) : null}
          {(
            <View style={styles.threeColumnGrid}>
              {orderedServices.map((s) => {
                const qty = serviceQuantities[s.id] || 0;
                const isSelected = selectedServiceIds.includes(s.id);
                return (
                  <TouchableOpacity
                    key={s.id}
                    activeOpacity={0.75}
                    onPress={() => toggleService(s.id)}
                    onLongPress={() => isSelected && removeService(s.id)}
                    delayLongPress={350}
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.squareServiceCard,
                      {
                        backgroundColor: isSelected ? colors.accent + '1F' : glass.pill.backgroundColor,
                        borderColor: isSelected ? colors.accent : glass.card.borderColor,
                        borderWidth: isSelected ? 1.5 : 1,
                      },
                    ]}
                  >
                    {isSelected ? (
                      <View style={[styles.qtyBadge, { backgroundColor: colors.accent }]}>
                        <Text style={{ color: '#161826', fontSize: 10.5, fontWeight: '800' }}>×{qty}</Text>
                      </View>
                    ) : null}
                    <Text
                      style={[styles.squareServiceName, { color: isSelected ? colors.accent100 : colors.text }]}
                      numberOfLines={2}
                    >
                      {s.name}
                    </Text>
                    <Text style={[styles.squareServicePrice, { color: isSelected ? colors.accent : colors.textDim }]}>
                      {inrFromMinor(s.price_minor)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {onAddNewService ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={openAddService}
                  accessibilityLabel="Add a new service to the price list"
                  style={[
                    styles.squareServiceCard,
                    {
                      borderStyle: 'dashed',
                      borderColor: colors.accent,
                      backgroundColor: colors.accent + '12',
                    },
                  ]}
                >
                  <PlusIcon size={18} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{t('bkNew', 'New')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
        </>
        )}

        {/* ======================================================== */}
        {/* 3. STYLIST (Single or Multiple Stylists)                 */}
        {/* ======================================================== */}
        {!ownerOnly && (
        <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
          <Text style={[styles.sectionLabel, { color: colors.textDim }]}>
            {t('staff')}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '500' }}>
            ({t('selectStylists', 'Single or multiple')})
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {/* Any Stylist / No Stylist Option */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => {
              setIsOwnerSelected((prev) => !prev);
            }}
            style={[
              styles.chip,
              {
                borderColor: isOwnerSelected ? colors.accent : glass.card.borderColor,
                backgroundColor: isOwnerSelected ? colors.accent900 : glass.pill.backgroundColor,
              },
            ]}
          >
            {isOwnerSelected && (
              <View style={{ marginRight: 4 }}>
                <CheckIcon size={12} color={colors.accent} />
              </View>
            )}
            <Text
              style={[
                styles.chipText,
                { color: isOwnerSelected ? colors.accent200 : colors.textMuted },
              ]}
            >
              {ownerName || 'Owner'} {t('bkOwnerTag', '(Owner)')}
            </Text>
          </TouchableOpacity>

          {/* Named Stylists */}
          {staff.filter((s) => !stylistLocked || s.id === defaultStaffId).map((s) => {
            const isSelected = selectedStaffIds.includes(s.id);
            return (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedStaffIds((prev) => {
                    if (prev.includes(s.id)) {
                      return prev.filter((id) => id !== s.id);
                    }
                    return [...prev, s.id];
                  });
                }}
                style={[
                  styles.chip,
                  {
                    borderColor: isSelected ? colors.accent : glass.card.borderColor,
                    backgroundColor: isSelected ? colors.accent900 : glass.pill.backgroundColor,
                  },
                ]}
              >
                {isSelected && (
                  <View style={{ marginRight: 4 }}>
                    <CheckIcon size={12} color={colors.accent} />
                  </View>
                )}
                <Text
                  style={[
                    styles.chipText,
                    { color: isSelected ? colors.accent200 : colors.textMuted },
                  ]}
                >
                  {s.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        </>
        )}

        {/* ======================================================== */}
        {/* 4. DATE SELECTION (No past dates! Starts from Today)     */}
        {/* ======================================================== */}
        <Text style={[styles.sectionLabel, { color: colors.textDim, marginTop: 18 }]}>
          {t('date', 'DATE').toUpperCase()}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {upcomingDays.map((d) => {
            const isSelected = selectedDayOffset === d.offset;
            return (
              <TouchableOpacity
                key={d.offset}
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedDayOffset(d.offset);
                  setSelectedSlot(null); // Reset slot on date change
                }}
                style={[
                  styles.dayChip,
                  {
                    borderColor: isSelected ? colors.accent : glass.card.borderColor,
                    backgroundColor: isSelected ? colors.accent900 : glass.pill.backgroundColor,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    styles.dowText,
                    { color: isSelected ? colors.accent200 : colors.textDim },
                  ]}
                >
                  {d.dayLabel}
                </Text>
                <Text
                  style={[
                    styles.dateNumText,
                    { color: isSelected ? colors.accent100 : colors.text },
                  ]}
                >
                  {d.dateNum}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ======================================================== */}
        {/* 5. TIME SLOTS (Conflict detection and locked styling)   */}
        {/* ======================================================== */}
        <Text style={[styles.sectionLabel, { color: colors.textDim, marginTop: 18 }]}>
          {selectedDay
            ? tf('bkSlotFor', 'SLOT · {day} {n}', { day: selectedDay.dayLabel.toUpperCase(), n: selectedDay.dateNum })
            : t('bkSlotSelectDate', 'SLOT · SELECT DATE ABOVE')}
        </Text>
        {selectedDay && (
          <Text style={{ color: colors.textMuted, fontSize: 11.5, marginBottom: 8 }}>
            {tf('bkTakes', 'Takes {d}', { d: fd(totalDurationMinutes) })}
            {selectedSlot
              ? ` · ${selectedSlot} – ${(() => {
                  const sl = timeSlots.find((x) => x.label === selectedSlot);
                  return sl ? formatMinutesToAmPm(sl.hour * 60 + sl.min + totalDurationMinutes) : '';
                })()}`
              : ''}
          </Text>
        )}

        {!selectedDay ? (
          <View style={{ padding: 18, alignItems: 'center', ...glass.card, borderRadius: radii.md, borderWidth: 1, marginVertical: 8 }}>
            <Text style={{ color: colors.textDim, fontSize: 13 }}>
              {t('bkSelectDateMsg', 'Please select an appointment date above to view time slots.')}
            </Text>
          </View>
        ) : (
          <>
            {/* Stylist Active Booking Notice */}
            {bookedSlotsMap.size > 0 && hasStylistSelection && (
              <View
                style={{
                  padding: 10,
                  borderRadius: radii.md,
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  borderWidth: 1,
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  marginTop: 6,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: '#F87171', fontSize: 12.5, fontWeight: '700' }}>
                  {tf('bkBusyAt', '🔒 {who} busy at: {slots}', {
                    who: combinedStylistName,
                    slots: Array.from(bookedSlotsMap.entries()).filter(([, v]) => v.reason === 'booked').map(([k]) => k).join(', ') || '—',
                  })}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11.5, marginTop: 2 }}>
                  {t('bkStruckNote', 'Struck-out slots are taken, or too short for the selected services. Please choose an open slot.')}
                </Text>
              </View>
            )}

            <View style={styles.slotsGrid}>
          {timeSlots.map((sl) => {
            const bookedAppt = bookedSlotsMap.get(sl.label);
            const isBooked = Boolean(bookedAppt);
            const isSelected = selectedSlot === sl.label;

            // Check if slot has already passed for today
            let isPast = false;
            if (isSelectedDateToday) {
              const currentHour = now.getHours();
              const currentMin = now.getMinutes();
              if (sl.hour < currentHour || (sl.hour === currentHour && sl.min <= currentMin)) {
                isPast = true;
              }
            }

            const isSlotDisabled = isPast || isBooked;

            const handleSlotPress = () => {
              if (isPast) return;
              if (isBooked) {
                const bookedItem = bookedSlotsMap.get(sl.label);
                Alert.alert(
                  bookedItem?.reason === 'overlap'
                    ? t('bkAlertShortTitle', 'Not Enough Time')
                    : t('bkAlertBookedTitle', 'Stylist Already Booked'),
                  bookedItem?.reason === 'overlap'
                    ? tf('bkAlertShortMsg', "{dur} from {slot} would run into {who}'s next booking. Please choose an earlier slot, another stylist or fewer services.", {
                        dur: fd(totalDurationMinutes),
                        slot: sl.label,
                        who: bookedItem.stylistName,
                      })
                    : tf('bkAlertBookedMsg', '{who} is already booked at {slot} on this date. Please choose another time slot or another stylist.', {
                        who: bookedItem?.stylistName || combinedStylistName || 'Stylist',
                        slot: sl.label,
                      }),
                  [{ text: t('bkOk', 'OK') }]
                );
                return;
              }
              setSelectedSlot(sl.label);
            };

            return (
              <TouchableOpacity
                key={sl.label}
                disabled={isSlotDisabled}
                activeOpacity={isSlotDisabled ? 1 : 0.75}
                onPress={handleSlotPress}
                style={[
                  styles.slotBox,
                  {
                    borderColor: isSelected
                      ? colors.accent
                      : isBooked
                      ? 'rgba(239, 68, 68, 0.6)'
                      : glass.card.borderColor,
                    backgroundColor: isSelected
                      ? colors.accent900
                      : isBooked
                      ? 'rgba(239, 68, 68, 0.12)'
                      : isPast
                      ? colors.trackBg
                      : glass.card.backgroundColor,
                    opacity: isPast ? 0.35 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[
                    styles.slotText,
                    {
                      color: isSelected
                        ? colors.accent
                        : isBooked
                        ? '#EF4444'
                        : isPast
                        ? colors.textDim
                        : colors.text,
                      textDecorationLine: isBooked || isPast ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {sl.label}
                </Text>
                {isBooked && (
                  <Text
                    style={{
                      fontSize: 9.5,
                      color: '#EF4444',
                      fontWeight: '700',
                      marginTop: 2,
                    }}
                  >
                    {bookedAppt?.reason === 'overlap' ? t('bkTooLong', 'Too long') : t('bkBooked', 'Booked')}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </>
    )}

        {/* WhatsApp confirmation checkbox */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => selectedCustomer && setSendConfirm(!sendConfirm)}
          style={[styles.checkboxRow, { opacity: selectedCustomer ? 1 : 0.4 }]}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: sendConfirm && selectedCustomer ? colors.accent : glass.card.borderColor,
                backgroundColor: sendConfirm && selectedCustomer ? colors.accent : 'transparent',
              },
            ]}
          >
            {sendConfirm && selectedCustomer ? <CheckIcon size={12} color="#161826" strokeWidth={3} /> : null}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.textMuted }]}>
            {t('bkWhatsapp', 'Send WhatsApp reminder to client with direct chat link (needs a client)')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom CTA Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
          },
        ]}
      >
        <Button
          label={ctaText}
          block
          disabled={bookIncomplete}
          onPress={handleConfirm}
        />
      </View>

      {/* ======================================================== */}
      {/* QUICK ADD CLIENT MODAL                                   */}
      {/* ======================================================== */}
      {/* ADD NEW SERVICE (saved to the price list) */}
      <Modal visible={isAddServiceOpen} animationType="slide" transparent onRequestClose={closeAddService}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.sheetOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeAddService} />
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
              <View
                style={[
                  styles.sheetCard,
                  { backgroundColor: colors.surface, borderColor: glass.card.borderColor, paddingBottom: keyboardHeight > 0 ? 16 : 28 },
                ]}
              >
                <View style={[styles.sheetHandle, { backgroundColor: colors.divider }]} />
                <View style={styles.sheetHeader}>
                  <View style={[styles.sheetIconWrap, { backgroundColor: colors.accent + '22', borderColor: colors.accent + '55' }]}>
                    <PlusIcon size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('bkAddService', 'Add New Service')}</Text>
                    <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 2 }}>{t('bkSavedToList', 'Saved to your price list')}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeAddService}
                    style={[styles.sheetClose, { backgroundColor: glass.pill.backgroundColor, borderColor: glass.card.borderColor }]}
                  >
                    <Text style={{ color: colors.textDim, fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, { color: colors.textDim }]}>{t('bkServiceName', 'SERVICE NAME')}</Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { backgroundColor: colors.bg, color: colors.text, borderColor: newSvcErrors.name ? '#EF4444' : glass.card.borderColor },
                  ]}
                  placeholder={t('bkSvcPlaceholder', 'e.g. Groom package')}
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={newSvcName}
                  onChangeText={(txt) => {
                    setNewSvcName(txt);
                    if (newSvcErrors.name) setNewSvcErrors((e) => ({ ...e, name: undefined }));
                  }}
                  autoCapitalize="words"
                  editable={!isSavingService}
                />
                {newSvcErrors.name ? <Text style={styles.fieldError}>{newSvcErrors.name}</Text> : null}

                <Text style={[styles.fieldLabel, { color: colors.textDim, marginTop: 14 }]}>{t('bkPrice', 'PRICE')}</Text>
                <View
                  style={[
                    styles.sheetPhoneRow,
                    { backgroundColor: colors.bg, borderColor: newSvcErrors.price ? '#EF4444' : glass.card.borderColor },
                  ]}
                >
                  <View style={[styles.sheetPrefix, { borderRightColor: glass.card.borderColor }]}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>₹</Text>
                  </View>
                  <TextInput
                    style={{ flex: 1, color: colors.text, fontSize: 15, paddingHorizontal: 12, alignSelf: 'stretch' }}
                    placeholder="0"
                    placeholderTextColor={colors.placeholder || colors.textDim}
                    keyboardType="numeric"
                    value={newSvcPrice}
                    onChangeText={(txt) => {
                      setNewSvcPrice(txt.replace(/[^0-9.]/g, ''));
                      if (newSvcErrors.price) setNewSvcErrors((e) => ({ ...e, price: undefined }));
                    }}
                    editable={!isSavingService}
                  />
                </View>
                {newSvcErrors.price ? <Text style={styles.fieldError}>{newSvcErrors.price}</Text> : null}

                <Text style={[styles.fieldLabel, { color: colors.textDim, marginTop: 14 }]}>{t('bkDuration', 'DURATION')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {DURATION_CHOICES.map((m) => {
                    const on = newSvcDuration === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setNewSvcDuration(m)}
                        activeOpacity={0.8}
                        style={[
                          styles.chip,
                          {
                            marginRight: 0,
                            borderColor: on ? colors.accent : glass.card.borderColor,
                            backgroundColor: on ? colors.accent + '22' : glass.pill.backgroundColor,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: on ? colors.accent : colors.textMuted, fontWeight: on ? '700' : '500' }]}>
                          {fd(m)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.fieldLabel, { color: colors.textDim, marginTop: 14 }]}>{t('bkCategory', 'CATEGORY')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {serviceCategoryNames.map((c) => {
                    const on = newSvcCategory === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setNewSvcCategory(c)}
                        activeOpacity={0.8}
                        style={[
                          styles.chip,
                          {
                            marginRight: 0,
                            borderColor: on ? colors.accent : glass.card.borderColor,
                            backgroundColor: on ? colors.accent + '22' : glass.pill.backgroundColor,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: on ? colors.accent : colors.textMuted, fontWeight: on ? '700' : '500' }]}>
                          {c}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ marginTop: 20 }}>
                  <Button label={t('bkSaveSelect', 'Save & Select')} block loading={isSavingService} disabled={isSavingService} onPress={handleSaveNewService} />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isAddClientModalOpen}
        animationType="slide"
        transparent
        onRequestClose={closeAddClientModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.sheetOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeAddClientModal} />
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            >
              <View
                style={[
                  styles.sheetCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: glass.card.borderColor,
                    paddingBottom: keyboardHeight > 0 ? 16 : 28,
                  },
                ]}
              >
                <View style={[styles.sheetHandle, { backgroundColor: colors.divider }]} />

                <View style={styles.sheetHeader}>
                  <View style={[styles.sheetIconWrap, { backgroundColor: colors.accent + '22', borderColor: colors.accent + '55' }]}>
                    <UserPlusIcon size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('addNewCustomer')}</Text>
                    <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 2 }}>
                      {t('bkClientSub', 'Save once, book faster every visit')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeAddClientModal}
                    accessibilityLabel={t('cancel')}
                    style={[styles.sheetClose, { backgroundColor: glass.pill.backgroundColor, borderColor: glass.card.borderColor }]}
                  >
                    <Text style={{ color: colors.textDim, fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Import from Phone Contacts */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setIsContactPickerOpen(true)}
                  style={[styles.sheetImportBtn, { borderColor: colors.accent, backgroundColor: colors.accent + '14' }]}
                >
                  <UsersIcon size={17} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13.5 }}>
                    {t('importFromContacts', 'Import from Phone Contacts')}
                  </Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 14 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                  <Text style={{ marginHorizontal: 10, color: colors.textDim, fontSize: 10.5, fontWeight: '700', letterSpacing: 1 }}>
                    {t('bkOrManual', 'OR ENTER MANUALLY')}
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                </View>

                <Text style={[styles.fieldLabel, { color: colors.textDim }]}>{t('fullName', 'FULL NAME')}</Text>
                <TextInput
                  style={[
                    styles.sheetInput,
                    {
                      backgroundColor: colors.bg,
                      color: colors.text,
                      borderColor: clientErrors.name
                        ? '#EF4444'
                        : focusedClientField === 'name'
                        ? colors.accent
                        : glass.card.borderColor,
                    },
                  ]}
                  placeholder={t('fullName')}
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={newClientName}
                  onChangeText={(txt) => {
                    setNewClientName(txt);
                    if (clientErrors.name) setClientErrors((e) => ({ ...e, name: undefined }));
                  }}
                  onFocus={() => setFocusedClientField('name')}
                  onBlur={() => setFocusedClientField(null)}
                  autoCapitalize="words"
                  returnKeyType="next"
                  editable={!isSavingClient}
                />
                {clientErrors.name ? <Text style={styles.fieldError}>{clientErrors.name}</Text> : null}

                <Text style={[styles.fieldLabel, { color: colors.textDim, marginTop: 14 }]}>{t('mobileNumber', 'MOBILE NUMBER')}</Text>
                <View
                  style={[
                    styles.sheetPhoneRow,
                    {
                      backgroundColor: colors.bg,
                      borderColor: clientErrors.phone
                        ? '#EF4444'
                        : focusedClientField === 'phone'
                        ? colors.accent
                        : glass.card.borderColor,
                    },
                  ]}
                >
                  <View style={[styles.sheetPrefix, { borderRightColor: glass.card.borderColor }]}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>+91</Text>
                  </View>
                  <TextInput
                    style={{ flex: 1, color: colors.text, fontSize: 15, paddingHorizontal: 12, alignSelf: 'stretch' }}
                    placeholder={t('mobileNumber')}
                    placeholderTextColor={colors.placeholder || colors.textDim}
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={newClientPhone}
                    onChangeText={(txt) => {
                      setNewClientPhone(txt.replace(/\D/g, '').slice(0, 10));
                      if (clientErrors.phone) setClientErrors((e) => ({ ...e, phone: undefined }));
                    }}
                    onFocus={() => setFocusedClientField('phone')}
                    onBlur={() => setFocusedClientField(null)}
                    editable={!isSavingClient}
                  />
                  <Text style={{ color: newClientPhone.length === 10 ? colors.accent : colors.textDim, fontSize: 11.5, paddingRight: 12 }}>
                    {newClientPhone.length}/10
                  </Text>
                </View>
                {clientErrors.phone ? <Text style={styles.fieldError}>{clientErrors.phone}</Text> : null}

                <View style={{ marginTop: 20 }}>
                  <Button label={t('save')} block loading={isSavingClient} disabled={isSavingClient} onPress={handleQuickAddClient} />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* QUICK CONTACT PICKER MODAL */}
      <QuickContactPickerModal
        visible={isContactPickerOpen}
        customers={customers}
        onClose={() => setIsContactPickerOpen(false)}
        onSelectContact={async ({ name, phone, existingCustomer }) => {
          if (existingCustomer) {
            Alert.alert(
              t('bkExistsTitle', 'Customer Already Exists'),
              tf('bkCustExistsShort', '"{name}" is already registered with mobile number +91 {phone}. Selected existing customer.', {
                name: existingCustomer.name,
                phone,
              })
            );
            setSelectedCustomerId(existingCustomer.id);
            setIsContactPickerOpen(false);
            setIsAddClientModalOpen(false);
            setCustomerSearch('');
            return;
          }

          try {
            if (onAddNewCustomer) {
              const created = await onAddNewCustomer(name, phone);
              setSelectedCustomerId(created.id);
            }
            setIsContactPickerOpen(false);
            setIsAddClientModalOpen(false);
            setCustomerSearch('');
            Alert.alert(t('bkImportedTitle', 'Customer Imported'), tf('bkImportedMsg', '{name} registered and selected!', { name }));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not import contact');
          }
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 140,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 7,
  },
  customerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customerSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    gap: 6,
  },
  customerSearchInput: {
    flex: 1,
    fontSize: 13,
  },
  walkInBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkInBtnText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  addClientBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  selectedCustomerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 8,
  },
  smallAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCustName: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeSelectedCustBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  searchDropdown: {
    marginTop: 4,
    borderRadius: radii.md,
    borderWidth: 1,
    maxHeight: 240,
    overflow: 'hidden',
    zIndex: 1000,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dropdownName: {
    fontSize: 13,
    fontWeight: '500',
  },
  dropdownPhone: {
    fontSize: 12,
  },
  scrollRow: {
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  dayChip: {
    width: 50,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  dowText: {
    fontSize: 11,
  },
  dateNumText: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  serviceChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  serviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  serviceChipName: {
    fontSize: 12.5,
  },
  serviceChipPrice: {
    fontSize: 12,
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slotBox: {
    width: '23.5%',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 18,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheetCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  sheetIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetImportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  fieldLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sheetInput: {
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  sheetPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  sheetPrefix: {
    alignSelf: 'stretch',
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRightWidth: 1,
  },
  fieldError: {
    color: '#EF4444',
    fontSize: 11.5,
    marginTop: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalInput: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  modalAddBtn: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chooseServicesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  chooseServicesTitle: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  chooseServicesSub: {
    fontSize: 11.5,
    marginTop: 2,
  },
  servicesGridContainer: {
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 12,
  },
  threeColumnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  squareServiceCard: {
    width: '31.5%',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 6,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    minHeight: 58,
  },
  qtyBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 22,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCheckBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareServiceName: {
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 0,
    lineHeight: 14,
  },
  squareServicePrice: {
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  selectedServiceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: 6,
  },
  expandedServicesBlock: {
    gap: 12,
    marginTop: 8,
  },
  categoryBlock: {
    marginBottom: 10,
  },
  categoryHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  expandedGrid: {
    gap: 6,
  },
  serviceRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  checkCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
