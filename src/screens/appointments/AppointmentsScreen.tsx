import React, { useState, useMemo, useRef, useEffect } from 'react';
import { openWhatsAppPreferred } from '../../services/whatsappLauncher';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  TextInput,
  Animated,
  PanResponder,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import {
  BackIcon,
  PlusIcon,
  MoreVerticalIcon,
  EditIcon,
  TrashIcon,
  CrossIcon,
  HistoryIcon,
  ClockIcon,
  CheckIcon,
  SearchIcon,
  WhatsAppIcon,
} from '../../components/common/SvgIcons';
import { Appointment, AppointmentStatus, StaffMember } from '../../types/domain';
import { inrFromMinor } from '../../utils/format';
import { radii, shadows } from '../../theme/spacing';
import { appointmentRepository, STANDARD_SLOTS } from '../../repositories/appointmentRepository';
import { shopRepository } from '../../repositories/shopRepository';
import { staffRepository } from '../../repositories/staffRepository';
import { generateTimeSlots } from './BookingScreen';
import { toLocalDateStr } from '../../utils/dateUtils';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { localeFor } from '../../i18n/format';
import { getGlass } from '../../theme/glass';
import { usePullRefresh } from '../../hooks/usePullRefresh';

interface AppointmentsScreenProps {
  onRefresh?: () => Promise<void>;
  appointments: Appointment[];
  staff?: StaffMember[];
  shopId?: string;
  shopName?: string;
  currentUserRole?: 'owner' | 'stylist';
  currentUserName?: string;
  onBack: () => void;
  onBook: () => void;
  onAdvanceStatus: (appointmentId: string, currentStatus: AppointmentStatus) => void;
  onBillAndClose: (appointment: Appointment) => void;
  onEditAppointment?: (
    appointmentId: string,
    updates: {
      starts_at: string;
      duration_minutes?: number;
      staff_name?: string;
      staff_id?: string | null;
      notes?: string | null;
      is_edited?: boolean;
    }
  ) => Promise<void>;
  onDeleteAppointment?: (
    appointmentId: string,
    deletedBy?: { role: 'owner' | 'stylist'; name: string }
  ) => Promise<void>;
}

function parseAppointmentDateTime(startsAt: string): Date | null {
  if (!startsAt) return null;
  if (startsAt.includes('T')) {
    const d = new Date(startsAt);
    if (!isNaN(d.getTime())) return d;
  }
  const parts = startsAt.trim().split(' ');
  let datePart = '';
  let timePart = '';
  let ampmPart = '';

  if (parts.length >= 2 && parts[0].includes('-')) {
    datePart = parts[0];
    timePart = parts[1];
    ampmPart = parts[2] || '';
  } else if (parts[0].includes('-')) {
    datePart = parts[0];
  } else {
    datePart = toLocalDateStr(new Date());
    timePart = parts[0];
    ampmPart = parts[1] || '';
  }

  if (!timePart) return null;
  const [hStr, mStr] = timePart.split(':');
  let hour = parseInt(hStr, 10);
  const min = parseInt(mStr || '0', 10);
  if (isNaN(hour)) return null;

  if (ampmPart) {
    if (ampmPart.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (ampmPart.toUpperCase() === 'AM' && hour === 12) hour = 0;
  } else {
    if (hour >= 1 && hour <= 7) {
      hour += 12;
    }
  }

  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, hour, min, 0, 0);
}

// Time only ("10:30 AM"), whatever shape starts_at has (date + time, ISO, or time alone)
function formatTimeOnly(startsAt: string): string {
  if (!startsAt) return '';
  const ampm = startsAt.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) return `${ampm[1].padStart(2, '0')}:${ampm[2]} ${ampm[3].toUpperCase()}`;
  const d = parseAppointmentDateTime(startsAt);
  if (!d) return startsAt;
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// -------------------------------------------------------------
// Swipeable Appointment Card Row Component
// -------------------------------------------------------------
interface SwipeableRowProps {
  appointment: Appointment;
  children: React.ReactNode;
  onConfirmDelete: (appointment: Appointment) => void;
}

