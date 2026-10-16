import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import {
  BackIcon,
  CheckIcon,
  UserPlusIcon,
  UsersIcon,
  CalendarIcon,
  CashIcon,
  UpiIcon,
  CardIcon,
  SplitPayIcon,
  PendingPayIcon,
} from '../../components/common/SvgIcons';
import { Customer, StaffMember, Service, Bill } from '../../types/domain';
import { inr, inrFromMinor, getInitials } from '../../utils/format';
import { radii } from '../../theme/spacing';
import { getRecentCustomers } from '../../services/quickBookService';
import { orderServicesForQuickPick } from '../../services/servicePriority';
import { QuickContactPickerModal } from '../../components/customers/QuickContactPickerModal';
import { shopRepository } from '../../repositories/shopRepository';
import { FREE_SALES_LIMIT } from '../../utils/subscriptionUtils';

interface NewBillScreenProps {
  customers: Customer[];
  services: Service[];
  staff: StaffMember[];
  bills?: Bill[];
  shopId?: string;
  shopUpiId?: string | null;
  onSaveUpiId?: (upiId: string) => Promise<void>;
  initialCustomerId?: string | null;
  initialServiceId?: string | null;
  initialServiceIds?: string[] | null;
  initialServiceQuantities?: Record<string, number> | null;
  initialStaffId?: string | null;
  /** The logged-in stylist's id (stylist sessions only): pre-selected as the stylist on a new bill. */
  defaultStaffId?: string | null;
  initialStaffName?: string | null;
  onBack: () => void;
  onAddNewCustomer?: (name: string, phone: string) => Promise<Customer>;
  /** True while the bill is being saved: the button shows progress and ignores taps. */
  isSavingBill?: boolean;
  onProceedToInvoice: (billData: {
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
    billDate?: string;
  }) => void;
  ownerName?: string;
  isPro?: boolean;
  totalSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  onUpgradePlan?: () => void;
  editingBill?: Bill | null;
}

