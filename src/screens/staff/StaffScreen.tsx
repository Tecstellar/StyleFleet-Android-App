import React, { useState, useMemo, useEffect } from 'react';
import { openWhatsAppPreferred } from '../../services/whatsappLauncher';
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
  Dimensions,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import { BackIcon, PlusIcon, EditIcon, TrashIcon, MoreVerticalIcon, PdfIcon, ExcelIcon, LockIcon, StarIcon, UsersIcon, PhoneCallIcon, WhatsAppIcon } from '../../components/common/SvgIcons';
import { StaffMember, Period, Bill, StylistPermissions } from '../../types/domain';
import { StylistPermissionsModal } from '../../components/staff/StylistPermissionsModal';
import { staffRepository } from '../../repositories/staffRepository';
import { QuickContactPickerModal } from '../../components/customers/QuickContactPickerModal';
import { inrFromMinor, shortInrFromMinor, getInitials } from '../../utils/format';
import { calculateRebookPercent } from '../../utils/stylistStats';
import { radii, shadows } from '../../theme/spacing';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { STYLEFLEET_PLAY_STORE_URL } from '../../constants/app';
import { usePullRefresh } from '../../hooks/usePullRefresh';
import { FREE_SALES_LIMIT } from '../../utils/subscriptionUtils';
export { STYLEFLEET_PLAY_STORE_URL };

interface StaffScreenProps {
  onRefresh?: () => Promise<void>;
  staff: StaffMember[];
  bills?: Bill[];
  shopId?: string;
  shopName?: string;
  ownerName?: string;
  isPro?: boolean;
  totalSalesCount?: number;
  /** Free-plan sales limit for this salon */
  freeSalesLimit?: number;
  onUpgradePlan?: () => void;
  onBack: () => void;
  onAddStaff?: (name: string, role: string, phone: string) => Promise<void>;
  onUpdateStaff?: (staffId: string, name: string, phone: string, role?: string) => Promise<void>;
  onDeleteStaff?: (staffId: string) => Promise<void>;
  onToggleStaffStatus?: (staffId: string) => Promise<void>;
  onUpdateStaffPermissions?: (staffId: string, permissions: StylistPermissions) => Promise<void>;
  onUpdateStaffRating?: (staffId: string, rating: string) => Promise<void>;
  onManage?: () => void;
}

interface StylistReportRow {
  id: string;
  name: string;
  isOwner: boolean;
  role: string;
  phone?: string | null;
  servicesCount: number;
  salesMinor: number;
  sharePct: number;
}