const SwipeableCardRow: React.FC<SwipeableRowProps> = ({
  appointment,
  children,
  onConfirmDelete,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const isActionTriggered = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        return Math.abs(gesture.dx) > 12 && Math.abs(gesture.dy) < 15;
      },
      onPanResponderMove: (_, gesture) => {
        // Only allow swiping to the left
        if (gesture.dx <= 0) {
          translateX.setValue(Math.max(-120, gesture.dx));
        } else {
          translateX.setValue(0);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -95 && !isActionTriggered.current) {
          // Reached high threshold -> trigger delete confirmation
          isActionTriggered.current = true;
          Animated.spring(translateX, {
            toValue: -80,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
          onConfirmDelete(appointment);
          setTimeout(() => {
            isActionTriggered.current = false;
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          }, 300);
        } else if (gesture.dx < -45) {
          // Keep open at -80px to reveal red action button
          Animated.spring(translateX, {
            toValue: -80,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleManualDeletePress = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    onConfirmDelete(appointment);
  };

  return (
    <View style={styles.swipeContainer}>
      {/* Background Delete Action Button */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.revealedDeleteAction,
          { opacity: translateX.interpolate({ inputRange: [-80, -8, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' }) },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleManualDeletePress}
          style={styles.revealedDeleteBtn}
        >
          <TrashIcon size={20} color="#FFFFFF" />
          <Text style={styles.revealedDeleteText}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Foreground Animated Content */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

export const AppointmentsScreen = ({
  onRefresh,
  appointments: initialAppointments,
  staff: initialStaff,
  shopId = '',
  shopName = 'Our Salon',
  currentUserRole = 'owner',
  currentUserName,
  onBack,
  onBook,
  onAdvanceStatus,
  onBillAndClose,
  onEditAppointment,
  onDeleteAppointment,
}: AppointmentsScreenProps) => {
  const pullRefresh = usePullRefresh(onRefresh);
  const { colors } = useTheme();
  const { t, language } = useLanguage();

  // Local state for instant optimistic updates
  const [localAppointments, setLocalAppointments] = useState<Appointment[]>(initialAppointments);

  // Sync when initialAppointments changes
  React.useEffect(() => {
    setLocalAppointments(initialAppointments);
  }, [initialAppointments]);

  // Stylists list loaded from profile / staff repository
  const [staffList, setStaffList] = useState<StaffMember[]>(initialStaff || []);

  useEffect(() => {
    if (initialStaff && initialStaff.length > 0) {
      setStaffList(initialStaff);
    }
  }, [initialStaff]);

  useEffect(() => {
    if (shopId) {
      staffRepository.getStaff(shopId).then((data) => {
        if (data && data.length > 0) {
          setStaffList(data);
        }
      }).catch((err) => {
        console.warn('Failed to load staff in AppointmentsScreen:', err);
      });
    }
  }, [shopId]);

  // Action Menu state
  const [actionMenuAppt, setActionMenuAppt] = useState<Appointment | null>(null);

  // Edit Modal state
  const [editModalAppt, setEditModalAppt] = useState<Appointment | null>(null);
  const [editTimeSlot, setEditTimeSlot] = useState('');
  const [editDuration, setEditDuration] = useState('45');
  const [editStylistName, setEditStylistName] = useState('');
  const [editStaffId, setEditStaffId] = useState<string | null>(null);
  const [isStylistDropdownOpen, setIsStylistDropdownOpen] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // History Modal State
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyTab, setHistoryTab] = useState<'all' | 'completed' | 'past' | 'deleted'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [deletedAppointments, setDeletedAppointments] = useState<Appointment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const loadHistoryData = async () => {
    if (!shopId) return;
    setIsLoadingHistory(true);
    try {
      const deleted = await appointmentRepository.getDeletedAppointments(shopId);
      setDeletedAppointments(deleted);
    } catch {
      // ignore
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleOpenHistory = () => {
    setShowHistoryModal(true);
    loadHistoryData();
  };

  // Dynamic booking hours from shop settings
  const [bookingHours, setBookingHours] = useState<{ startTime: string; endTime: string }>({
    startTime: '09:30 AM',
    endTime: '08:30 PM',
  });

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const hours = await shopRepository.getBookingHours(shopId);
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
  }, [shopId]);

  const dynamicSlots = useMemo(() => {
    const generated = generateTimeSlots(bookingHours.startTime, bookingHours.endTime);
    return generated.length > 0 ? generated.map((s) => s.label) : Array.from(STANDARD_SLOTS);
  }, [bookingHours.startTime, bookingHours.endTime]);

  // Counts and list for Appointment History
  const completedCount = useMemo(
    () => localAppointments.filter((a) => a.status === 'Done').length,
    [localAppointments]
  );

  const pastCount = useMemo(() => {
    const now = new Date();
    return localAppointments.filter((a) => {
      if (a.status === 'Done' || a.status === 'Cancelled' || a.is_deleted) return false;
      const d = parseAppointmentDateTime(a.starts_at);
      return d ? d.getTime() < now.getTime() : false;
    }).length;
  }, [localAppointments]);

  const deletedCount = useMemo(() => {
    const combinedDeletedMap = new Map<string, Appointment>();
    for (const d of deletedAppointments) combinedDeletedMap.set(d.id, d);
    for (const a of localAppointments) {
      if (a.status === 'Cancelled' || a.is_deleted) combinedDeletedMap.set(a.id, a);
    }
    return combinedDeletedMap.size;
  }, [deletedAppointments, localAppointments]);

  const historyAllCount = useMemo(
    () => completedCount + pastCount + deletedCount,
    [completedCount, pastCount, deletedCount]
  );

  const historyList = useMemo(() => {
    const now = new Date();
    const completed = localAppointments.filter((a) => a.status === 'Done');
    const past = localAppointments.filter((a) => {
      if (a.status === 'Done' || a.status === 'Cancelled' || a.is_deleted) return false;
      const d = parseAppointmentDateTime(a.starts_at);
      return d ? d.getTime() < now.getTime() : false;
    });

    const combinedDeletedMap = new Map<string, Appointment>();
    for (const d of deletedAppointments) combinedDeletedMap.set(d.id, d);
    for (const a of localAppointments) {
      if (a.status === 'Cancelled' || a.is_deleted) combinedDeletedMap.set(a.id, a);
    }
    const deleted = Array.from(combinedDeletedMap.values());

    let list: Appointment[] = [];
    if (historyTab === 'completed') {
      list = completed;
    } else if (historyTab === 'past') {
      list = past;
    } else if (historyTab === 'deleted') {
      list = deleted;
    } else {
      const allMap = new Map<string, Appointment>();
      for (const a of completed) allMap.set(a.id, a);
      for (const a of past) allMap.set(a.id, a);
      for (const a of deleted) allMap.set(a.id, a);
      list = Array.from(allMap.values());
    }

    list.sort((a, b) => {
      const dateA = a.deleted_at || a.starts_at || a.created_at;
      const dateB = b.deleted_at || b.starts_at || b.created_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    if (!historySearch.trim()) return list;
    const q = historySearch.trim().toLowerCase();
    return list.filter(
      (item) =>
        item.customer_name.toLowerCase().includes(q) ||
        (item.customer_phone && item.customer_phone.includes(q)) ||
        item.service_name.toLowerCase().includes(q) ||
        item.staff_name.toLowerCase().includes(q) ||
        (item.deleted_by_name && item.deleted_by_name.toLowerCase().includes(q))
    );
  }, [localAppointments, deletedAppointments, historyTab, historySearch]);

  // Dynamic 7-day slider starting from Today
  const upcomingDays = useMemo(() => {
    const list: {
      dateStr: string;
      dow: string;
      dateNum: string;
      label: string;
      fullLabel: string;
      isToday: boolean;
    }[] = [];
    const now = new Date();
    for (let i = -1; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dow =
        i === -1
          ? t('yesterday', 'Yest.')
          : i === 0
          ? t('today')
          : d.toLocaleDateString(localeFor(language), { weekday: 'short' });
      const dateNum = String(d.getDate());
      const dateStr = toLocalDateStr(d);
      const label = d.toLocaleDateString(localeFor(language), { month: 'short', day: 'numeric' });
      const fullLabel = d.toLocaleDateString(localeFor(language), { weekday: 'long', day: 'numeric', month: 'long' });
      list.push({ dateStr, dow, dateNum, label, fullLabel, isToday: i === 0 });
    }
    return list;
  }, [language]);

  const [selectedDayIndex, setSelectedDayIndex] = useState(1);
  const selectedDay = upcomingDays[selectedDayIndex] || upcomingDays[1] || upcomingDays[0];

  // Filter appointments for selected day
  const filteredAppointments = useMemo(() => {
    return localAppointments.filter((a) => {
      if (a.starts_at && a.starts_at.includes(selectedDay.dateStr)) {
        return true;
      }
      // If date is today and appointment only has time slot (e.g. "10:00 AM"), show under Today
      if (selectedDay.isToday && a.starts_at && !a.starts_at.includes('-')) {
        return true;
      }
      return false;
    });
  }, [localAppointments, selectedDay, selectedDayIndex]);

  const totalExpectedMinor = filteredAppointments.reduce(
    (sum, a) => sum + (a.amount_minor || 0),
    0
  );

  // -------------------------------------------------------------
  // Delete Appointment Flow
  // -------------------------------------------------------------
  const handleConfirmDelete = (appt: Appointment) => {
    setActionMenuAppt(null);
    Alert.alert(
      'Delete Appointment',
      `Are you sure you want to delete this appointment for ${appt.customer_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const auditInfo = {
              role: currentUserRole || 'owner',
              name: currentUserName || (currentUserRole === 'stylist' ? 'Stylist' : 'Owner'),
            };

            // Immediate optimistic UI update
            setLocalAppointments((prev) => prev.filter((item) => item.id !== appt.id));

            try {
              if (onDeleteAppointment) {
                await onDeleteAppointment(appt.id, auditInfo);
              } else if (shopId || appt.shop_id) {
                await appointmentRepository.deleteAppointment(shopId || appt.shop_id, appt.id, auditInfo);
              }
              loadHistoryData();
            } catch (err: any) {
              // Not deleted: put it back so the screen matches what is really saved
              setLocalAppointments((prev) => (prev.some((item) => item.id === appt.id) ? prev : [...prev, appt]));
              Alert.alert('Appointment not deleted', err?.message || 'Could not delete the appointment. Please try again.');
            }
          },
        },
      ]
    );
  };

  // -------------------------------------------------------------
  // Edit Appointment Flow
  // -------------------------------------------------------------
  const handleOpenEdit = (appt: Appointment) => {
    setActionMenuAppt(null);
    setEditModalAppt(appt);

    const timeDisplay = appt.starts_at.includes(' ')
      ? appt.starts_at.split(' ').slice(1).join(' ')
      : appt.starts_at;

    setEditTimeSlot(timeDisplay || '10:00');
    setEditDuration(String(appt.duration_minutes || 45));

    const matchedStaff = staffList.find(
      (s) =>
        (appt.staff_id && s.id === appt.staff_id) ||
        (appt.staff_name && s.name.trim().toLowerCase() === appt.staff_name.trim().toLowerCase())
    );
    setEditStylistName(matchedStaff ? matchedStaff.name : (appt.staff_name || ''));
    setEditStaffId(matchedStaff ? matchedStaff.id : (appt.staff_id || null));
    setIsStylistDropdownOpen(false);

    setEditNotes(appt.notes || '');
  };

  const handleSaveEdit = async () => {
    if (!editModalAppt) return;
    const trimmedSlot = editTimeSlot.trim();
    if (!trimmedSlot) {
      Alert.alert('Required', 'Please specify an appointment time.');
      return;
    }

    setIsSavingEdit(true);
    try {
      // Reconstruct starts_at with existing date component if present
      let newStartsAt = trimmedSlot;
      if (editModalAppt.starts_at.includes('-')) {
        const datePart = editModalAppt.starts_at.split(' ')[0];
        newStartsAt = `${datePart} ${trimmedSlot}`;
      } else {
        newStartsAt = `${selectedDay.dateStr} ${trimmedSlot}`;
      }

      const durMins = parseInt(editDuration, 10) || 45;
      const nowIso = new Date().toISOString();

      const updates = {
        starts_at: newStartsAt,
        duration_minutes: durMins,
        staff_name: editStylistName.trim() || '',
        staff_id: editStaffId || null,
        notes: editNotes.trim() || null,
        is_edited: true,
      };

      // Immediate UI update
      setLocalAppointments((prev) =>
        prev.map((item) =>
          item.id === editModalAppt.id
            ? {
                ...item,
                starts_at: newStartsAt,
                duration_minutes: durMins,
                staff_name: editStylistName.trim() || item.staff_name || '',
                staff_id: editStaffId || null,
                notes: editNotes.trim() || item.notes,
                is_edited: true,
                edited_at: nowIso,
              }
            : item
        )
      );

      // Persist to Supabase instantly
      if (onEditAppointment) {
        await onEditAppointment(editModalAppt.id, updates);
      } else if (shopId || editModalAppt.shop_id) {
        await appointmentRepository.updateAppointment(
          shopId || editModalAppt.shop_id,
          editModalAppt.id,
          updates
        );
      }

      setEditModalAppt(null);
      setIsStylistDropdownOpen(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update appointment');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Direct WhatsApp Reminder for this specific customer
  const handleDirectWhatsAppRemind = (a: Appointment) => {
    const phone = a.customer_phone?.replace(/\D/g, '').slice(-10);
    if (!phone) {
      Alert.alert(
        'Phone Missing',
        `No phone number recorded for ${a.customer_name}. Please update client profile to send WhatsApp.`
      );
      return;
    }

    const timeDisplay = a.starts_at.includes(' ')
      ? a.starts_at.split(' ').slice(1).join(' ')
      : a.starts_at;
    const targetDate = parseAppointmentDateTime(a.starts_at);
    let timeNote = `You have an appointment today at *${timeDisplay}*.`;

    if (targetDate) {
      const diffMs = targetDate.getTime() - Date.now();
      if (diffMs > 0) {
        const totalMinutes = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        if (hours > 0 && mins > 0) {
          timeNote = `You only have ${hours} hour${hours > 1 ? 's' : ''} and ${mins} minute${
            mins > 1 ? 's' : ''
          } left for your booking at *${timeDisplay}*.`;
        } else if (hours > 0) {
          timeNote = `You only have ${hours} hour${hours > 1 ? 's' : ''} left for your booking at *${timeDisplay}*.`;
        } else if (mins > 0) {
          timeNote = `You only have ${mins} minute${mins > 1 ? 's' : ''} left for your booking at *${timeDisplay}*.`;
        } else {
          timeNote = `Your booking at *${timeDisplay}* is starting right now!`;
        }
      }
    }

    const msg = `Hello ${a.customer_name}! 💈 Reminder from *${shopName}*: ${timeNote} Please come to the salon at that time. See you soon! ✨`;
    openWhatsAppPreferred(phone, msg).catch((e: unknown) => Alert.alert('WhatsApp', e instanceof Error ? e.message : 'Could not open WhatsApp.'));
  };

  const glass = getGlass(colors.isDark);

  const statusLabel = (status: AppointmentStatus): string => {
    switch (status) {
      case 'Confirmed':
        return t('statusConfirmed', 'Confirmed');
      case 'Not confirmed':
        return t('statusNotConfirmed', 'Not confirmed');
      case 'In chair':
        return t('statusInChair', 'In chair');
      case 'Done':
        return t('statusDone', 'Done');
      case 'Cancelled':
        return t('statusCancelled', 'Cancelled');
      default:
        return status;
    }
  };

  const getStatusBadgeStyle = (status: AppointmentStatus) => {
    switch (status) {
      case 'In chair':
        return {
          bg: colors.accent + '22',
          border: colors.accent,
          text: colors.accent,
        };
      case 'Done':
        return {
          bg: 'rgba(52, 199, 89, 0.15)',
          border: 'rgba(52, 199, 89, 0.4)',
          text: '#34C759',
        };
      case 'Confirmed':
      default:
        return {
          bg: glass.pill.backgroundColor as string,
          border: glass.card.borderColor as string,
          text: colors.textMuted,
        };
    }
  };

  const getRailColor = (status: AppointmentStatus) => {
    if (status === 'In chair') return colors.accent;
    if (status === 'Done') return '#34C759';
    return colors.accent800;
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.header}>
        <View style={styles.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <Button variant="icon" onPress={onBack}>
              <BackIcon size={18} color={colors.text} />
            </Button>
            <Text style={[styles.title, { color: colors.text }]}>{t('appointments')}</Text>
          </View>

          {/* History Icon in Appointment Dock Bar */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={handleOpenHistory}
            style={[
              styles.historyTopBtn,
              {
                backgroundColor: glass.card.backgroundColor,
                borderColor: glass.card.borderColor,
              },
            ]}
            accessibilityLabel="Appointment History"
          >
            <HistoryIcon size={17} color={colors.accent} strokeWidth={2} />
            <Text style={[styles.historyBtnText, { color: colors.accent }]}>{t('history', 'History')}</Text>
          </TouchableOpacity>
        </View>

        {/* Dynamic Day selection chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dayScroll}
        >
          {upcomingDays.map((d, i) => {
            const isSelected = selectedDayIndex === i;
            const countForDay = localAppointments.filter((a) => {
              if (a.starts_at && a.starts_at.includes(d.dateStr)) return true;
              if (d.isToday && a.starts_at && !a.starts_at.includes('-')) return true;
              return false;
            }).length;

            return (
              <TouchableOpacity
                key={d.dateStr}
                activeOpacity={0.75}
                onPress={() => setSelectedDayIndex(i)}
                style={[
                  styles.dayChip,
                  {
                    borderColor: isSelected ? colors.accent : glass.card.borderColor,
                    backgroundColor: isSelected ? colors.accent : glass.card.backgroundColor,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    styles.dowText,
                    { color: isSelected ? '#161826' : colors.textDim },
                  ]}
                >
                  {d.dow}
                </Text>
                <Text
                  style={[
                    styles.dateNumText,
                    { color: isSelected ? '#161826' : colors.text },
                  ]}
                >
                  {d.dateNum}
                </Text>
                <View
                  style={[
                    styles.countPill,
                    {
                      backgroundColor: isSelected
                        ? 'rgba(22, 24, 38, 0.18)'
                        : countForDay > 0
                        ? colors.accent + '26'
                        : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.countText,
                      {
                        color: isSelected ? '#161826' : countForDay > 0 ? colors.accent : colors.textSubtle,
                        fontWeight: countForDay > 0 ? '700' : '400',
                      },
                    ]}
                  >
                    {countForDay}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={pullRefresh}>
        {/* Agenda summary line */}
        <Text style={[styles.dateHeading, { color: colors.text }]}>
          {selectedDay.isToday ? `${t('today')} · ` : ''}
          {selectedDay.fullLabel}
        </Text>
        <View style={styles.summaryRow}>
          <View style={[styles.summaryTile, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: colors.text }]}>{filteredAppointments.length}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textDim }]}>{t('appointments').toUpperCase()}</Text>
          </View>
          <View style={[styles.summaryTile, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: colors.accent, flexShrink: 1 }]}>{inrFromMinor(totalExpectedMinor)}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textDim }]} numberOfLines={1}>{t('apExpected', 'EXPECTED')}</Text>
          </View>
        </View>

        {filteredAppointments.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('noAppointments')}
            </Text>
          </View>
        ) : (
          /* Agenda list with Swipe-to-delete support */
          <View style={styles.list}>
            {filteredAppointments.map((a) => {
              const badgeStyle = getStatusBadgeStyle(a.status);
              const railColor = getRailColor(a.status);
              const timeDisplay = formatTimeOnly(a.starts_at);

              return (
                <SwipeableCardRow
                  key={a.id}
                  appointment={a}
                  onConfirmDelete={handleConfirmDelete}
                >
                  <View style={styles.appointmentRow}>
                    {/* Time Column */}
                    <View style={styles.timeColumn}>
                      <Text style={[styles.timeText, { color: colors.text }]} numberOfLines={1}>
                        {timeDisplay}
                      </Text>
                    </View>

                    {/* Vertical Indicator Rail */}
                    <View style={[styles.rail, { backgroundColor: railColor }]} />

                    {/* Details Card */}
                    <View style={[styles.card, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
                      {/* Card Header with 3-dot Action Menu */}
                      <View style={styles.cardHeader}>
                        <Text style={[styles.customerName, { color: colors.text }]}>
                          {a.customer_name}
                        </Text>
                        <View style={styles.cardHeaderRight}>
                          {Boolean(a.is_edited) && (
                            <View
                              style={[
                                styles.editedBadge,
                                {
                                  backgroundColor: 'rgba(217, 164, 65, 0.15)',
                                  borderColor: 'rgba(217, 164, 65, 0.4)',
                                },
                              ]}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <EditIcon size={10} color={colors.accent} />
                                <Text style={[styles.editedBadgeText, { color: colors.accent }]}>
                                  Edited
                                </Text>
                              </View>
                            </View>
                          )}

                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor: badgeStyle.bg,
                                borderColor: badgeStyle.border,
                              },
                            ]}
                          >
                            <Text style={[styles.statusBadgeText, { color: badgeStyle.text }]}>
                              {statusLabel(a.status)}
                            </Text>
                          </View>

                          {/* Three-dot Vector Action Menu Trigger */}
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => setActionMenuAppt(a)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.moreBtn}
                          >
                            <MoreVerticalIcon size={16} color={colors.textDim} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* One line per service so long orders wrap instead of being cut off */}
                      <View style={styles.serviceList}>
                        {(a.service_name || '')
                          .split(' + ')
                          .filter(Boolean)
                          .map((svc, idx) => (
                            <Text key={`${a.id}_svc_${idx}`} style={[styles.serviceLine, { color: colors.text }]}>
                              • {svc}
                            </Text>
                          ))}
                      </View>
                      <Text style={[styles.serviceSub, { color: colors.textDim }]}>
                        {a.staff_name || t('anyStylist')} · {inrFromMinor(a.amount_minor || 0)} · {a.duration_minutes || 45}{t('apMinShort', 'm')}
                      </Text>

                      {/* Actions buttons */}
                      <View style={styles.actionsRow}>
                        {/* Action 1: Status Progression or Bill */}
                        {a.status === 'Confirmed' && (
                          <TouchableOpacity
                            onPress={() => onAdvanceStatus(a.id, a.status)}
                            activeOpacity={0.7}
                            style={[
                              styles.advanceButton,
                              { backgroundColor: colors.accent + '22', borderColor: colors.accent },
                            ]}
                          >
                            <Text style={[styles.advanceButtonText, { color: colors.accent, fontWeight: '700' }]}>
                              {t('markArrived')}
                            </Text>
                          </TouchableOpacity>
                        )}

                        {a.status === 'In chair' && (
                          <TouchableOpacity
                            onPress={() => onBillAndClose(a)}
                            activeOpacity={0.7}
                            style={[
                              styles.advanceButton,
                              { backgroundColor: colors.accent, borderColor: colors.accent },
                            ]}
                          >
                            <Text
                              style={[styles.advanceButtonText, { color: '#000', fontWeight: '700' }]}
                            >
                              {t('billAndClose')}
                            </Text>
                          </TouchableOpacity>
                        )}

                        {a.status === 'Done' && (
                          <View
                            style={[
                              styles.advanceButton,
                              {
                                backgroundColor: 'rgba(52, 199, 89, 0.1)',
                                borderColor: 'rgba(52, 199, 89, 0.3)',
                              },
                            ]}
                          >
                            <Text style={[styles.advanceButtonText, { color: '#34C759' }]}>
                              {t('apBilled', '✓ Billed')}
                            </Text>
                          </View>
                        )}

                        {/* Action 2: Direct WhatsApp Reminder */}
                        {a.status === 'Confirmed' && (
                          <TouchableOpacity
                            onPress={() => handleDirectWhatsAppRemind(a)}
                            activeOpacity={0.7}
                            style={[styles.remindButton, { backgroundColor: 'rgba(37, 211, 102, 0.12)', borderColor: 'rgba(37, 211, 102, 0.4)' }]}
                          >
                            <WhatsAppIcon size={13} color="#25D366" />
                            <Text style={[styles.remindButtonText, { color: '#25D366', marginLeft: 4 }]}>
                              {t('remind')}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                </SwipeableCardRow>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ------------------------------------------------------------- */}
      {/* 1. THREE-DOT ACTION MENU MODAL (Dismiss on outside tap)        */}
      {/* ------------------------------------------------------------- */}
      <Modal
        visible={!!actionMenuAppt}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuAppt(null)}
      >
        <TouchableWithoutFeedback onPress={() => setActionMenuAppt(null)}>
          <View style={styles.actionMenuBackdrop}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.actionMenuCard,
                  { backgroundColor: colors.surface, borderColor: colors.divider },
                ]}
              >
                <View style={styles.actionMenuHeader}>
                  <Text numberOfLines={1} style={[styles.actionMenuTitle, { color: colors.text }]}>
                    {actionMenuAppt?.customer_name}
                  </Text>
                  <Text style={[styles.actionMenuSubtitle, { color: colors.textDim }]}>
                    {actionMenuAppt?.service_name}
                  </Text>
                </View>

                {/* Edit Option */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => actionMenuAppt && handleOpenEdit(actionMenuAppt)}
                  style={[styles.actionMenuItem, { borderBottomColor: colors.divider }]}
                >
                  <EditIcon size={16} color={colors.accent} />
                  <Text style={[styles.actionMenuText, { color: colors.text }]}>
                    Edit Appointment
                  </Text>
                </TouchableOpacity>

                {/* Delete Option */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => actionMenuAppt && handleConfirmDelete(actionMenuAppt)}
                  style={styles.actionMenuItem}
                >
                  <TrashIcon size={16} color="#EF4444" />
                  <Text style={[styles.actionMenuText, { color: '#EF4444' }]}>
                    Delete Appointment
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ------------------------------------------------------------- */}
      {/* 2. EDIT APPOINTMENT MODAL                                      */}
      {/* ------------------------------------------------------------- */}
      <Modal
        visible={!!editModalAppt}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalAppt(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.editModalOverlay}>
            <View
              style={[
                styles.editModalCard,
                { backgroundColor: colors.surface, borderColor: colors.divider },
              ]}
            >
              <View style={styles.editModalHeader}>
                <View>
                  <Text style={[styles.editModalTitle, { color: colors.text }]}>
                    Edit Appointment
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                    {editModalAppt?.customer_name} · {editModalAppt?.service_name}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEditModalAppt(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <CrossIcon size={18} color={colors.textDim} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 360 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Time Slot Quick Chips */}
                <Text style={[styles.inputLabel, { color: colors.textDim }]}>
                  Select Time Slot
                </Text>
                <View style={styles.slotGrid}>
                  {dynamicSlots.map((slot) => {
                    const isSelected = editTimeSlot === slot;
                    return (
                      <TouchableOpacity
                        key={slot}
                        activeOpacity={0.7}
                        onPress={() => setEditTimeSlot(slot)}
                        style={[
                          styles.slotChip,
                          {
                            borderColor: isSelected ? colors.accent : colors.divider,
                            backgroundColor: isSelected ? colors.accent900 : colors.bg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.slotChipText,
                            { color: isSelected ? colors.accent200 : colors.text },
                          ]}
                        >
                          {slot}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Custom Time Input */}
                <Text style={[styles.inputLabel, { color: colors.textDim, marginTop: 12 }]}>
                  Time Slot (or Custom)
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text },
                  ]}
                  value={editTimeSlot}
                  onChangeText={setEditTimeSlot}
                  placeholder="e.g. 10:30 AM"
                  placeholderTextColor={colors.textDim}
                />

                {/* Duration */}
                <Text style={[styles.inputLabel, { color: colors.textDim, marginTop: 12 }]}>
                  Duration (Minutes)
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['30', '45', '60', '90'].map((mins) => {
                    const isSelected = editDuration === mins;
                    return (
                      <TouchableOpacity
                        key={mins}
                        onPress={() => setEditDuration(mins)}
                        style={[
                          styles.durChip,
                          {
                            borderColor: isSelected ? colors.accent : colors.divider,
                            backgroundColor: isSelected ? colors.accent900 : colors.bg,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: isSelected ? colors.accent200 : colors.text,
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          {mins}m
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Stylist Dropdown */}
                <Text style={[styles.inputLabel, { color: colors.textDim, marginTop: 12 }]}>
                  Stylist
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => setIsStylistDropdownOpen(!isStylistDropdownOpen)}
                  style={[
                    styles.stylistDropdownBtn,
                    {
                      backgroundColor: colors.bg,
                      borderColor: isStylistDropdownOpen ? colors.accent : colors.divider,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View
                      style={[
                        styles.stylistAvatarSmall,
                        {
                          backgroundColor: editStylistName ? colors.accent900 : colors.surface,
                          borderColor: editStylistName ? colors.accent : colors.divider,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stylistAvatarText,
                          { color: editStylistName ? colors.accent200 : colors.textDim },
                        ]}
                      >
                        {editStylistName ? editStylistName.charAt(0).toUpperCase() : '–'}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.stylistDropdownSelectedText,
                          { color: editStylistName ? colors.text : colors.textDim },
                        ]}
                      >
                        {editStylistName || 'Select Stylist'}
                      </Text>
                      {editStylistName ? (
                        <Text style={{ fontSize: 10.5, color: colors.textDim, marginTop: 1 }}>
                          {staffList.find((s) => s.id === editStaffId || s.name.trim().toLowerCase() === editStylistName.trim().toLowerCase())?.role || 'Stylist'}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                    {isStylistDropdownOpen ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>

                {isStylistDropdownOpen && (
                  <View
                    style={[
                      styles.stylistDropdownList,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.divider,
                      },
                    ]}
                  >
                    <ScrollView
                      style={{ maxHeight: 180 }}
                      nestedScrollEnabled={true}
                      keyboardShouldPersistTaps="always"
                      showsVerticalScrollIndicator={true}
                    >
                      {/* Option: Any Stylist / Unassigned */}
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          setEditStylistName('');
                          setEditStaffId(null);
                          setIsStylistDropdownOpen(false);
                        }}
                        style={[
                          styles.stylistDropdownItem,
                          {
                            borderBottomColor: colors.divider,
                            backgroundColor: !editStylistName ? 'rgba(217, 119, 6, 0.12)' : 'transparent',
                          },
                        ]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                          <View
                            style={[
                              styles.stylistAvatarSmall,
                              { backgroundColor: colors.bg, borderColor: colors.divider },
                            ]}
                          >
                            <Text style={{ fontSize: 11, color: colors.textDim }}>✕</Text>
                          </View>
                          <Text
                            style={[
                              styles.stylistDropdownItemName,
                              { color: !editStylistName ? colors.accent : colors.textMuted },
                            ]}
                          >
                            Any Stylist (Unassigned)
                          </Text>
                        </View>
                        {!editStylistName && (
                          <CheckIcon size={16} color={colors.accent} />
                        )}
                      </TouchableOpacity>

                      {/* Stylists from Profile / Team */}
                      {staffList.length === 0 ? (
                        <View style={{ padding: 14, alignItems: 'center' }}>
                          <Text style={{ color: colors.textDim, fontSize: 12 }}>
                            No stylists found in profile.
                          </Text>
                        </View>
                      ) : (
                        staffList.map((stylist) => {
                          const isSelected =
                            editStaffId === stylist.id ||
                            (!editStaffId && editStylistName.trim().toLowerCase() === stylist.name.trim().toLowerCase());
                          return (
                            <TouchableOpacity
                              key={stylist.id}
                              activeOpacity={0.7}
                              onPress={() => {
                                setEditStylistName(stylist.name);
                                setEditStaffId(stylist.id);
                                setIsStylistDropdownOpen(false);
                              }}
                              style={[
                                styles.stylistDropdownItem,
                                {
                                  borderBottomColor: colors.divider,
                                  backgroundColor: isSelected ? 'rgba(217, 119, 6, 0.12)' : 'transparent',
                                },
                              ]}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                <View
                                  style={[
                                    styles.stylistAvatarSmall,
                                    {
                                      backgroundColor: isSelected ? colors.accent800 : colors.bg,
                                      borderColor: isSelected ? colors.accent : colors.divider,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.stylistAvatarText,
                                      { color: isSelected ? colors.accent100 : colors.text },
                                    ]}
                                  >
                                    {stylist.name.charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={[
                                      styles.stylistDropdownItemName,
                                      {
                                        color: isSelected ? colors.accent : colors.text,
                                        fontWeight: isSelected ? '700' : '500',
                                      },
                                    ]}
                                  >
                                    {stylist.name}
                                  </Text>
                                  {stylist.role ? (
                                    <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>
                                      {stylist.role}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              {isSelected && (
                                <CheckIcon size={16} color={colors.accent} />
                              )}
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>
                )}
              </ScrollView>

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setEditModalAppt(null)}
                  style={[styles.cancelBtn, { borderColor: colors.divider }]}
                >
                  <Text style={{ color: colors.textDim, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={isSavingEdit}
                  onPress={handleSaveEdit}
                  style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                >
                  {isSavingEdit ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={{ color: '#000', fontWeight: '700' }}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ------------------------------------------------------------- */}
      {/* 3. APPOINTMENT HISTORY MODAL                                  */}
      {/* ------------------------------------------------------------- */}
      <Modal
        visible={showHistoryModal}
        animationType="slide"
        onRequestClose={() => setShowHistoryModal(false)}
      >
        <SafeAreaView style={[styles.historyContainer, { backgroundColor: colors.bg }]}>
          {/* History Header */}
          <View style={[styles.historyHeader, { borderBottomColor: colors.divider }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <TouchableOpacity
                onPress={() => setShowHistoryModal(false)}
                style={[styles.historyBackBtn, { borderColor: colors.divider }]}
              >
                <BackIcon size={18} color={colors.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyTitle, { color: colors.text }]}>
                  Appointment History
                </Text>
                <Text style={[styles.historySub, { color: colors.textDim }]}>
                  Past, completed & deleted appointments
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 15 }}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Search bar */}
          <View style={[styles.historySearchRow, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
            <SearchIcon size={16} color={colors.textDim} />
            <TextInput
              style={[styles.historySearchInput, { color: colors.text }]}
              placeholder="Search by client, service, or stylist..."
              placeholderTextColor={colors.textDim}
              value={historySearch}
              onChangeText={setHistorySearch}
              clearButtonMode="while-editing"
            />
            {historySearch.length > 0 && (
              <TouchableOpacity onPress={() => setHistorySearch('')}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Tabs */}
          <View style={styles.historyTabsRow}>
            {[
              { id: 'all' as const, label: `All (${historyAllCount})` },
              { id: 'completed' as const, label: `Completed (${completedCount})` },
              { id: 'past' as const, label: `Past (${pastCount})` },
              { id: 'deleted' as const, label: `Deleted (${deletedCount})` },
            ].map((tab) => {
              const isSelected = historyTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setHistoryTab(tab.id)}
                  style={[
                    styles.historyTabBtn,
                    {
                      borderColor: isSelected ? colors.accent : colors.divider,
                      backgroundColor: isSelected ? colors.accent900 : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.historyTabBtnText,
                      { color: isSelected ? colors.accent200 : colors.textDim },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* History List */}
          <ScrollView
            contentContainerStyle={styles.historyScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoadingHistory && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 12 }} />
            )}

            {historyList.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📜</Text>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No records found</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textDim }]}>
                  {historyTab === 'deleted'
                    ? 'No deleted appointments recorded.'
                    : historyTab === 'completed'
                    ? 'No completed appointments yet.'
                    : 'No appointment history matching your criteria.'}
                </Text>
              </View>
            ) : (
              historyList.map((item) => {
                const isItemDeleted = item.is_deleted || item.status === 'Cancelled';
                const isItemCompleted = item.status === 'Done';
                const timeDisplay = item.starts_at.includes(' ')
                  ? item.starts_at.split(' ').slice(1).join(' ')
                  : item.starts_at;
                const dateDisplay = item.starts_at.includes(' ')
                  ? item.starts_at.split(' ')[0]
                  : '';

                return (
                  <View
                    key={item.id + (item.deleted_at || '')}
                    style={[
                      styles.historyCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: isItemDeleted ? 'rgba(239, 68, 68, 0.35)' : colors.divider,
                      },
                    ]}
                  >
                    <View style={styles.historyCardTop}>
                      {/* Left: Type Icon + Customer Name */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <View
                          style={[
                            styles.historyIconCircle,
                            {
                              backgroundColor: isItemDeleted
                                ? 'rgba(239, 68, 68, 0.12)'
                                : isItemCompleted
                                ? 'rgba(52, 199, 89, 0.12)'
                                : colors.accent900,
                            },
                          ]}
                        >
                          {isItemDeleted ? (
                            <TrashIcon size={14} color="#EF4444" />
                          ) : isItemCompleted ? (
                            <CheckIcon size={14} color="#34C759" />
                          ) : (
                            <ClockIcon size={14} color={colors.accent} />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.historyCustomerName, { color: colors.text }]} numberOfLines={1}>
                            {item.customer_name}
                          </Text>
                          {item.customer_phone ? (
                            <Text style={[styles.historyPhone, { color: colors.textDim }]}>
                              +91 {item.customer_phone}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {/* Right: Badges */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {Boolean(item.is_edited) && (
                          <View
                            style={[
                              styles.editedBadge,
                              {
                                backgroundColor: 'rgba(217, 164, 65, 0.15)',
                                borderColor: 'rgba(217, 164, 65, 0.4)',
                              },
                            ]}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <EditIcon size={10} color={colors.accent} />
                              <Text style={[styles.editedBadgeText, { color: colors.accent }]}>
                                Edited
                              </Text>
                            </View>
                          </View>
                        )}
                        <View
                          style={[
                            styles.historyStatusBadge,
                            {
                              backgroundColor: isItemDeleted
                                ? 'rgba(239, 68, 68, 0.15)'
                                : isItemCompleted
                                ? 'rgba(52, 199, 89, 0.15)'
                                : colors.accent900,
                              borderColor: isItemDeleted
                                ? 'rgba(239, 68, 68, 0.4)'
                                : isItemCompleted
                                ? 'rgba(52, 199, 89, 0.4)'
                                : colors.accent,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '700',
                              color: isItemDeleted
                                ? '#EF4444'
                                : isItemCompleted
                                ? '#34C759'
                                : colors.accent200,
                            }}
                          >
                            {isItemDeleted ? 'Deleted' : item.status}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Middle details */}
                    <View style={styles.historyDetailsBox}>
                      <Text style={[styles.historyDetailText, { color: colors.textDim }]}>
                        Service: <Text style={{ color: colors.text, fontWeight: '600' }}>{item.service_name}</Text>
                      </Text>
                      <Text style={[styles.historyDetailText, { color: colors.textDim }]}>
                        Stylist: <Text style={{ color: colors.text, fontWeight: '600' }}>{item.staff_name || 'Any Stylist'}</Text>
                      </Text>
                      <Text style={[styles.historyDetailText, { color: colors.textDim }]}>
                        Scheduled: <Text style={{ color: colors.text, fontWeight: '600' }}>{dateDisplay ? `${dateDisplay} at ` : ''}{timeDisplay}</Text>
                      </Text>
                      {item.amount_minor > 0 && (
                        <Text style={[styles.historyDetailText, { color: colors.textDim }]}>
                          Amount: <Text style={{ color: colors.accent, fontWeight: '700' }}>{inrFromMinor(item.amount_minor)}</Text>
                        </Text>
                      )}
                    </View>

                    {/* Deletion Audit Banner */}
                    {isItemDeleted && (
                      <View
                        style={[
                          styles.deletionAuditBanner,
                          {
                            backgroundColor: 'rgba(239, 68, 68, 0.08)',
                            borderColor: 'rgba(239, 68, 68, 0.25)',
                          },
                        ]}
                      >
                        <TrashIcon size={12} color="#EF4444" />
                        <Text style={[styles.deletionAuditText, { color: '#EF4444' }]}>
                          Deleted by {item.deleted_by_role === 'stylist' ? 'Stylist' : 'Owner'}:{' '}
                          <Text style={{ fontWeight: '700' }}>
                            {item.deleted_by_name || (item.deleted_by_role === 'stylist' ? 'Stylist' : 'Owner')}
                          </Text>
                          {item.deleted_at
                            ? ` (${new Date(item.deleted_at).toLocaleDateString()} ${new Date(item.deleted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                            : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Floating Action Button for Booking */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onBook}
        style={[
          styles.fab,
          {
            backgroundColor: colors.accent800,
            borderColor: colors.accent,
          },
        ]}
      >
        <PlusIcon size={18} color={colors.accent100} />
        <Text style={[styles.fabText, { color: colors.accent100 }]}>
          {t('newAppointment')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
  },
  dayScroll: {
    marginTop: 12,
    marginBottom: 4,
  },
  dayChip: {
    width: 50,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  dowText: {
    fontSize: 9.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dateNumText: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  dateHeading: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  countText: {
    fontSize: 9.5,
  },
  countPill: {
    minWidth: 16,
    paddingHorizontal: 5,
    borderRadius: 7,
    marginTop: 2,
    alignItems: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  summaryTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 90,
  },
  summaryText: {
    fontSize: 12,
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  list: {
    gap: 7,
  },
  swipeContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
  },
  revealedDeleteAction: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
  },
  revealedDeleteBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  revealedDeleteText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  appointmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeColumn: {
    width: 62,
    alignItems: 'flex-end',
    paddingTop: 8,
  },
  timeText: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  meridianText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  durText: {
    fontSize: 11,
    marginTop: 4,
  },
  rail: {
    width: 3,
    borderRadius: 2,
  },
  card: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  moreBtn: {
    padding: 3,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  serviceList: {
    marginTop: 3,
    gap: 1,
  },
  serviceLine: {
    fontSize: 12,
    lineHeight: 16,
  },
  serviceSub: {
    fontSize: 11,
    marginTop: 3,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  advanceButton: {
    paddingVertical: 4,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  advanceButtonText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  remindButton: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  remindButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...shadows.md,
  },
  fabText: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Action Menu Styles
  actionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionMenuCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.lg,
  },
  actionMenuHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionMenuTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionMenuSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionMenuText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Edit Modal Styles
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  editModalCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
    ...shadows.lg,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  editModalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slotChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  slotChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  textInput: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  stylistDropdownBtn: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stylistDropdownSelectedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stylistDropdownList: {
    marginTop: 5,
    borderWidth: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
    zIndex: 100,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  stylistDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stylistDropdownItemName: {
    fontSize: 13,
  },
  stylistAvatarSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stylistAvatarText: {
    fontSize: 11,
    fontWeight: '700',
  },
  durChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  saveBtn: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  editedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  historyTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  historyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  historyContainer: {
    flex: 1,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyBackBtn: {
    padding: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  historySub: {
    fontSize: 11,
    marginTop: 1,
  },
  historySearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  historySearchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 2,
  },
  historyTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 10,
  },
  historyTabBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  historyTabBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  historyScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  historyCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    ...shadows.sm,
  },
  historyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCustomerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  historyPhone: {
    fontSize: 11,
    marginTop: 1,
  },
  historyStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  historyDetailsBox: {
    gap: 3,
    paddingVertical: 4,
  },
  historyDetailText: {
    fontSize: 12,
  },
  deletionAuditBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  deletionAuditText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
});