export const NewBillScreen = ({
  customers,
  services,
  staff,
  bills = [],
  shopId,
  shopUpiId,
  onSaveUpiId,
  initialCustomerId = null,
  initialServiceId = null,
  initialServiceIds = null,
  initialServiceQuantities = null,
  initialStaffId = null,
  defaultStaffId = null,
  initialStaffName = null,
  ownerName = 'Owner',
  isPro = false,
  totalSalesCount = 0,
  freeSalesLimit = FREE_SALES_LIMIT,
  onBack,
  onAddNewCustomer,
  onProceedToInvoice,
  isSavingBill = false,
  onUpgradePlan,
  editingBill = null,
}: NewBillScreenProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const [currentUpiId, setCurrentUpiId] = useState<string>(shopUpiId || '');
  const [showUpiModal, setShowUpiModal] = useState<boolean>(false);
  const [upiInput, setUpiInput] = useState<string>('');
  const [isSavingUpi, setIsSavingUpi] = useState<boolean>(false);

  useEffect(() => {
    if (shopUpiId) {
      setCurrentUpiId(shopUpiId);
    }
  }, [shopUpiId]);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => {
    if (editingBill?.customer_id) return editingBill.customer_id;
    if (editingBill?.customer_name) {
      const found = customers.find((c) => c.name.trim().toLowerCase() === editingBill.customer_name.trim().toLowerCase());
      if (found) return found.id;
    }
    return initialCustomerId;
  });
  const [customerSearch, setCustomerSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Quick Add Client Modal State
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
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

  // Services, Staff & Multi-quantity State
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>(() => {
    const quantities: Record<string, number> = {};
    if (editingBill?.items && editingBill.items.length > 0) {
      for (const item of editingBill.items) {
        let matchedId = item.service_id;
        if (!matchedId) {
          const found = services.find(
            (s) => s.name.trim().toLowerCase() === item.service_name_snapshot.trim().toLowerCase()
          );
          if (found) matchedId = found.id;
        }
        if (matchedId) {
          quantities[matchedId] = (quantities[matchedId] || 0) + (item.quantity || 1);
        }
      }
      if (Object.keys(quantities).length > 0) return quantities;
    }
    if (initialServiceQuantities && Object.keys(initialServiceQuantities).length > 0) {
      return { ...initialServiceQuantities };
    }
    if (initialServiceIds && initialServiceIds.length > 0) {
      for (const id of initialServiceIds) {
        quantities[id] = (quantities[id] || 0) + 1;
      }
      return quantities;
    }
    if (initialServiceId) {
      return { [initialServiceId]: 1 };
    }
    return {};
  });

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(() => {
    if (editingBill?.items && editingBill.items.length > 0) {
      const ids: string[] = [];
      for (const item of editingBill.items) {
        let matchedId = item.service_id;
        if (!matchedId) {
          const found = services.find(
            (s) => s.name.trim().toLowerCase() === item.service_name_snapshot.trim().toLowerCase()
          );
          if (found) matchedId = found.id;
        }
        if (matchedId && !ids.includes(matchedId)) {
          ids.push(matchedId);
        }
      }
      if (ids.length > 0) return ids;
    }
    if (initialServiceIds && initialServiceIds.length > 0) {
      return Array.from(new Set(initialServiceIds));
    }
    if (initialServiceId) {
      return [initialServiceId];
    }
    return [];
  });

  // CRITICAL: When appointment services arrive or initial services are passed into the bill:
  // ADD/MERGE them into existing services instead of replacing!
  useEffect(() => {
    if (editingBill) return;
    const incomingIds = initialServiceIds && initialServiceIds.length > 0
      ? initialServiceIds
      : initialServiceId ? [initialServiceId] : [];

    if (incomingIds.length === 0) return;

    setSelectedServiceIds((prev) => {
      const merged = [...prev];
      for (const id of incomingIds) {
        if (!merged.includes(id)) {
          merged.push(id);
        }
      }
      return merged;
    });

    setServiceQuantities((prev) => {
      const next = { ...prev };
      for (const id of incomingIds) {
        // Already present (seeded from the same props): keep its quantity, never add it twice
        if (next[id]) continue;
        next[id] = (initialServiceQuantities && initialServiceQuantities[id]) || 1;
      }
      return next;
    });
  }, [initialServiceIds, initialServiceQuantities, initialServiceId, editingBill]);

  const [isServicesExpanded, setIsServicesExpanded] = useState(true);

  // Quick close: customer and services already come from the appointment, so show a compact
  // summary and only open the full pickers on request.
  const [isQuick] = useState<boolean>(
    () =>
      !editingBill &&
      Boolean(initialCustomerId) &&
      Boolean((initialServiceIds && initialServiceIds.length > 0) || initialServiceId)
  );
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [isWalkInBill, setIsWalkInBill] = useState(false);

  // Closing a walk-in appointment (services known, no client yet): ask for the client's name and
  // phone straight away so the bill is saved against a real customer.
  useEffect(() => {
    if (editingBill) return;
    const hasServices = Boolean((initialServiceIds && initialServiceIds.length > 0) || initialServiceId);
    if (hasServices && !initialCustomerId) {
      setIsAddClientModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showExtras, setShowExtras] = useState(false);

  // Dual Stylist Support: can select 1 or 2 stylists, or [-1] for "No Stylist (Owner)"
  const initialStaffIndices = useMemo(() => {
    const parseStaffNames = (nameStr: string): number[] => {
      const splitNames = nameStr.split(/&|,/).map((n) => n.trim().toLowerCase());
      const matched: number[] = [];
      const cleanOwner = (ownerName || 'Owner').trim().toLowerCase();
      for (const sn of splitNames) {
        if (sn === 'owner' || sn === cleanOwner || sn.startsWith(cleanOwner)) {
          if (!matched.includes(-1)) matched.push(-1);
          continue;
        }
        const idx = staff.findIndex((s) => s.name.trim().toLowerCase() === sn);
        if (idx !== -1 && !matched.includes(idx)) {
          matched.push(idx);
        }
      }
      return matched;
    };

    if (editingBill) {
      if (editingBill.staff_name) {
        const matched = parseStaffNames(editingBill.staff_name);
        if (matched.length > 0) return matched;
      }
      if (editingBill.staff_id) {
        const idx = staff.findIndex((s) => s.id === editingBill.staff_id);
        if (idx !== -1) return [idx];
      }
      return [-1];
    }
    if (initialStaffName) {
      const matched = parseStaffNames(initialStaffName);
      if (matched.length > 0) return matched;
    }
    if (initialStaffId) {
      const idx = staff.findIndex((s) => s.id === initialStaffId);
      return idx !== -1 ? [idx] : [];
    }
    if (defaultStaffId) {
      const idx = staff.findIndex((s) => s.id === defaultStaffId && s.is_active !== false);
      if (idx !== -1) return [idx];
    }
    return [];
  }, [editingBill, initialStaffName, initialStaffId, defaultStaffId, staff, ownerName]);

  // No active stylists: only the owner can serve, so the stylist step is skipped and the bill goes to the owner.
  const ownerOnly = !editingBill && !staff.some((s) => s.is_active !== false);
  const [selectedStaffIndices, setSelectedStaffIndices] = useState<number[]>(ownerOnly ? [-1] : initialStaffIndices);
  useEffect(() => {
    if (ownerOnly) setSelectedStaffIndices([-1]);
  }, [ownerOnly]);
  // A logged-in stylist always books as themselves: no stylist choice is shown
  const stylistLocked = Boolean(defaultStaffId) && !editingBill && staff.some((s) => s.id === defaultStaffId);

  // Bill Date state (default Today, allows selecting previous valid dates, no future dates)
  const [selectedBillDate, setSelectedBillDate] = useState<Date>(() => {
    if (editingBill?.created_at) {
      return new Date(editingBill.created_at);
    }
    return new Date();
  });
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);
  const [customDateInput, setCustomDateInput] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const pastDaysList = useMemo(() => {
    const list: { date: Date; label: string; dateStr: string; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 0; i < 15; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const isToday = i === 0;
      const isYesterday = i === 1;
      const label = isToday
        ? 'Today'
        : isYesterday
        ? 'Yesterday'
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const dateStr = d.toISOString().split('T')[0];
      list.push({ date: d, label, dateStr, isToday });
    }
    return list;
  }, []);

  const [paymentMode, setPaymentMode] = useState<string>(() => {
    if (editingBill) {
      if (editingBill.status === 'pending') return 'Fully Pending';
      if (editingBill.status === 'partially_paid') return 'Partial Pay';
      return editingBill.payment_method || 'UPI';
    }
    return '';
  });
  const [partialPaymentMode, setPartialPaymentMode] = useState<'UPI' | 'Cash' | 'Card'>('UPI');
  const [partialPaidInput, setPartialPaidInput] = useState<string>(() => {
    if (editingBill && editingBill.paid_amount_minor !== undefined) {
      return (editingBill.paid_amount_minor / 100).toString();
    }
    return '';
  });
  const [discountInput, setDiscountInput] = useState<string>(() => {
    if (editingBill && editingBill.discount_minor) {
      return (editingBill.discount_minor / 100).toString();
    }
    return '0';
  });
  const [tipInput, setTipInput] = useState<string>(() => {
    if (editingBill && editingBill.tip_minor) {
      return (editingBill.tip_minor / 100).toString();
    }
    return '0';
  });

  // Filter matching customers based on search
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 25);
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, customerSearch]);

  const selectedCustomer = selectedCustomerId
    ? customers.find((c) => c.id === selectedCustomerId)
    : null;
  const customerName = selectedCustomer ? selectedCustomer.name : '';
  // Customer chose not to give details: bill without a client (no dues possible)
  const isWalkIn = isWalkInBill && !selectedCustomer;
  const walkInNeedsClient = isWalkIn && (paymentMode === 'Partial Pay' || paymentMode === 'Fully Pending');
  const orderedServices = useMemo(() => orderServicesForQuickPick(services), [services]);
  const recentClients = useMemo(() => getRecentCustomers(customers, [], bills, 5), [customers, bills]);

  // Compute top used / popular services from real bills
  const { popularServices, categoryGroups } = useMemo(() => {
    const serviceFrequency: Record<string, number> = {};
    for (const b of bills) {
      if (b.items) {
        for (const it of b.items) {
          const sName = it.service_name_snapshot;
          serviceFrequency[sName] = (serviceFrequency[sName] || 0) + (it.quantity || 1);
        }
      }
    }

    const popular = services
      .filter((s) => (serviceFrequency[s.name] || 0) > 0)
      .sort((a, b) => (serviceFrequency[b.name] || 0) - (serviceFrequency[a.name] || 0))
      .slice(0, 4);

    const categories = ['Hair', 'Beard', 'Colour', 'Care', 'Packages'] as const;
    const groups: { category: string; services: Service[] }[] = [];

    for (const cat of categories) {
      const catServices = services.filter((s) => s.category_name === cat);
      if (catServices.length > 0) {
        groups.push({ category: cat, services: catServices });
      }
    }

    // Include any remaining categories
    const otherServices = services.filter(
      (s) => !categories.includes(s.category_name as any)
    );
    if (otherServices.length > 0) {
      groups.push({ category: 'Other Services', services: otherServices });
    }

    return { popularServices: popular, categoryGroups: groups };
  }, [services, bills]);

  // One tap = 1, two taps = 2 ... up to 5; the next tap removes it. Long-press removes at once.
  const MAX_SERVICE_QTY = 5;

  const handleRemoveService = (svcId: string) => {
    setSelectedServiceIds((prev) => prev.filter((id) => id !== svcId));
    setServiceQuantities((prev) => {
      const next = { ...prev };
      delete next[svcId];
      return next;
    });
  };

  const handleServiceDecrement = (svcId: string) => {
    const current = serviceQuantities[svcId] || 0;
    if (current <= 1) {
      handleRemoveService(svcId);
      return;
    }
    setServiceQuantities((prev) => ({ ...prev, [svcId]: current - 1 }));
  };

  const handleServicePress = (svcId: string) => {
    const current = serviceQuantities[svcId] || 0;
    if (current >= MAX_SERVICE_QTY) {
      handleRemoveService(svcId);
      return;
    }
    setSelectedServiceIds((prev) => (prev.includes(svcId) ? prev : [...prev, svcId]));
    setServiceQuantities((prev) => ({ ...prev, [svcId]: current + 1 }));
  };

  const toggleService = handleServicePress;

  const selectedServices = services.filter((s) => selectedServiceIds.includes(s.id));
  const cartItems = selectedServices.map((s) => {
    const qty = serviceQuantities[s.id] || 1;
    return {
      name: s.name,
      priceMinor: s.price_minor * qty,
      unitPriceMinor: s.price_minor,
      quantity: qty,
      isColour: s.category_name === 'Colour' || s.name.toLowerCase().includes('colour'),
    };
  });

  const totalSelectedCount = useMemo(() => {
    return selectedServiceIds.reduce((sum, id) => sum + (serviceQuantities[id] || 1), 0);
  }, [selectedServiceIds, serviceQuantities]);

  // Financial calculation (No GST as requested, supports Discount and Tip)
  const subtotalMinor = cartItems.reduce((acc, it) => acc + it.priceMinor, 0);
  const discountAmt = parseFloat(discountInput) || 0;
  const discountMinor = Math.min(subtotalMinor, Math.round(discountAmt * 100));
  const tipAmt = parseFloat(tipInput) || 0;
  const tipMinor = Math.max(0, Math.round(tipAmt * 100));
  const totalMinor = Math.max(0, subtotalMinor - discountMinor + tipMinor);

  const selectedStaffMembers = useMemo(() => {
    return selectedStaffIndices
      .filter((idx) => idx >= 0 && staff[idx])
      .map((idx) => staff[idx]);
  }, [selectedStaffIndices, staff]);

  const isOwnerSelected = selectedStaffIndices.includes(-1);

  const currentStaff = useMemo(() => {
    const names: string[] = [];
    if (isOwnerSelected) {
      names.push(ownerName || 'Owner');
    }
    selectedStaffMembers.forEach((s) => {
      names.push(s.name);
    });

    if (names.length === 0) return null;

    let formattedName = '';
    if (names.length === 1) {
      formattedName = names[0];
    } else if (names.length === 2) {
      formattedName = `${names[0]} & ${names[1]}`;
    } else {
      formattedName = `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
    }

    const primaryId = selectedStaffMembers.length > 0 ? selectedStaffMembers[0].id : null;

    return {
      id: primaryId,
      name: formattedName,
    };
  }, [isOwnerSelected, selectedStaffMembers, ownerName]);

  const handleSaveUpiId = async () => {
    const trimmed = upiInput.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a valid UPI ID (e.g. yoursalon@okaxis)');
      return;
    }
    if (!trimmed.includes('@')) {
      Alert.alert('Invalid UPI ID', 'Please enter a valid UPI ID containing "@" (e.g. yoursalon@okaxis or 9876543210@paytm)');
      return;
    }

    setIsSavingUpi(true);
    try {
      setCurrentUpiId(trimmed);
      if (shopId) {
        await shopRepository.updateShop(shopId, { upi_id: trimmed });
      }
      if (onSaveUpiId) {
        await onSaveUpiId(trimmed);
      }
      setShowUpiModal(false);
      Alert.alert('UPI ID Saved', 'UPI ID successfully saved to your Shop Profile and will be included in partial bills.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save UPI ID');
    } finally {
      setIsSavingUpi(false);
    }
  };

  const handleProceed = () => {
    // 100-sales free limit check (new sales only)
    if (!editingBill && totalSalesCount >= freeSalesLimit && !isPro) {
      Alert.alert(
        `${freeSalesLimit}-Sales Limit Reached`,
        'You have reached the free limit of 100 sales on this salon account.\n\nPlease upgrade to Pro to continue creating and issuing bills.',
        [
          { text: 'Upgrade to Pro', onPress: () => onUpgradePlan && onUpgradePlan() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (!selectedCustomer && !isWalkIn) {
      Alert.alert(
        'Client Required',
        'Please select or add a client for this bill, or choose Walk-in if the customer does not want to share details.',
        [
          { text: '+ Add Client', onPress: () => setIsAddClientModalOpen(true) },
          { text: 'Walk-in', onPress: () => setIsWalkInBill(true) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (cartItems.length === 0) {
      Alert.alert('No Services', 'Please select at least one service to create a bill.');
      return;
    }

    if (!currentStaff || selectedStaffIndices.length === 0) {
      Alert.alert('Stylist Required', `Please select a stylist or choose "${ownerName || 'Owner'} (Owner)".`);
      return;
    }

    if (!paymentMode) {
      Alert.alert('Payment Mode Required', 'Please select a payment mode (Cash, UPI, Card, Partial Pay, or Fully Pending).');
      return;
    }

    if (walkInNeedsClient) {
      Alert.alert(
        t('billWalkInNeedsClient', 'Dues need a client name and phone'),
        t('billWalkInNote', 'Walk-in bill: no client details are saved, so dues cannot be tracked.'),
        [
          { text: '+ Add Client', onPress: () => setIsAddClientModalOpen(true) },
          { text: t('cancel', 'Cancel'), style: 'cancel' },
        ]
      );
      return;
    }

    let paidMinor = totalMinor;
    let dueMinor = 0;

    if (paymentMode === 'Fully Pending') {
      paidMinor = 0;
      dueMinor = totalMinor;
    } else if (paymentMode === 'Partial Pay') {
      const partialAmt = parseFloat(partialPaidInput) || 0;
      paidMinor = Math.round(partialAmt * 100);
      if (paidMinor <= 0) {
        Alert.alert('Invalid Amount', 'Please enter a valid amount paid now (greater than ₹0).');
        return;
      }
      if (paidMinor >= totalMinor) {
        Alert.alert(
          'Notice',
          'Paid amount covers the full total. Please select UPI, Cash or Card, or lower the partial amount.'
        );
        return;
      }
      dueMinor = totalMinor - paidMinor;
    }

    const effectivePaymentMethod =
      paymentMode === 'Partial Pay'
        ? `Partial Pay (${partialPaymentMode})`
        : paymentMode;

    onProceedToInvoice({
      customerName: selectedCustomer ? selectedCustomer.name : t('bkWalkIn', 'Walk-in'),
      customerId: selectedCustomer ? selectedCustomer.id : null,
      staffName: currentStaff.name,
      staffId: currentStaff.id,
      staffIds: selectedStaffMembers.map((s) => s.id),
      items: cartItems,
      paymentMethod: effectivePaymentMethod,
      discountMinor,
      tipMinor,
      paidAmountMinor: paidMinor,
      dueAmountMinor: dueMinor,
      billDate: selectedBillDate.toISOString(),
    });
  };

  // Quick Add Client Action
  const handleSaveQuickClient = async () => {
    if (!newClientName.trim()) {
      Alert.alert('Required', 'Please enter customer name');
      return;
    }
    const clean = newClientPhone.replace(/\D/g, '').slice(-10);
    if (clean.length !== 10) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number');
      return;
    }

    // Check if phone already belongs to an existing customer
    const existing = customers.find((c) => c.phone.replace(/\D/g, '').slice(-10) === clean);
    if (existing) {
      Alert.alert(
        'Customer Already Exists',
        `A customer with mobile +91 ${clean} already exists (${existing.name}). Selected existing customer.`
      );
      setSelectedCustomerId(existing.id);
      setIsAddClientModalOpen(false);
      setNewClientName('');
      setNewClientPhone('');
      setCustomerSearch('');
      setIsSearchFocused(false);
      return;
    }

    setIsSavingClient(true);
    try {
      if (onAddNewCustomer) {
        const created = await onAddNewCustomer(newClientName.trim(), clean);
        setSelectedCustomerId(created.id);
      }
      setIsAddClientModalOpen(false);
      setNewClientName('');
      setNewClientPhone('');
      setCustomerSearch('');
      setIsSearchFocused(false);
      Alert.alert('Client Saved', `${newClientName.trim()} registered and selected!`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save client');
    } finally {
      setIsSavingClient(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      {/* Top Bar */}
      <View style={styles.topBar}>
        <Button variant="icon" onPress={onBack}>
          <BackIcon size={18} color={colors.text} />
        </Button>
        <Text style={[styles.title, { color: colors.text }]}>
          {editingBill ? `Edit Bill #${editingBill.invoice_number}` : t('newBill')}
        </Text>
        <Text style={[styles.selectedCountText, { color: colors.textDim }]}>
          {selectedServiceIds.length} {t('services')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(160, keyboardHeight + 80) },
        ]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={true}
        showsVerticalScrollIndicator={false}
      >
        {isQuick && !showFullDetails ? (
          <View
            style={[
              styles.quickCard,
              { ...getGlass(colors.isDark).raised, borderWidth: 1 },
            ]}
          >
            {/* Customer */}
            <View style={styles.quickRow}>
              <View style={[styles.quickAvatar, { backgroundColor: colors.accent800 }]}>
                <Text style={{ color: colors.accent100, fontSize: 13, fontWeight: '800' }}>
                  {getInitials(selectedCustomer?.name || '?')}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.quickName, { color: colors.text }]}>
                  {selectedCustomer?.name || ''}
                </Text>
                <Text style={{ color: colors.textDim, fontSize: 11.5 }}>
                  {selectedCustomer ? `+91 ${selectedCustomer.phone}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowFullDetails(true)}
                activeOpacity={0.8}
                style={[styles.quickEditBtn, { borderColor: colors.accent }]}
              >
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>{t('edit', 'Edit')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.quickDivider, { backgroundColor: colors.divider }]} />

            {/* Services */}
            {cartItems.map((it, idx) => (
              <View key={`${it.name}_${idx}`} style={styles.quickLine}>
                <Text style={[styles.quickLineName, { color: colors.text }]}>
                  {it.name}
                  {it.quantity > 1 ? `  ×${it.quantity}` : ''}
                </Text>
                <Text style={[styles.quickLinePrice, { color: colors.text }]}>{inrFromMinor(it.priceMinor)}</Text>
              </View>
            ))}

            <View style={[styles.quickDivider, { backgroundColor: colors.divider }]} />

            {/* Stylist + date */}
            <View style={styles.quickLine}>
              {selectedStaffIndices.length > 0 ? (
                <Text style={{ color: colors.textDim, fontSize: 12, flex: 1 }} numberOfLines={1}>
                  {selectedStaffIndices
                    .map((i) => (i === -1 ? ownerName || 'Owner' : staff[i]?.name))
                    .filter(Boolean)
                    .join(' & ')}
                </Text>
              ) : (
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowFullDetails(true)} activeOpacity={0.8}>
                  <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    {t('bkCtaSelectStylist', 'Select Stylist')} ›
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setShowDatePickerModal(true)} activeOpacity={0.8}>
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                  {selectedBillDate.toDateString() === new Date().toDateString()
                    ? `${t('today', 'Today')} ✎`
                    : `${selectedBillDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ✎`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
        <>
        {isQuick && (
          <TouchableOpacity onPress={() => setShowFullDetails(false)} activeOpacity={0.8} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
            <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '700' }}>{t('bkOk', 'OK')} ✓</Text>
          </TouchableOpacity>
        )}
        {/* BILL DATE SELECTION */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            ...getGlass(colors.isDark).card,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.divider,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CalendarIcon size={16} color={colors.accent} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Bill Date</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => setShowDatePickerModal(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.accent900,
              borderWidth: 1,
              borderColor: colors.accent,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radii.sm,
              gap: 4,
            }}
          >
            <Text style={{ color: colors.accent100, fontSize: 12.5, fontWeight: '700' }}>
              {selectedBillDate.toDateString() === new Date().toDateString()
                ? `Today (${selectedBillDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`
                : selectedBillDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
            <Text style={{ color: colors.accent, fontSize: 11 }}>✎</Text>
          </TouchableOpacity>
        </View>

        {/* CUSTOMER SELECTION AREA */}
        <Text style={[styles.sectionLabel, { color: colors.textDim }]}>{t('client')}</Text>

        {!selectedCustomer && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setIsWalkInBill((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ selected: isWalkIn }}
                style={[
                  styles.recentChip,
                  isWalkIn
                    ? { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent }
                    : { ...getGlass(colors.isDark).raised, borderWidth: 1 },
                  { paddingLeft: 12 },
                ]}
              >
                <Text style={{ color: isWalkIn ? '#161826' : colors.text, fontSize: 12.5, fontWeight: '700' }}>
                  {t('bkWalkIn', 'Walk-in')}
                </Text>
              </TouchableOpacity>
              {recentClients.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelectedCustomerId(c.id);
                    setCustomerSearch('');
                    setIsSearchFocused(false);
                  }}
                  style={[styles.recentChip, { ...getGlass(colors.isDark).raised, borderWidth: 1 }]}
                >
                  <View style={[styles.recentAvatar, { backgroundColor: colors.accent800 }]}>
                    <Text style={{ color: colors.accent100, fontSize: 10.5, fontWeight: '800' }}>{getInitials(c.name)}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, fontWeight: '600', maxWidth: 90 }}>
                    {c.name.trim().split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {isWalkIn && (
          <Text style={{ color: colors.textDim, fontSize: 11.5, marginBottom: 8 }}>
            {t('billWalkInNote', 'Walk-in bill: no client details are saved, so dues cannot be tracked.')}
          </Text>
        )}

        <View style={styles.customerRowContainer}>
          {/* Search Field Box */}
          <View
            style={[
              styles.customerSearchBox,
              {
                ...getGlass(colors.isDark).card,
                borderColor: isSearchFocused ? colors.accent : colors.divider,
                flex: 1,
              },
            ]}
          >
            <Text style={{ fontSize: 13, marginRight: 6 }}>🔍</Text>
            <TextInput
              style={[styles.customerSearchInput, { color: colors.text }]}
              placeholder="Search client by name or phone..."
              placeholderTextColor={colors.placeholder || colors.textDim}
              value={customerSearch}
              onChangeText={(txt) => {
                setCustomerSearch(txt);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
            />
            {customerSearch.length > 0 && (
              <TouchableOpacity onPress={() => setCustomerSearch('')} style={{ padding: 4 }}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>✕</Text>
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
                backgroundColor: colors.surface,
                borderColor: colors.divider,
              },
            ]}
          >
            <UserPlusIcon size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Selected Customer Highlight Card (if a registered customer is selected) */}
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
              <Text style={{ color: colors.accent200, fontSize: 12 }}>✕ Deselect</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Customer Search Dropdown */}
        {isSearchFocused && !selectedCustomer && (
          <View
            style={[
              styles.searchDropdown,
              {
                backgroundColor: colors.surface,
                borderColor: colors.divider,
              },
            ]}
          >
            {customerSearch.trim().length === 0 && (
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
                  Select Client ({customers.length} on file)
                </Text>
                <TouchableOpacity onPress={() => setIsSearchFocused(false)}>
                  <Text style={{ fontSize: 11, color: colors.textDim }}>Close ✕</Text>
                </TouchableOpacity>
              </View>
            )}
            {filteredCustomers.length === 0 ? (
              <View style={{ padding: 14, alignItems: 'center' }}>
                <Text style={{ color: colors.textDim, fontSize: 12.5 }}>
                  {customerSearch.trim().length > 0
                    ? `No customer matching "${customerSearch}"`
                    : 'No customers on file yet'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setNewClientName(customerSearch);
                    setIsAddClientModalOpen(true);
                  }}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 12.5 }}>
                    {customerSearch.trim().length > 0
                      ? `+ Add "${customerSearch}" as new client`
                      : '+ Add new client'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 220 }}
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
                    style={[
                      styles.dropdownRow,
                      { borderBottomColor: colors.divider },
                    ]}
                  >
                    <View style={[styles.smallAvatar, { backgroundColor: colors.neutral800 }]}>
                      <Text style={{ color: colors.text, fontSize: 10 }}>{getInitials(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{c.name}</Text>
                      <Text style={{ color: colors.textDim, fontSize: 11 }}>+91 {c.phone}</Text>
                    </View>
                    {c.is_starred && (
                      <Text style={{ color: colors.accent, fontSize: 11, fontWeight: 'bold' }}>★ MVP</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* SERVICES: tap a tile once for 1, twice for 2; hold to remove */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setIsServicesExpanded((prev) => !prev)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.servicesHeadRow}
        >
          <Text style={[styles.sectionLabel, { color: colors.textDim, marginBottom: 0 }]}>
            {t('services')} ({totalSelectedCount} {t('selected', 'selected')})
          </Text>
          <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '700' }}>{isServicesExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {!isServicesExpanded && selectedServices.length > 0 && (
          <Text style={{ color: colors.accent, fontSize: 12.5, marginBottom: 8 }} numberOfLines={2}>
            {selectedServices
              .map((sv) => ((serviceQuantities[sv.id] || 1) > 1 ? `${sv.name} × ${serviceQuantities[sv.id]}` : sv.name))
              .join(' + ')}
          </Text>
        )}
        {isServicesExpanded && (
          <Text style={{ color: colors.textDim, fontSize: 11, marginBottom: 6 }}>
            {t('serviceTapHint', 'Tap once for 1, twice for 2 · hold to remove')}
          </Text>
        )}

        {/* 3-COLUMN SQUARE GRID CONTAINER (Shown when expanded) */}
        {isServicesExpanded && (
          <View style={[styles.servicesGridContainer, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            {services.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: colors.textDim, fontSize: 13 }}>No services found. Add services in Prices & Offers.</Text>
              </View>
            ) : (
              <View style={styles.threeColumnGrid}>
                {orderedServices.map((s) => {
                  const isSelected = selectedServiceIds.includes(s.id);
                  const qty = serviceQuantities[s.id] || 0;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      activeOpacity={0.75}
                      onPress={() => handleServicePress(s.id)}
                      onLongPress={() => isSelected && handleRemoveService(s.id)}
                      delayLongPress={350}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.squareServiceCard,
                        {
                          backgroundColor: isSelected ? colors.accent + '1F' : getGlass(colors.isDark).pill.backgroundColor,
                          borderColor: isSelected ? colors.accent : getGlass(colors.isDark).card.borderColor,
                          borderWidth: isSelected ? 1.5 : 1,
                        },
                      ]}
                    >
                      {isSelected ? (
                        <>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            onPress={() => handleServiceDecrement(s.id)}
                            accessibilityLabel={`Reduce quantity of ${s.name}`}
                            style={[styles.qtyMinus, { borderColor: colors.accent }]}
                          >
                            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800', lineHeight: 15 }}>−</Text>
                          </TouchableOpacity>
                          <View style={[styles.qtyBadge, { backgroundColor: colors.accent }]}>
                            <Text style={{ color: '#161826', fontSize: 10.5, fontWeight: '800' }}>×{qty}</Text>
                          </View>
                        </>
                      ) : null}
                      <Text
                        style={[
                          styles.squareServiceName,
                          { color: isSelected ? colors.accent100 : colors.text },
                        ]}
                        numberOfLines={2}
                      >
                        {s.name}
                      </Text>
                      <Text
                        style={[
                          styles.squareServicePrice,
                          { color: isSelected ? colors.accent : colors.textDim },
                        ]}
                      >
                        {inrFromMinor(s.price_minor)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* STYLIST SECTION */}
        {!ownerOnly && (
        <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.textDim }]}>
            {t('staff')}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '500' }}>
            ({t('selectStylists', 'Single or multiple')})
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
          {/* No Stylist Chip */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => {
              setSelectedStaffIndices((prev) => {
                if (prev.includes(-1)) {
                  return prev.filter((i) => i !== -1);
                }
                return [...prev, -1];
              });
            }}
            style={[
              styles.stylistChip,
              {
                borderColor: isOwnerSelected ? colors.accent : colors.divider,
                backgroundColor: isOwnerSelected ? colors.accent900 : 'transparent',
              },
            ]}
          >
            <View style={[styles.stylistAvatar, { backgroundColor: isOwnerSelected ? colors.accent : colors.surface }]}>
              {isOwnerSelected ? (
                <CheckIcon size={12} color="#0D0E11" />
              ) : (
                <UsersIcon size={14} color={colors.textDim} />
              )}
            </View>
            <Text
              style={[
                styles.stylistName,
                { color: isOwnerSelected ? colors.accent200 : colors.textMuted },
              ]}
            >
              {ownerName || 'Owner'} (Owner)
            </Text>
          </TouchableOpacity>

          {staff.map((s, idx) => {
            // A logged-in stylist can bill as themselves or as the owner, not as other stylists
            if (stylistLocked && s.id !== defaultStaffId) return null;
            const isSelected = selectedStaffIndices.includes(idx);
            return (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedStaffIndices((prev) => {
                    if (prev.includes(idx)) {
                      return prev.filter((i) => i !== idx);
                    }
                    return [...prev, idx];
                  });
                }}
                style={[
                  styles.stylistChip,
                  {
                    borderColor: isSelected ? colors.accent : colors.divider,
                    backgroundColor: isSelected ? colors.accent900 : 'transparent',
                  },
                ]}
              >
                <View style={[styles.stylistAvatar, { backgroundColor: isSelected ? colors.accent : colors.accent800 }]}>
                  {isSelected ? (
                    <CheckIcon size={12} color="#0D0E11" />
                  ) : (
                    <Text style={[styles.stylistAvatarText, { color: colors.accent100 }]}>
                      {getInitials(s.name)}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stylistName,
                    { color: isSelected ? colors.accent200 : colors.textMuted },
                  ]}
                >
                  {s.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        </>
        )}

        </>
        )}

        {/* Discount and tip: tucked away in quick close, one tap to open */}
        {isQuick && !showExtras ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setShowExtras(true)}
            style={[styles.quickExtrasRow, { borderColor: colors.divider, backgroundColor: getGlass(colors.isDark).card.backgroundColor }]}
          >
            <Text style={{ color: colors.textDim, fontSize: 12.5, fontWeight: '600' }}>
              {t('discount')} / Tip
              {discountMinor > 0 ? `  ·  −${inrFromMinor(discountMinor)}` : ''}
              {tipMinor > 0 ? `  ·  +${inrFromMinor(tipMinor)}` : ''}
            </Text>
            <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '700' }}>＋</Text>
          </TouchableOpacity>
        ) : (
        <>
        {/* DISCOUNT SECTION (Replaces GST as instructed) */}
        <Text style={[styles.sectionLabel, { color: colors.textDim, marginTop: 16 }]}>
          {t('discount')} (₹)
        </Text>
        <View style={styles.discountContainer}>
          <View
            style={[
              styles.discountInputBox,
              { backgroundColor: colors.surface, borderColor: colors.divider },
            ]}
          >
            <Text style={[styles.currencyPrefix, { color: colors.accent }]}>₹</Text>
            <TextInput
              style={[styles.discountInput, { color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.placeholder || colors.textDim}
              keyboardType="numeric"
              value={discountInput === '0' ? '' : discountInput}
              onChangeText={(txt) => {
                const clean = txt.replace(/\D/g, '');
                setDiscountInput(clean || '0');
              }}
            />
          </View>

          {/* Preset Discount Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginLeft: 10 }}>
            {[50, 100, 200].map((amt) => (
              <TouchableOpacity
                key={amt}
                onPress={() => setDiscountInput(String(amt))}
                style={[
                  styles.presetChip,
                  {
                    borderColor: discountInput === String(amt) ? colors.accent : colors.divider,
                    backgroundColor: discountInput === String(amt) ? colors.accent900 : colors.surface,
                  },
                ]}
              >
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>₹{amt}</Text>
              </TouchableOpacity>
            ))}
            {[10, 20].map((pct) => {
              const calcAmt = Math.round((subtotalMinor * (pct / 100)) / 100);
              return (
                <TouchableOpacity
                  key={`${pct}%`}
                  onPress={() => setDiscountInput(String(calcAmt))}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: discountInput === String(calcAmt) && calcAmt > 0 ? colors.accent : colors.divider,
                      backgroundColor: discountInput === String(calcAmt) && calcAmt > 0 ? colors.accent900 : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>{pct}% off</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* TIP / GRATUITY */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.textDim, marginBottom: 0 }]}>
            {t('tip', 'TIP / GRATUITY')}
          </Text>
          {tipMinor > 0 && (
            <TouchableOpacity onPress={() => setTipInput('0')}>
              <Text style={{ color: colors.accent, fontSize: 11.5, fontWeight: '600' }}>
                Clear tip
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.discountContainer}>
          <View
            style={[
              styles.discountInputBox,
              {
                ...getGlass(colors.isDark).card,
                borderColor: tipMinor > 0 ? colors.accent : colors.divider,
              },
            ]}
          >
            <Text style={[styles.currencyPrefix, { color: colors.accent }]}>₹</Text>
            <TextInput
              style={[styles.discountInput, { color: colors.text }]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textDim}
              value={tipInput === '0' ? '' : tipInput}
              onChangeText={(txt) => {
                const clean = txt.replace(/\D/g, '');
                setTipInput(clean || '0');
              }}
            />
          </View>

          {/* Preset Tip Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginLeft: 10 }}>
            {[30, 50, 100, 200].map((amt) => (
              <TouchableOpacity
                key={amt}
                onPress={() => setTipInput(String(amt))}
                style={[
                  styles.presetChip,
                  {
                    borderColor: tipInput === String(amt) ? colors.accent : colors.divider,
                    backgroundColor: tipInput === String(amt) ? colors.accent900 : colors.surface,
                  },
                ]}
              >
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>₹{amt}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        </>
        )}

        {/* PAYMENT METHOD */}
        <Text style={[styles.sectionLabel, { color: colors.textDim, marginTop: 18 }]}>
          {t('paymentMode')}
        </Text>
        <View style={styles.paymentRow}>
          {(['UPI', 'Cash', 'Card', 'Partial Pay', 'Fully Pending'] as const).map((mode) => {
            const isSelected = paymentMode === mode;
            const modeLabel =
              mode === 'Partial Pay'
                ? t('partialPay', 'Partial Pay')
                : mode === 'Fully Pending'
                ? t('fullyPending', 'Fully Pending')
                : mode;
            const iconColor = isSelected ? colors.accent : colors.textMuted;
            const renderIcon = () => {
              switch (mode) {
                case 'Cash':
                  return <CashIcon size={14} color={iconColor} />;
                case 'UPI':
                  return <UpiIcon size={14} color={iconColor} />;
                case 'Card':
                  return <CardIcon size={14} color={iconColor} />;
                case 'Partial Pay':
                  return <SplitPayIcon size={14} color={iconColor} />;
                case 'Fully Pending':
                  return <PendingPayIcon size={14} color={iconColor} />;
                default:
                  return null;
              }
            };
            return (
              <TouchableOpacity
                key={mode}
                activeOpacity={0.8}
                onPress={() => {
                  setPaymentMode(mode);
                  if (mode === 'Partial Pay') {
                    setPartialPaidInput('');
                    if (!currentUpiId || !currentUpiId.trim()) {
                      setUpiInput('');
                      setShowUpiModal(true);
                    }
                  }
                }}
                style={[
                  styles.paymentButton,
                  {
                    borderColor: isSelected ? colors.accent : colors.divider,
                    backgroundColor: isSelected ? colors.accent900 : colors.surface,
                  },
                ]}
              >
                {renderIcon()}
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[
                    styles.paymentButtonText,
                    { color: isSelected ? colors.accent : colors.textMuted },
                  ]}
                >
                  {modeLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* PARTIAL PAY DETAILS */}
        {paymentMode === 'Partial Pay' && (
          <View style={[styles.dueDetailCard, { ...getGlass(colors.isDark).card, borderWidth: 1, borderColor: colors.accent }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                {t('amountPaidNow', 'Amount Paid Now')} (₹):
              </Text>
              <TextInput
                style={[
                  styles.partialInput,
                  {
                    color: colors.accent,
                    borderColor:
                      (parseFloat(partialPaidInput) || 0) * 100 > totalMinor
                        ? colors.error
                        : colors.accent,
                    backgroundColor: colors.bg,
                  },
                ]}
                keyboardType="numeric"
                value={partialPaidInput}
                onChangeText={(txt) => setPartialPaidInput(txt.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={colors.textDim}
              />
            </View>

            {(parseFloat(partialPaidInput) || 0) * 100 > totalMinor && (
              <Text style={{ color: colors.error, fontSize: 11, marginTop: 4 }}>
                Paid amount cannot exceed total bill of {inrFromMinor(totalMinor)}
              </Text>
            )}

            {/* Upfront Payment Mode (UPI / Cash / Card) */}
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: 6 }}>
                Paid via:
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['UPI', 'Cash', 'Card'] as const).map((method) => {
                  const isSel = partialPaymentMode === method;
                  const iconCol = isSel ? colors.accent : colors.textMuted;
                  return (
                    <TouchableOpacity
                      key={method}
                      onPress={() => setPartialPaymentMode(method)}
                      style={{
                        flex: 1,
                        paddingVertical: 7,
                        borderRadius: radii.sm,
                        flexDirection: 'row',
                        gap: 5,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSel ? colors.accent900 : colors.bg,
                        borderWidth: 1,
                        borderColor: isSel ? colors.accent : colors.divider,
                      }}
                    >
                      {method === 'Cash' ? (
                        <CashIcon size={13} color={iconCol} />
                      ) : method === 'UPI' ? (
                        <UpiIcon size={13} color={iconCol} />
                      ) : (
                        <CardIcon size={13} color={iconCol} />
                      )}
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '600',
                          color: isSel ? colors.accent : colors.textMuted,
                        }}
                      >
                        {method}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={[styles.dueCalculationRow, { borderTopColor: colors.divider }]}>
              <Text style={{ color: colors.textDim, fontSize: 12 }}>
                {t('remainingDue', 'Remaining Due (stored to customer)')}:
              </Text>
              <Text style={{ color: colors.error, fontSize: 14, fontWeight: '700' }}>
                {inrFromMinor(
                  Math.max(
                    0,
                    totalMinor - Math.min(totalMinor, Math.round((parseFloat(partialPaidInput) || 0) * 100))
                  )
                )}
              </Text>
            </View>

            {/* UPI ID Row for WhatsApp Balance Collection */}
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: colors.textDim, fontSize: 11 }}>
                  💳 UPI ID for WhatsApp Balance Collection:
                </Text>
                <Text style={{ color: currentUpiId ? colors.accent : colors.error, fontSize: 12.5, fontWeight: '700', marginTop: 2 }}>
                  {currentUpiId || 'Not set (Required for WhatsApp)'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setUpiInput(currentUpiId || '');
                  setShowUpiModal(true);
                }}
                style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.accent900, borderWidth: 1, borderColor: colors.accent }}
              >
                <Text style={{ color: colors.accent, fontSize: 11.5, fontWeight: '700' }}>
                  {currentUpiId ? 'Change UPI' : '+ Set UPI'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* FULLY PENDING BANNER */}
        {paymentMode === 'Fully Pending' && (
          <View style={[styles.dueDetailCard, { backgroundColor: 'rgba(255, 59, 48, 0.08)', borderColor: colors.error }]}>
            <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600', marginBottom: 2 }}>
              ⏳ Fully Pending Bill
            </Text>
            <Text style={{ color: colors.textDim, fontSize: 12 }}>
              Full amount of {inrFromMinor(totalMinor)} will be registered as outstanding due for {customerName}.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Cart Summary Bottom Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryText, { color: colors.textDim }]}>
            {totalSelectedCount > 0
              ? `${totalSelectedCount} service${totalSelectedCount > 1 ? 's' : ''} · Subtotal ${inrFromMinor(subtotalMinor)}${
                  discountMinor > 0 ? ` · Disc −${inrFromMinor(discountMinor)}` : ''
                }${tipMinor > 0 ? ` · Tip +${inrFromMinor(tipMinor)}` : ''}`
              : 'Pick services to start'}
          </Text>
          <Text style={[styles.totalText, { color: colors.text }]}>
            {inrFromMinor(totalMinor)}
          </Text>
        </View>

        {(() => {
          const isPartialValid =
            paymentMode !== 'Partial Pay' ||
            ((parseFloat(partialPaidInput) || 0) > 0 &&
              Math.round((parseFloat(partialPaidInput) || 0) * 100) < totalMinor);

          const isBillComplete = Boolean(
            (selectedCustomer || isWalkIn) &&
            !walkInNeedsClient &&
            cartItems.length > 0 &&
            selectedStaffIndices.length > 0 &&
            currentStaff &&
            paymentMode !== '' &&
            isPartialValid
          );

          const btnLabel = editingBill
            ? 'Save Changes'
            : !selectedCustomer && !isWalkIn
            ? 'Select Client'
            : cartItems.length === 0
            ? 'Select Services'
            : selectedStaffIndices.length === 0
            ? 'Select Stylist'
            : !paymentMode
            ? 'Select Payment Mode'
            : walkInNeedsClient
            ? t('billWalkInNeedsClient', 'Dues need a client name and phone')
            : paymentMode === 'Partial Pay' && !isPartialValid
            ? 'Enter Valid Paid Amount'
            : t('saveAndPrint');

          return (
            <Button
              label={btnLabel}
              block
              disabled={!isBillComplete || isSavingBill}
              loading={isSavingBill}
              onPress={handleProceed}
            />
          );
        })()}
      </View>

      {/* QUICK ADD CLIENT MODAL */}
      <Modal
        visible={isAddClientModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsAddClientModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsAddClientModalOpen(false)}
            />
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'flex-end',
                paddingBottom: Math.max(20, keyboardHeight + 10),
              }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={true}
            >
              <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>{t('addNewCustomer')}</Text>
                  <TouchableOpacity onPress={() => setIsAddClientModalOpen(false)}>
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Import from Phone Contacts Button */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setIsContactPickerOpen(true)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    paddingVertical: 11,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: colors.accent,
                    backgroundColor: colors.accent + '15',
                    marginBottom: 12,
                  }}
                >
                  <UsersIcon size={16} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 13 }}>
                    {t('importFromContacts', 'Import from Phone Contacts')}
                  </Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                  <Text style={{ marginHorizontal: 8, color: colors.textDim, fontSize: 11, fontWeight: '600' }}>
                    OR ENTER MANUALLY
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                </View>

                <Text style={[styles.inputLabel, { color: colors.textDim }]}>{t('fullName')}</Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                  placeholder="e.g. Ramesh Kumar"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={newClientName}
                  onChangeText={setNewClientName}
                />

                <Text style={[styles.inputLabel, { color: colors.textDim, marginTop: 14 }]}>
                  {t('mobileNumber')}
                </Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                  placeholder="e.g. 9876543210"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={newClientPhone}
                  onChangeText={(txt) => setNewClientPhone(txt.replace(/\D/g, '').slice(0, 10))}
                />

                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={isSavingClient}
                  onPress={handleSaveQuickClient}
                  style={[styles.saveModalBtn, { backgroundColor: colors.accent }]}
                >
                  {isSavingClient ? (
                    <ActivityIndicator color="#0D0E11" />
                  ) : (
                    <Text style={styles.saveModalBtnText}>{t('save')}</Text>
                  )}
                </TouchableOpacity>

                {!selectedCustomer && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      setIsWalkInBill(true);
                      setIsAddClientModalOpen(false);
                    }}
                    style={{ marginTop: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '600', textAlign: 'center' }}>
                      {t('billWalkInSkip', "Customer didn't give details? Continue as walk-in")}
                    </Text>
                  </TouchableOpacity>
                )}
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
              'Customer Already Exists',
              `"${existingCustomer.name}" is already registered with mobile number +91 ${phone}. Selected existing customer.`
            );
            setSelectedCustomerId(existingCustomer.id);
            setIsContactPickerOpen(false);
            setIsAddClientModalOpen(false);
            setCustomerSearch('');
            setIsSearchFocused(false);
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
            setIsSearchFocused(false);
            Alert.alert('Customer Imported', `${name} registered and selected!`);
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not import contact');
          }
        }}
      />

      {/* POP-UP: ENTER SALON UPI ID FOR PARTIALLY PAID BILLS */}
      <Modal visible={showUpiModal} animationType="slide" transparent onRequestClose={() => setShowUpiModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setShowUpiModal(false)}
            />
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'flex-end',
                paddingBottom: Math.max(20, keyboardHeight + 10),
              }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={true}
            >
              <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 18 }}>💳</Text>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>Enter Salon UPI ID</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowUpiModal(false)}>
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={{ fontSize: 12.5, color: colors.textDim, marginBottom: 14, lineHeight: 18 }}>
                  When sharing partially paid bills on WhatsApp, clients will receive this UPI ID to pay their balance due. This will be automatically saved to your Shop Profile for all future bills.
                </Text>

                <Text style={[styles.inputLabel, { color: colors.textDim }]}>
                  SALON UPI ID (VPA) *
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.divider,
                      color: colors.text,
                      marginBottom: 16,
                      fontSize: 14,
                    },
                  ]}
                  placeholder="e.g. yoursalon@okaxis or 9876543210@paytm"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={upiInput}
                  onChangeText={setUpiInput}
                />

                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={isSavingUpi}
                  onPress={handleSaveUpiId}
                  style={[styles.saveModalBtn, { backgroundColor: colors.accent }]}
                >
                  {isSavingUpi ? (
                    <ActivityIndicator color="#0D0E11" />
                  ) : (
                    <Text style={styles.saveModalBtnText}>Save to Shop Profile & Continue</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bill Date Picker Modal */}
      <Modal visible={showDatePickerModal} transparent animationType="fade" onRequestClose={() => setShowDatePickerModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.divider, maxWidth: 360, width: '90%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CalendarIcon size={18} color={colors.accent} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Select Bill Date</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDatePickerModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: colors.textDim, marginBottom: 12 }}>
              Select valid previous date for backdated billing (future dates strictly prohibited):
            </Text>

            <ScrollView style={{ maxHeight: 250 }} showsVerticalScrollIndicator={true}>
              {pastDaysList.map((item) => {
                const isSelected = selectedBillDate.toDateString() === item.date.toDateString();
                return (
                  <TouchableOpacity
                    key={item.dateStr}
                    activeOpacity={0.7}
                    onPress={() => {
                      // Keep the current time of day; the picked date alone would be midnight (12 AM)
                      const now = new Date();
                      const picked = new Date(
                        item.date.getFullYear(),
                        item.date.getMonth(),
                        item.date.getDate(),
                        now.getHours(),
                        now.getMinutes(),
                        now.getSeconds()
                      );
                      setSelectedBillDate(picked);
                      setShowDatePickerModal(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: radii.sm,
                      backgroundColor: isSelected ? colors.accent900 : 'transparent',
                      borderWidth: isSelected ? 1 : 0,
                      borderColor: colors.accent,
                      marginBottom: 4,
                    }}
                  >
                    <Text style={{ color: isSelected ? colors.accent100 : colors.text, fontSize: 13, fontWeight: isSelected ? '700' : '500' }}>
                      {item.label}
                    </Text>
                    <Text style={{ color: isSelected ? colors.accent200 : colors.textDim, fontSize: 12 }}>
                      {item.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setShowDatePickerModal(false)}
              style={{
                marginTop: 14,
                paddingVertical: 10,
                alignItems: 'center',
                backgroundColor: colors.accent,
                borderRadius: radii.sm,
              }}
            >
              <Text style={{ color: '#0D0F14', fontWeight: '700', fontSize: 13 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  quickCard: { borderRadius: 18, padding: 12, marginBottom: 10 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quickAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  quickName: { fontSize: 15, fontWeight: '700' },
  quickEditBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  quickDivider: { height: StyleSheet.hairlineWidth, marginVertical: 9 },
  quickLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 3 },
  quickLineName: { flex: 1, fontSize: 13.5, fontWeight: '500' },
  quickLinePrice: { fontSize: 13.5, fontWeight: '700' },
  quickExtrasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
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
  selectedCountText: {
    marginLeft: 'auto',
    fontSize: 11.5,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 140,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 7,
  },
  customerRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  customerSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  customerSearchInput: {
    flex: 1,
    fontSize: 12.5,
    padding: 0,
  },
  walkInBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  walkInBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addClientBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  selectedCustomerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 10,
  },
  smallAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCustName: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeSelectedCustBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  searchDropdown: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 14,
    maxHeight: 240,
    overflow: 'hidden',
    zIndex: 1000,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
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
  selectedServiceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: 6,
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
    gap: 8,
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
  qtyMinus: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 18,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servicesHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 6,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 11,
    borderRadius: 18,
  },
  recentAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
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
    marginTop: 14,
    lineHeight: 15,
  },
  squareServicePrice: {
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  categoryBlock: {
    marginBottom: 12,
  },
  categoryHeader: {
    fontSize: 11,
    marginBottom: 6,
  },
  serviceChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  serviceButton: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  serviceName: {
    fontSize: 12.5,
  },
  servicePrice: {
    fontSize: 11,
    marginTop: 2,
  },
  horizontalScroll: {
    marginBottom: 6,
  },
  stylistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: 6,
  },
  stylistAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stylistAvatarText: {
    fontSize: 11,
    fontWeight: '500',
  },
  stylistName: {
    fontSize: 12,
    fontWeight: '500',
  },
  discountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  discountInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  currencyPrefix: {
    fontSize: 14,
    fontWeight: '700',
    marginRight: 4,
  },
  discountInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    minWidth: '22%',
    flexGrow: 1,
  },
  paymentButtonText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  dueDetailCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  partialInput: {
    width: 100,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  fractionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  dueCalculationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 9,
  },
  summaryText: {
    fontSize: 12,
    flex: 1,
    minWidth: 160,
  },
  totalText: {
    fontSize: 22,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  saveModalBtn: {
    marginTop: 20,
    paddingVertical: 13,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  saveModalBtnText: {
    color: '#0D0E11',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBox: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
    alignSelf: 'center',
    marginVertical: 'auto',
  },
});