export const StaffScreen = ({
  onRefresh,
  staff,
  bills = [],
  shopId,
  shopName = 'My Salon',
  ownerName = 'Owner',
  isPro = false,
  totalSalesCount = 0,
  freeSalesLimit = FREE_SALES_LIMIT,
  onUpgradePlan,
  onBack,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
  onToggleStaffStatus,
  onUpdateStaffPermissions,
  onUpdateStaffRating,
  onManage,
}: StaffScreenProps) => {
  const pullRefresh = usePullRefresh(onRefresh);
  const { colors } = useTheme();
  const { t } = useLanguage();
  const [period, setPeriod] = useState<Period>('Day');
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

  // Add / Edit Stylist Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [stylistName, setStylistName] = useState('');
  const [stylistPhone, setStylistPhone] = useState('');
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [actionMenuStaff, setActionMenuStaff] = useState<StaffMember | null>(null);

  // Stylist Permissions Modal
  const [permissionsStaff, setPermissionsStaff] = useState<StaffMember | null>(null);

  const handleSavePermissions = async (staffId: string, permissions: StylistPermissions) => {
    if (onUpdateStaffPermissions) {
      await onUpdateStaffPermissions(staffId, permissions);
    } else if (shopId) {
      await staffRepository.updateStaffPermissions(shopId, staffId, permissions);
    } else {
      throw new Error('No salon selected');
    }
  };

  // Rating Modal state
  const [ratingStaff, setRatingStaff] = useState<StaffMember | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [isSavingRating, setIsSavingRating] = useState(false);

  const handleOpenRatingModal = (s: StaffMember) => {
    setRatingStaff(s);
    const parsed = parseFloat(s.rating);
    setSelectedRating(!isNaN(parsed) && parsed >= 1 && parsed <= 5 ? Math.round(parsed) : 5);
  };

  const handleSaveRating = async () => {
    if (!ratingStaff) return;
    setIsSavingRating(true);
    try {
      const formatted = selectedRating.toFixed(1);
      if (onUpdateStaffRating) {
        await onUpdateStaffRating(ratingStaff.id, formatted);
      } else if (shopId) {
        await staffRepository.updateStaffRating(shopId, ratingStaff.id, formatted);
      }
      setRatingStaff(null);
      Alert.alert(t('ratingSaved', 'Rating Saved'), `${ratingStaff.name}'s rating has been updated to ${formatted} ★`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save rating');
    } finally {
      setIsSavingRating(false);
    }
  };

  const [stylistLimit, setStylistLimit] = useState(3);
  useEffect(() => {
    if (!shopId) return;
    let mounted = true;
    staffRepository.getStylistLimit(shopId).then((limit) => {
      if (mounted) setStylistLimit(limit);
    });
    return () => {
      mounted = false;
    };
  }, [shopId]);

  const isReportDownloadLocked =!isPro && totalSalesCount >= freeSalesLimit;

  const handleSendInvite = async (s: StaffMember) => {
    const cleanPhone = (s.phone || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length !== 10) {
      Alert.alert('Phone Required', 'Please provide a valid 10-digit mobile number for this stylist.');
      return;
    }

    const inviteDeepLink = `stylefleet://invite?phone=${cleanPhone}&shop=${shopId || ''}`;
    const message =
      `You have been added as a stylist to ${shopName}.\n\n` +
      `Tap here to open StyleFleet and login as Stylist:\n` +
      `${inviteDeepLink}\n\n` +
      `Or download StyleFleet from the Play Store:\n` +
      `${STYLEFLEET_PLAY_STORE_URL}\n\n` +
      `If the link doesn't open: open StyleFleet, tick "Login as Stylist" and enter this mobile number: ${cleanPhone}`;

    openWhatsAppPreferred(cleanPhone, message).catch((e: unknown) => Alert.alert('WhatsApp', e instanceof Error ? e.message : 'Could not open WhatsApp.'));

    if (shopId && s.id) {
      try {
        await staffRepository.recordStylistInvite(shopId, s.id);
      } catch (e: any) {
        Alert.alert('Invite not recorded', e?.message || 'The invite was opened, but it could not be marked as invited.');
      }
    }
  };

  // Compute staff metrics for selected period (Day, Week, Month including Today)
  const { staffWithPeriodMetrics, performanceRows, totalServices, totalRevenueMinor } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

    const getBillTime = (b: Bill): number => {
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

    let startLimit = todayStart;
    let endLimit = todayEnd;
    if (period === 'Day') {
      startLimit = todayStart;
      endLimit = todayEnd;
    } else if (period === 'Week') {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diffToMonday);
      mon.setHours(0, 0, 0, 0);
      startLimit = mon.getTime();
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);
      endLimit = sun.getTime();
    } else {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      startLimit = mStart.getTime();
      endLimit = mEnd.getTime();
    }

    const periodBills = bills.filter((b) => {
      if (!b || b.status === 'deleted') return false;
      const t = getBillTime(b);
      return t >= startLimit && t <= endLimit;
    });

    const effectiveOwnerName = (ownerName || 'Owner').trim();
    const effectiveOwnerLower = effectiveOwnerName.toLowerCase();

    // 1. Matched metrics for registered staff members
    const staffMetrics = staff.map((s) => {
      const sNameLower = s.name.trim().toLowerCase();
      const matchedBills = periodBills.filter((b) => {
        if (b.staff_id && b.staff_id === s.id) return true;
        const bName = (b.staff_name || '').trim().toLowerCase();
        return bName && bName === sNameLower;
      });

      let revMinor = 0;
      let count = 0;
      for (const b of matchedBills) {
        revMinor += b.total_minor || 0;
        count += b.items ? b.items.length : 1;
      }

      return {
        ...s,
        period_rev_minor: revMinor,
        period_service_count: count,
        // all-time, from real bills (not limited to the Day / Week / Month shown above)
        rebook_percent: calculateRebookPercent(bills, s),
      };
    });

    // 2. Matched metrics for salon owner / unassigned bills
    const ownerBills = periodBills.filter((b) => {
      const rawName = (b.staff_name || '').trim().toLowerCase();
      const isRegisteredStaff = staff.some(
        (st) => (b.staff_id && b.staff_id === st.id) || (rawName && rawName === st.name.trim().toLowerCase())
      );
      if (isRegisteredStaff) return false;

      return (
        !rawName ||
        !b.staff_id ||
        rawName === 'no stylist' ||
        rawName === 'unassigned' ||
        rawName === 'any' ||
        rawName === 'any stylist' ||
        rawName === effectiveOwnerLower ||
        rawName === 'owner' ||
        rawName === 'salon owner' ||
        rawName === 'reception'
      );
    });

    let ownerRevMinor = 0;
    let ownerCount = 0;
    for (const b of ownerBills) {
      ownerRevMinor += b.total_minor || 0;
      ownerCount += b.items ? b.items.length : 1;
    }

    const ownerRow: StylistReportRow = {
      id: 'owner',
      name: effectiveOwnerName,
      isOwner: true,
      role: 'Salon Owner',
      phone: null,
      servicesCount: ownerCount,
      salesMinor: ownerRevMinor,
      sharePct: 0,
    };

    const stylistReportRows: StylistReportRow[] = staffMetrics.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      isOwner: false,
      role: s.role || 'Stylist',
      phone: s.phone,
      servicesCount: s.period_service_count,
      salesMinor: s.period_rev_minor,
      sharePct: 0,
    }));

    const allReportRows = [ownerRow, ...stylistReportRows];
    const totalSalonSales = allReportRows.reduce((acc, r) => acc + r.salesMinor, 0);

    for (const r of allReportRows) {
      r.sharePct = totalSalonSales > 0 ? Math.round((r.salesMinor / totalSalonSales) * 100) : 0;
    }

    const sortedReportRows = allReportRows.sort((a, b) => b.salesMinor - a.salesMinor);
    const totalServicesCount = sortedReportRows.reduce((acc, r) => acc + r.servicesCount, 0);
    const totalRevenue = sortedReportRows.reduce((acc, r) => acc + r.salesMinor, 0);

    return {
      staffWithPeriodMetrics: staffMetrics,
      performanceRows: sortedReportRows,
      totalServices: totalServicesCount,
      totalRevenueMinor: totalRevenue,
    };
  }, [staff, bills, period, ownerName]);

  // Export Stylist Performance to PDF
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
  <title>Stylist Performance Report - ${shopName}</title>
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
    .badge {
      display: inline-block;
      background: #FEF3C7;
      color: #92400E;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 4px;
      margin-top: 8px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .card {
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 12px 14px;
      background: #F9FAFB;
    }
    .label {
      font-size: 11px;
      text-transform: uppercase;
      color: #6B7280;
      font-weight: 600;
    }
    .val {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-top: 4px;
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
      padding: 10px;
      font-weight: 600;
      border-bottom: 1px solid #D1D5DB;
    }
    td {
      padding: 10px;
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
    <div class="salon-sub">Stylist & Team Performance Report</div>
    <div class="badge">PERIOD: ${period.toUpperCase()}</div>
  </div>

  <div class="summary-grid">
    <div class="card">
      <div class="label">Total Team Sales</div>
      <div class="val" style="color: #D4AF37;">${inrFromMinor(totalRevenueMinor)}</div>
    </div>
    <div class="card">
      <div class="label">Services Delivered</div>
      <div class="val">${totalServices}</div>
    </div>
    <div class="card">
      <div class="label">Team Members</div>
      <div class="val">${performanceRows.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Stylist / Member</th>
        <th>Role</th>
        <th class="text-right">Services Delivered</th>
        <th class="text-right">Revenue Generated</th>
        <th class="text-right">% Share</th>
      </tr>
    </thead>
    <tbody>
      ${performanceRows
        .map(
          (r) => `
        <tr>
          <td><strong>${r.name}</strong> ${r.isOwner ? '<span style="font-size:10px; color:#D4AF37;">(Owner)</span>' : ''}</td>
          <td>${r.role}</td>
          <td class="text-right">${r.servicesCount}</td>
          <td class="text-right"><strong>${inrFromMinor(r.salesMinor)}</strong></td>
          <td class="text-right">${r.sharePct}%</td>
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
      const cleanShop = (shopName || 'Salon').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Stylist_Report_${cleanShop}_${period}_${Date.now()}.pdf`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      if (base64) {
        await FileSystem.writeAsStringAsync(targetUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.copyAsync({ from: uri, to: targetUri });
      }

      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (available) {
        await Sharing.shareAsync(targetUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share Stylist Report - ${shopName}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.warn('Stylist PDF Export Error:', err);
      Alert.alert('Export Error', err.message || 'Could not export Stylist Performance PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Export Stylist Performance to Excel / CSV
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
      rows.push(`"StyleFleet Stylist Performance Report"`);
      rows.push(`"Shop Name","${(shopName || 'Salon').replace(/"/g, '""')}"`);
      rows.push(`"Period","${period}"`);
      rows.push(`"Generated On","${new Date().toLocaleString('en-IN').replace(/"/g, '""')}"`);
      rows.push(``);

      rows.push(`"STYLIST PERFORMANCE SUMMARY"`);
      rows.push(
        `"Stylist Name","Role","Phone","Services Delivered","Total Revenue (INR)","Contribution Share (%)"`
      );
      for (const r of performanceRows) {
        rows.push(
          `"${r.name.replace(/"/g, '""')}","${r.role}","${r.phone || ''}","${r.servicesCount}","${(r.salesMinor / 100).toFixed(2)}","${r.sharePct}%"`
        );
      }

      const csvContent = rows.join('\n');
      const cleanShop = (shopName || 'Salon').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Stylist_Report_${cleanShop}_${period}_${Date.now()}.csv`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(targetUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (available) {
        await Sharing.shareAsync(targetUri, {
          mimeType: 'text/csv',
          dialogTitle: `Share Stylist Report CSV - ${shopName}`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'File sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.warn('Stylist CSV Export Error:', err);
      Alert.alert('Export Error', err.message || 'Could not export Stylist Performance CSV.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleAddStylistClick = () => {
    if (staff.filter((s) => s.is_active !== false).length >= stylistLimit) {
      setShowSupportModal(true);
    } else {
      setEditingStaff(null);
      setStylistName('');
      setStylistPhone('');
      setShowAddModal(true);
    }
  };

  const handleOpenEdit = (s: StaffMember) => {
    setEditingStaff(s);
    setStylistName(s.name);
    setStylistPhone(s.phone || '');
    setShowAddModal(true);
  };

  const handleToggleStylistInactive = (s: StaffMember) => {
    const isCurrentlyActive = s.is_active !== false;
    Alert.alert(
      isCurrentlyActive ? 'Make Stylist Inactive' : 'Reactivate Stylist',
      isCurrentlyActive
        ? `Are you sure you want to mark "${s.name}" as inactive?\n\nThey will not be selectable for new appointments or bills. All past sales, bills, customer history, and performance reports will remain 100% safely preserved.`
        : `Reactivate "${s.name}" to make them available for new appointments and bills?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isCurrentlyActive ? 'Make Inactive' : 'Reactivate',
          style: isCurrentlyActive ? 'destructive' : 'default',
          onPress: async () => {
            try {
              if (onToggleStaffStatus) {
                await onToggleStaffStatus(s.id);
              } else if (onDeleteStaff) {
                await onDeleteStaff(s.id);
              }
              Alert.alert(
                isCurrentlyActive ? 'Stylist Inactive' : 'Stylist Reactivated',
                isCurrentlyActive
                  ? `${s.name} is now inactive. All past history is preserved.`
                  : `${s.name} has been reactivated successfully.`
              );
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not update stylist status');
            }
          },
        },
      ]
    );
  };

  const handleSaveStylist = async () => {
    const trimmedName = stylistName.trim();
    if (!trimmedName) {
      Alert.alert('Name Required', 'Please enter stylist name');
      return;
    }

    const cleanPhone = stylistPhone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length !== 10) {
      Alert.alert('Phone Required', 'Please enter a valid 10-digit mobile number for the stylist.');
      return;
    }

    setIsSaving(true);
    try {
      if (editingStaff) {
        if (onUpdateStaff) {
          await onUpdateStaff(editingStaff.id, trimmedName, cleanPhone, editingStaff.role);
        }
        setShowAddModal(false);
        setEditingStaff(null);
        Alert.alert('Stylist Updated', `${trimmedName}'s details have been updated.`);
      } else {
        if (onAddStaff) {
          await onAddStaff(trimmedName, 'Stylist', cleanPhone);
        }
        setShowAddModal(false);
        const tempStylist: StaffMember = {
          id: `temp_${Date.now()}`,
          shop_id: shopId || '',
          name: trimmedName,
          phone: cleanPhone,
          role: 'Stylist',
          is_active: true,
          target_amount_minor: 0,
          revenue_minor: 0,
          service_count: 0,
          rebook_rate: '0%',
          rating: '5.0',
          chair_utilization: '0%',
          invitation_status: 'not_invited',
        };
        Alert.alert(
          'Stylist Added',
          `"${trimmedName}" has been added to your salon team.\n\nWould you like to send an invitation via WhatsApp now?`,
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Invite via WhatsApp',
              onPress: () => handleSendInvite(tempStylist),
            },
          ]
        );
      }
      setStylistName('');
      setStylistPhone('');
    } catch (e: any) {
      Alert.alert('Notice', e.message || 'Could not save stylist');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.header}>
        <View style={styles.topBar}>
          <Button variant="icon" onPress={onBack}>
            <BackIcon size={18} color={colors.text} />
          </Button>
          <Text style={[styles.title, { color: colors.text }]}>{t('team')}</Text>
          <TouchableOpacity onPress={handleAddStylistClick} style={{ marginLeft: 'auto' }}>
            <Text style={[styles.manageText, { color: colors.accent }]}>{t('addStylist')}</Text>
          </TouchableOpacity>
        </View>

        {/* Period Selector Tabs (Day, Week, Month including Today) */}
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
                    backgroundColor: isSelected ? colors.accent900 : 'transparent',
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: isSelected ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.periodTabText,
                    {
                      color: isSelected ? colors.accent : colors.textMuted,
                    },
                  ]}
                >
                  {p === 'Day' ? t('day') : p === 'Week' ? t('week') : t('month')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={pullRefresh}>
        {/* Stylist Performance Report Header Card */}
        <View style={[styles.perfReportCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 16 }}>📈</Text>
              <Text style={[styles.perfReportTitle, { color: colors.text, flex: 1 }]}>
                {t('stylistPerformanceReport', 'Stylist Performance Report')}
              </Text>
            </View>
            <Text style={[styles.perfReportSub, { color: colors.textDim }]}>
              {totalServices} services · {inrFromMinor(totalRevenueMinor)} billed ({period})
            </Text>
          </View>

          <View style={styles.perfActionBtns}>
            <TouchableOpacity
              style={[styles.perfBtn, { backgroundColor: colors.accent }]}
              activeOpacity={0.8}
              onPress={() => setShowReportModal(true)}
            >
              <Text style={styles.perfBtnTextDark}>View Report</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.perfIconBtn, { backgroundColor: colors.bg, borderColor: colors.divider }]}
              activeOpacity={0.8}
              onPress={handleExportPdf}
              disabled={isExportingPdf || isExportingCsv}
            >
              {isExportingPdf ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : isReportDownloadLocked ? (
                <LockIcon size={14} color={colors.accent} />
              ) : (
                <PdfIcon size={16} color="#EF4444" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.perfIconBtn, { backgroundColor: colors.bg, borderColor: colors.divider }]}
              activeOpacity={0.8}
              onPress={handleExportCsv}
              disabled={isExportingPdf || isExportingCsv}
            >
              {isExportingCsv ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : isReportDownloadLocked ? (
                <LockIcon size={14} color={colors.accent} />
              ) : (
                <ExcelIcon size={16} color="#10B981" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.list}>
          {staffWithPeriodMetrics.map((s, idx) => {
            const isTop = idx === 0 && s.period_rev_minor > 0;

            return (
              <View
                key={s.id}
                style={[styles.staffCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}
              >
                {/* Header row */}
                <View style={styles.cardHeaderRow}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: colors.accent800 },
                    ]}
                  >
                    <Text style={[styles.avatarText, { color: colors.accent100 }]}>
                      {getInitials(s.name)}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.staffName, { color: colors.text }]}>
                        {s.name}
                      </Text>
                      {isTop ? (
                        <View
                          style={[
                            styles.topBadge,
                            { backgroundColor: colors.accent900 },
                          ]}
                        >
                          <Text style={[styles.topBadgeText, { color: colors.accent200 }]}>
                            Top
                          </Text>
                        </View>
                      ) : null}
                      {s.is_active === false ? (
                        <View
                          style={[
                            styles.topBadge,
                            { backgroundColor: 'rgba(156, 163, 175, 0.18)', borderWidth: 1, borderColor: '#9CA3AF' },
                          ]}
                        >
                          <Text style={[styles.topBadgeText, { color: '#9CA3AF', fontSize: 10 }]}>
                            Inactive
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.staffRole, { color: colors.textDim }]}>
                      {s.role} {s.phone ? `· +91 ${s.phone}` : ''}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.revenueText, { color: colors.text }]}>
                        {inrFromMinor(s.period_rev_minor)}
                      </Text>
                      <Text style={[styles.jobsText, { color: colors.textDim }]}>
                        {s.period_service_count} services
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setActionMenuStaff(s)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.moreOptionsBtn}
                      activeOpacity={0.7}
                    >
                      <MoreVerticalIcon size={18} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Metrics Row & Invitation Status */}
                <View style={styles.metricsRow}>
                  <Text style={[styles.metricItem, { color: colors.textMuted }]}>
                    Rebook {s.rebook_percent === null ? '–' : `${s.rebook_percent}%`}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleOpenRatingModal(s)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 2,
                      paddingVertical: 2,
                      paddingHorizontal: 6,
                      borderRadius: radii.sm,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.divider,
                    }}
                    accessibilityLabel={`Rating: ${s.rating || '5.0'} out of 5 stars`}
                  >
                    {[1, 2, 3, 4, 5].map((starIdx) => {
                      const num = parseFloat(s.rating) || 5;
                      const isFilled = starIdx <= Math.round(num);
                      return (
                        <StarIcon
                          key={starIdx}
                          size={11}
                          color="#D9A441"
                          fill={isFilled ? '#D9A441' : 'none'}
                          strokeWidth={1.5}
                        />
                      );
                    })}
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accent, marginLeft: 3 }}>
                      {s.rating || '5.0'}
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor:
                        s.invitation_status === 'active'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : s.invitation_status === 'invited'
                          ? 'rgba(59, 130, 246, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '700',
                        color:
                          s.invitation_status === 'active'
                            ? '#10B981'
                            : s.invitation_status === 'invited'
                            ? '#3B82F6'
                            : '#F59E0B',
                      }}
                    >
                      {s.invitation_status === 'active'
                        ? 'Active'
                        : s.invitation_status === 'invited'
                        ? 'Invited'
                        : 'Not Invited'}
                    </Text>
                  </View>
                </View>

                {/* Invite Action Row (Below) */}
                <View style={[styles.inviteActionRow, { borderTopColor: colors.divider }]}>
                  <Text style={[styles.inviteStatusLabel, { color: colors.textDim }]}>
                    {s.invitation_status === 'active'
                      ? 'Stylist is active on app'
                      : s.invitation_status === 'invited'
                      ? 'Invitation link sent'
                      : 'Not yet joined on app'}
                  </Text>
                  {s.invitation_status === 'active' ? (
                    <View style={styles.activePill}>
                      <Text style={{ fontSize: 13 }}>✅</Text>
                      <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '600' }}>Active</Text>
                    </View>
                  ) : s.invitation_status === 'invited' ? (
                    <TouchableOpacity
                      onPress={() => handleSendInvite(s)}
                      activeOpacity={0.7}
                      style={[
                        styles.inviteActionBtn,
                        { borderColor: colors.accent, backgroundColor: colors.accent900 },
                      ]}
                    >
                      <WhatsAppIcon size={13} color="#25D366" />
                      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>
                        Resend Invite
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleSendInvite(s)}
                      activeOpacity={0.7}
                      style={[
                        styles.inviteActionBtn,
                        { borderColor: colors.accent, backgroundColor: colors.accent900 },
                      ]}
                    >
                      <WhatsAppIcon size={13} color="#25D366" />
                      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>
                        Invite via WhatsApp
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Add / Edit Stylist Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => {
                setShowAddModal(false);
                setEditingStaff(null);
              }}
            />
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'center',
                paddingVertical: 24,
                paddingBottom: Math.max(30, keyboardHeight + 30),
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              automaticallyAdjustKeyboardInsets={true}
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    {editingStaff ? 'Edit Stylist' : t('addStylist')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAddModal(false);
                      setEditingStaff(null);
                    }}
                  >
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>{t('cancel')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Import from Contacts Button */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setIsContactPickerOpen(true)}
                  style={[
                    styles.contactImportBtn,
                    {
                      borderColor: colors.accent,
                      backgroundColor: colors.accent + '15',
                    },
                  ]}
                >
                  <UsersIcon size={16} color={colors.accent} />
                  <Text style={[styles.contactImportBtnText, { color: colors.accent }]}>
                    {t('importFromContacts', 'Import from Contacts')}
                  </Text>
                </TouchableOpacity>

                <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' }}>
                  Stylist Name *
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginBottom: 12 },
                  ]}
                  placeholder={t('fullName')}
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={stylistName}
                  onChangeText={setStylistName}
                  autoFocus
                />

                <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' }}>
                  Mobile Number (10 Digits) *
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginBottom: 16 },
                  ]}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={stylistPhone}
                  onChangeText={setStylistPhone}
                  keyboardType="phone-pad"
                  maxLength={10}
                />

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleSaveStylist}
                  disabled={isSaving}
                  style={[styles.modalAddBtn, { backgroundColor: colors.accent }]}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={{ color: '#000', fontWeight: '600', fontSize: 14 }}>
                      {t('save')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quick Contact Picker Modal for Stylists */}
      <QuickContactPickerModal
        visible={isContactPickerOpen}
        existingPhones={staff.map((s) => (s.phone || '').replace(/\D/g, '').slice(-10)).filter(Boolean)}
        existingBadgeText="Already in Team"
        title="Select Stylist from Contacts"
        onClose={() => setIsContactPickerOpen(false)}
        onSelectContact={({ name, phone }) => {
          setStylistName(name);
          const cleanPhone = phone.replace(/\D/g, '').slice(-10);
          setStylistPhone(cleanPhone);
          setIsContactPickerOpen(false);
        }}
      />



      {/* Support Box Modal when 3 Stylists Limit Reached */}
      <Modal visible={showSupportModal} animationType="fade" transparent onRequestClose={() => setShowSupportModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowSupportModal(false)} />
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider, maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Stylist Limit Reached</Text>
              <TouchableOpacity onPress={() => setShowSupportModal(false)}>
                <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: 8 }}>
              You have reached the maximum allowed limit of {stylistLimit} active stylists for your salon account. To add more stylist slots, please contact StyleFleet support.
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => Linking.openURL('tel:8903368006')}
              style={{ backgroundColor: colors.bg, padding: 14, borderRadius: radii.md, marginTop: 16, borderWidth: 1, borderColor: colors.divider }}
            >
              <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }}>Help & Support Desk</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <PhoneCallIcon size={15} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '700' }}>
                  {process.env.EXPO_PUBLIC_SUPPORT_PHONE || '+91 89033 68006'}
                </Text>
              </View>
              <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 2 }}>Tap to call StyleFleet Team Support</Text>
            </TouchableOpacity>
            <View style={{ marginTop: 20 }}>
              <Button label="Close" onPress={() => setShowSupportModal(false)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Stylist Performance Report Modal */}
      <Modal
        visible={showReportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.reportModalBox,
              { backgroundColor: colors.surface, borderColor: colors.divider },
            ]}
          >
            <View style={styles.reportModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Stylist Performance Report
                </Text>
                <Text style={[styles.reportModalSub, { color: colors.textDim }]}>
                  {shopName} {'\u00b7'} {period} {'\u00b7'} {performanceRows.length} {performanceRows.length === 1 ? 'member' : 'members'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowReportModal(false)}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: colors.textDim, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Summary tiles */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: 'Total billed', value: shortInrFromMinor(totalRevenueMinor), tone: colors.accent },
                { label: 'Services', value: String(totalServices), tone: colors.text },
                {
                  label: 'Avg / service',
                  value: totalServices > 0 ? shortInrFromMinor(Math.round(totalRevenueMinor / totalServices)) : '\u2013',
                  tone: colors.text,
                },
              ].map((k) => (
                <View
                  key={k.label}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 9,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.divider,
                    backgroundColor: colors.bg,
                  }}
                >
                  <Text style={{ color: colors.textDim, fontSize: 10.5, fontWeight: '600' }} numberOfLines={1}>
                    {k.label}
                  </Text>
                  <Text style={{ color: k.tone, fontSize: 16, fontWeight: '800', marginTop: 2 }} numberOfLines={1}>
                    {k.value}
                  </Text>
                </View>
              ))}
            </View>

            {/* Ranked performance */}
            <ScrollView style={{ maxHeight: 360, marginTop: 10, marginBottom: 6 }} showsVerticalScrollIndicator={false}>
              {performanceRows.length === 0 ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ color: colors.textDim, fontSize: 13 }}>No stylist activity in this period</Text>
                </View>
              ) : (
                performanceRows.map((item, idx) => {
                  const top = idx === 0 && item.salesMinor > 0;
                  const medal = ['#E3B93C', '#B8C2D6', '#C98A5B'][idx] || colors.divider;
                  const pct = Math.max(0, Math.min(100, item.sharePct));
                  return (
                    <View
                      key={item.id}
                      style={{
                        marginBottom: 7,
                        padding: 10,
                        borderRadius: 14,
                        borderWidth: top ? 1.5 : 1,
                        borderColor: top ? colors.accent : colors.divider,
                        backgroundColor: top ? colors.accent + '14' : colors.bg,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: idx < 3 && item.salesMinor > 0 ? medal : 'transparent',
                            borderWidth: idx < 3 && item.salesMinor > 0 ? 0 : 1,
                            borderColor: colors.divider,
                          }}
                        >
                          <Text
                            style={{
                              color: idx < 3 && item.salesMinor > 0 ? '#1A1A1A' : colors.textDim,
                              fontSize: 11.5,
                              fontWeight: '800',
                            }}
                          >
                            {idx + 1}
                          </Text>
                        </View>

                        <View
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.accent + '24',
                          }}
                        >
                          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '800' }}>
                            {getInitials(item.name)}
                          </Text>
                        </View>

                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                              {item.name}
                            </Text>
                            {item.isOwner && (
                              <View style={[styles.ownerBadge, { backgroundColor: 'rgba(217, 164, 65, 0.15)' }]}>
                                <Text style={[styles.ownerBadgeText, { color: colors.accent }]}>Owner</Text>
                              </View>
                            )}
                            {top && (
                              <View style={[styles.ownerBadge, { backgroundColor: colors.accent }]}>
                                <Text style={[styles.ownerBadgeText, { color: '#0D0F14' }]}>Top performer</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                            {item.role} {'\u00b7'} {item.servicesCount} {item.servicesCount === 1 ? 'service' : 'services'}
                            {item.servicesCount > 0 ? ` \u00b7 avg ${shortInrFromMinor(Math.round(item.salesMinor / item.servicesCount))}` : ''}
                          </Text>
                        </View>

                        <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '800' }}>
                          {shortInrFromMinor(item.salesMinor)}
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.divider, overflow: 'hidden' }}>
                          <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: top ? colors.accent : colors.accent + '99' }} />
                        </View>
                        <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700', minWidth: 34, textAlign: 'right' }}>
                          {item.sharePct}%
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* Quick Export Actions */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <TouchableOpacity
                style={[
                  styles.modalExportBtn,
                  { backgroundColor: colors.bg, borderColor: colors.divider, borderWidth: 1 },
                ]}
                onPress={handleExportPdf}
                disabled={isExportingPdf || isExportingCsv}
              >
                {isExportingPdf ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <>
                    {isReportDownloadLocked ? (
                      <LockIcon size={15} color={colors.accent} />
                    ) : (
                      <PdfIcon size={16} color="#EF4444" />
                    )}
                    <Text style={[styles.modalExportBtnText, { color: colors.text }]}>
                      Export PDF
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalExportBtn,
                  { backgroundColor: colors.bg, borderColor: colors.divider, borderWidth: 1 },
                ]}
                onPress={handleExportCsv}
                disabled={isExportingPdf || isExportingCsv}
              >
                {isExportingCsv ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <>
                    {isReportDownloadLocked ? (
                      <LockIcon size={15} color={colors.accent} />
                    ) : (
                      <ExcelIcon size={16} color="#10B981" />
                    )}
                    <Text style={[styles.modalExportBtnText, { color: colors.text }]}>
                      Export Excel
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.modalCloseFullBtn, { backgroundColor: colors.accent, marginTop: 12 }]}
              onPress={() => setShowReportModal(false)}
            >
              <Text style={{ color: '#0D0F14', fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Staff Action Menu Modal (Edit & Delete via MoreVerticalIcon) */}
      <Modal
        visible={!!actionMenuStaff}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuStaff(null)}
      >
        <TouchableOpacity
          style={styles.actionMenuBackdrop}
          activeOpacity={1}
          onPress={() => setActionMenuStaff(null)}
        >
          <View
            style={[
              styles.actionMenuCard,
              { backgroundColor: colors.surface, borderColor: colors.divider },
            ]}
          >
            <View style={styles.actionMenuHeader}>
              <Text style={[styles.actionMenuTitle, { color: colors.text }]}>
                {actionMenuStaff?.name}
              </Text>
              <Text style={[styles.actionMenuSubtitle, { color: colors.textDim }]}>
                {actionMenuStaff?.role} {actionMenuStaff?.phone ? `· +91 ${actionMenuStaff.phone}` : ''}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.actionMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                const s = actionMenuStaff;
                setActionMenuStaff(null);
                if (s) handleOpenEdit(s);
              }}
            >
              <EditIcon size={16} color={colors.accent} />
              <Text style={[styles.actionMenuText, { color: colors.text }]}>Edit Stylist</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                const s = actionMenuStaff;
                setActionMenuStaff(null);
                if (s) handleOpenRatingModal(s);
              }}
            >
              <StarIcon size={16} color="#D9A441" fill="#D9A441" />
              <Text style={[styles.actionMenuText, { color: colors.text }]}>
                {t('rateStylist', 'Add / Update Rating')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                const s = actionMenuStaff;
                setActionMenuStaff(null);
                if (s) setPermissionsStaff(s);
              }}
            >
              <LockIcon size={16} color={colors.accent} />
              <Text style={[styles.actionMenuText, { color: colors.text }]}>
                {t('stylistPermissions', 'Permissions & Access')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionMenuItem, { borderBottomColor: 'transparent' }]}
              onPress={() => {
                const s = actionMenuStaff;
                setActionMenuStaff(null);
                if (s) handleToggleStylistInactive(s);
              }}
            >
              <TrashIcon size={16} color={actionMenuStaff?.is_active === false ? '#10B981' : '#EF4444'} />
              <Text style={[styles.actionMenuText, { color: actionMenuStaff?.is_active === false ? '#10B981' : '#EF4444' }]}>
                {actionMenuStaff?.is_active === false ? 'Reactivate Stylist' : 'Make Inactive'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Stylist Rating Modal (Interactive 5 Stars) */}
      <Modal
        visible={!!ratingStaff}
        transparent
        animationType="fade"
        onRequestClose={() => setRatingStaff(null)}
      >
        <TouchableOpacity
          style={styles.actionMenuBackdrop}
          activeOpacity={1}
          onPress={() => setRatingStaff(null)}
        >
          <View
            style={[
              styles.actionMenuCard,
              { backgroundColor: colors.surface, borderColor: colors.divider, padding: 20 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.actionMenuTitle, { color: colors.text }]}>
                  {t('stylistRating', 'Stylist Rating')}
                </Text>
                <Text numberOfLines={1} style={[styles.actionMenuSubtitle, { color: colors.textDim }]}>
                  {ratingStaff?.name} · {ratingStaff?.role || 'Stylist'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setRatingStaff(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: colors.textDim, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 5 Stars Rating Row */}
            <View style={{ alignItems: 'center', marginVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {[1, 2, 3, 4, 5].map((starVal) => (
                  <TouchableOpacity
                    key={starVal}
                    activeOpacity={0.7}
                    onPress={() => setSelectedRating(starVal)}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  >
                    <StarIcon
                      size={36}
                      color="#D9A441"
                      fill={starVal <= selectedRating ? '#D9A441' : 'none'}
                      strokeWidth={1.5}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.accent }}>
                {selectedRating.toFixed(1)} / 5.0
              </Text>
              <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
                {selectedRating === 5
                  ? '★★★★★ Exceptional Service'
                  : selectedRating === 4
                  ? '★★★★☆ Very Good'
                  : selectedRating === 3
                  ? '★★★☆☆ Good'
                  : selectedRating === 2
                  ? '★★☆☆☆ Needs Improvement'
                  : '★☆☆☆☆ Poor'}
              </Text>
            </View>

            {/* Save Rating Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleSaveRating}
              disabled={isSavingRating}
              style={{
                backgroundColor: colors.accent,
                paddingVertical: 12,
                borderRadius: radii.sm,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              {isSavingRating ? (
                <ActivityIndicator size="small" color="#120E06" />
              ) : (
                <Text style={{ color: '#120E06', fontWeight: '700', fontSize: 14 }}>
                  {t('saveRating', 'Save Rating')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <StylistPermissionsModal
        staff={permissionsStaff}
        onClose={() => setPermissionsStaff(null)}
        onSave={handleSavePermissions}
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
    paddingTop: 14,
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
  manageText: {
    fontSize: 13,
    fontWeight: '600',
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
    fontSize: 11.5,
    fontWeight: '500',
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
  list: {
    gap: 9,
  },
  staffCard: {
    padding: 12,
    borderRadius: radii.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '500',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  staffName: {
    fontSize: 14.5,
  },
  topBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  topBadgeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  staffRole: {
    fontSize: 11.5,
    marginTop: 2,
  },
  revenueText: {
    fontSize: 15,
    fontWeight: '500',
  },
  jobsText: {
    fontSize: 10.5,
    marginTop: 2,
  },

  metricsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
  },
  metricItem: {
    fontSize: 11.5,
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    height: 48,
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
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  contactImportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 14,
    gap: 8,
  },
  contactImportBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalAddBtn: {
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perfReportCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  perfReportTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  perfReportSub: {
    fontSize: 12,
    marginTop: 2,
  },
  perfActionBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  perfBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
  },
  perfBtnTextDark: {
    color: '#0D0F14',
    fontSize: 12,
    fontWeight: '700',
  },
  perfIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportModalBox: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
    maxHeight: '90%',
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  reportModalSub: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 10,
  },
  reportKpiRow: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginBottom: 10,
  },
  reportKpiLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  reportKpiVal: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  reportStaffName: {
    fontSize: 14,
    fontWeight: '700',
  },
  reportStaffRole: {
    fontSize: 12,
    marginTop: 2,
  },
  reportTargetText: {
    fontSize: 11,
    marginTop: 2,
  },
  reportSalesAmt: {
    fontSize: 14,
    fontWeight: '700',
  },
  reportSharePct: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  modalExportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  modalExportBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalCloseFullBtn: {
    paddingVertical: 12,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
  moreOptionsBtn: {
    padding: 3,
    marginTop: -2,
    marginLeft: 2,
  },
  inviteActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  inviteStatusLabel: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inviteActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  actionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionMenuCard: {
    width: '100%',
    maxWidth: 290,
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
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
