import React, { useState } from 'react';
import { openWhatsAppPreferred } from '../../services/whatsappLauncher';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import {
  BackIcon,
  StarIcon,
  ChatIcon,
  EditIcon,
  ChevronRightIcon,
  TrashIcon,
  PhoneCallIcon,
  WhatsAppIcon,
} from '../../components/common/SvgIcons';
import { Customer, Bill } from '../../types/domain';
import { inr, inrFromMinor, getInitials } from '../../utils/format';
import { radii } from '../../theme/spacing';
import { CustomerManagerModal } from '../../components/customers/CustomerManagerModal';
import { SettleDueModal } from '../../components/customers/SettleDueModal';

interface CustomerDetailScreenProps {
  customer: Customer;
  bills?: Bill[];
  shopId?: string;
  onBack: () => void;
  onToggleStar: (customerId: string) => void;
  onStartBill: (customer: Customer) => void;
  onBookSlot: (customer: Customer) => void;
  onWhatsApp: (customer: Customer) => void;
  onOpenInvoice?: (bill: Bill) => void;
  onSettleDue?: (customerId: string, method?: 'cash' | 'upi', amountMinor?: number) => void;
  onUpdateCustomer?: (customer: Customer) => void;
  onDeleteCustomer?: (customerId: string) => Promise<void> | void;
}

export const CustomerDetailScreen = ({
  customer,
  bills = [],
  shopId,
  onBack,
  onToggleStar,
  onStartBill,
  onBookSlot,
  onWhatsApp,
  onOpenInvoice,
  onSettleDue,
  onUpdateCustomer,
  onDeleteCustomer,
}: CustomerDetailScreenProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);

  const isInactive = customer.is_active === false;

  const handleToggleInactive = () => {
    Alert.alert(
      isInactive ? 'Reactivate Customer' : 'Make Customer Inactive',
      isInactive
        ? `Reactivate ${customer.name} to make them active for new bills and bookings?`
        : `Are you sure you want to mark ${customer.name} as inactive? Their past billing, dues, appointments, and sales history will remain 100% safely preserved.`,
      [
        { text: t('cancel', 'Cancel'), style: 'cancel' },
        {
          text: isInactive ? 'Reactivate' : 'Inactive',
          style: isInactive ? 'default' : 'destructive',
          onPress: async () => {
            if (onDeleteCustomer) {
              await onDeleteCustomer(customer.id);
            }
          },
        },
      ]
    );
  };

  const handleCallCustomer = (phone?: string) => {
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      Alert.alert(
        t('invalidPhoneTitle', 'Phone Number Required'),
        t('invalidPhoneMsg', 'This customer does not have a valid 10-digit mobile number saved.')
      );
      return;
    }
    const standardPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    const phoneUrl = `tel:${standardPhone}`;
    Linking.canOpenURL(phoneUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(phoneUrl);
        } else {
          Alert.alert(t('error', 'Error'), t('cannotMakeCall', 'Unable to initiate call on this device.'));
        }
      })
      .catch((err) => {
        console.warn('Could not launch dialer:', err);
        Alert.alert(t('error', 'Error'), t('cannotMakeCall', 'Unable to initiate call on this device.'));
      });
  };

  const handleWhatsAppCustomer = (phone?: string, name?: string) => {
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      Alert.alert(
        t('invalidPhoneTitle', 'Phone Number Required'),
        t('invalidPhoneMsg', 'This customer does not have a valid 10-digit mobile number saved.')
      );
      return;
    }
    const standardPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    const greeting = `Hi ${name || 'there'}, greeting from our salon! How can we assist you today?`;
    openWhatsAppPreferred(standardPhone, greeting).catch((e: unknown) =>
      Alert.alert(t('error', 'Error'), e instanceof Error ? e.message : t('cannotOpenWhatsApp', 'Unable to open WhatsApp on this device.'))
    );
  };

  // Real bills from Supabase/cache, sorted descending (latest first)
  const customerBills = React.useMemo(() => {
    return bills
      .filter(
        (b) =>
          (b.customer_id === customer.id ||
            (b.customer_name &&
              b.customer_name.trim().toLowerCase() === customer.name.trim().toLowerCase())) &&
          b.status !== 'deleted'
      )
      .sort((a, b) => new Date(b.created_at || b.issued_at || 0).getTime() - new Date(a.created_at || a.issued_at || 0).getTime());
  }, [bills, customer.id, customer.name]);

  // Dynamically calculate lifetime spend and visits from real valid bills, immediately reflecting edits
  const dynamicLifetimeSpend = React.useMemo(() => {
    if (customerBills.length === 0) return customer.lifetime_spend_minor || 0;
    return customerBills.reduce((sum, b) => sum + (b.total_minor || 0), 0);
  }, [customerBills, customer.lifetime_spend_minor]);

  const dynamicVisitsCount = customerBills.length > 0 ? customerBills.length : customer.visits_count;
  const avgBill = dynamicVisitsCount > 0 ? Math.round(dynamicLifetimeSpend / dynamicVisitsCount) : 0;
  const lastBill = customerBills.length > 0 ? customerBills[0] : null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Top bar with back, edit, delete, and star */}
        <View style={styles.topBar}>
          <Button variant="icon" onPress={onBack}>
            <BackIcon size={18} color={colors.text} />
          </Button>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[styles.editTopBtn, { borderColor: colors.accent, backgroundColor: colors.accent900 }]}
            onPress={() => setIsEditModalOpen(true)}
            activeOpacity={0.7}
          >
            <EditIcon size={14} color={colors.accent} />
            <Text style={{ fontSize: 12.5, color: colors.accent, fontWeight: '600' }}>
              {t('edit', 'Edit')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.deleteTopBtn,
              {
                borderColor: isInactive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                backgroundColor: isInactive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              },
            ]}
            onPress={handleToggleInactive}
            activeOpacity={0.7}
          >
            <TrashIcon size={14} color={isInactive ? '#10B981' : '#EF4444'} />
            <Text style={{ fontSize: 12.5, color: isInactive ? '#10B981' : '#EF4444', fontWeight: '600' }}>
              {isInactive ? 'Reactivate' : 'Inactive'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.starButton}
            onPress={() => onToggleStar(customer.id)}
            activeOpacity={0.7}
          >
            <StarIcon
              size={20}
              color={customer.is_starred ? colors.accent : colors.textSubtle}
              fill={customer.is_starred ? colors.accent : 'none'}
            />
          </TouchableOpacity>
        </View>

        {/* Customer Header Info */}
        <View style={styles.profileHeader}>
          <View
            style={[
              styles.avatarLarge,
              { backgroundColor: colors.accent800 },
            ]}
          >
            <Text style={[styles.avatarLargeText, { color: colors.accent100 }]}>
              {getInitials(customer.name)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.customerName, { color: colors.text }]}>
              {customer.name}
            </Text>
            <View style={styles.phoneActionRow}>
              <Text style={[styles.customerPhone, { color: colors.textDim }]}>
                +91 {customer.phone}
              </Text>
              <View style={styles.headerActionBtns}>
                <TouchableOpacity
                  onPress={() => handleCallCustomer(customer.phone)}
                  style={[
                    styles.actionIconBtn,
                    {
                      ...getGlass(colors.isDark).card,
                      borderColor: colors.divider,
                    },
                  ]}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityLabel={`Call ${customer.name}`}
                >
                  <PhoneCallIcon size={14} color="#10B981" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleWhatsAppCustomer(customer.phone, customer.name)}
                  style={[
                    styles.actionIconBtn,
                    {
                      ...getGlass(colors.isDark).card,
                      borderColor: colors.divider,
                    },
                  ]}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityLabel={`WhatsApp ${customer.name}`}
                >
                  <WhatsAppIcon size={15} color="#25D366" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Tags */}
        <View style={styles.tagsRow}>
          {customer.is_starred ? (
            <View
              style={[
                styles.tag,
                { backgroundColor: colors.accent900, borderColor: colors.accent },
              ]}
            >
              <Text style={{ color: colors.accent200, fontSize: 11, fontWeight: '500' }}>
                ★ MVP
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.tag,
                { backgroundColor: colors.surface, borderColor: colors.divider },
              ]}
            >
              <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '500' }}>
                Regular
              </Text>
            </View>
          )}

          <View
            style={[
              styles.tag,
              { backgroundColor: 'transparent', borderColor: colors.divider },
            ]}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {customer.visits_count > 15 ? 'Every 3 weeks' : 'Occasional'}
            </Text>
          </View>

          {customer.outstanding_due_minor > 0 && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setIsSettleModalOpen(true)}
              style={[
                styles.tag,
                { backgroundColor: colors.accent900, borderColor: colors.accent, paddingHorizontal: 10 },
              ]}
            >
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
                Payment Due: {inrFromMinor(customer.outstanding_due_minor)}
                {customer.due_start_date && !customer.due_start_date.includes('Invalid') && !customer.due_start_date.includes('NaN')
                  ? ` (Since ${customer.due_start_date})`
                  : ''} · Tap to Settle
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Stats 3-column grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statBox, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.statLabel, { color: colors.textDim }]}>LIFETIME SPENT</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {inrFromMinor(dynamicLifetimeSpend)}
            </Text>
          </View>
          <View style={[styles.statBox, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.statLabel, { color: colors.textDim }]}>VISITS</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {dynamicVisitsCount}
            </Text>
          </View>
          <View style={[styles.statBox, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <Text style={[styles.statLabel, { color: colors.textDim }]}>AVG BILL</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {inrFromMinor(avgBill)}
            </Text>
          </View>
        </View>

        {/* Preferred Stylist & Note Card */}
        <View style={[styles.notesCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
          <Text style={[styles.stylistLabel, { color: colors.textDim }]}>
            Preferred stylist · {customer.preferred_stylist_name || 'Assigned Stylist'}
          </Text>
          <Text style={[styles.notesText, { color: colors.text }]}>
            {customer.notes || 'No special instructions recorded.'}
          </Text>
        </View>

        {/* LAST ORDER CARD */}
        {lastBill && (
          <View style={{ marginBottom: 16 }}>
            <Text style={[styles.sectionTitle, { color: colors.accent, marginBottom: 8 }]}>
              {t('lastOrder', 'LAST ORDER')}
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => onOpenInvoice?.(lastBill)}
              style={[
                styles.lastOrderCard,
                {
                  ...getGlass(colors.isDark).card,
                  borderColor: colors.accent,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>
                    {lastBill.invoice_number}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          lastBill.status === 'paid'
                            ? 'rgba(46, 204, 113, 0.15)'
                            : lastBill.status === 'partially_paid'
                            ? 'rgba(241, 196, 15, 0.15)'
                            : 'rgba(231, 76, 60, 0.15)',
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '700',
                        color:
                          lastBill.status === 'paid'
                            ? '#2ecc71'
                            : lastBill.status === 'partially_paid'
                            ? '#f1c40f'
                            : '#e74c3c',
                      }}
                    >
                      {lastBill.status.toUpperCase().replace('_', ' ')}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                    {inrFromMinor(lastBill.total_minor)}
                  </Text>
                  <ChevronRightIcon size={14} color={colors.accent} />
                </View>
              </View>

              <Text style={{ fontSize: 12, color: colors.textDim, marginBottom: 6 }} numberOfLines={1}>
                {lastBill.items?.map((it) => it.service_name_snapshot).filter(Boolean).join(', ') || 'Salon Services'}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, color: colors.textSubtle }}>
                  {lastBill.issued_at || (lastBill.created_at ? new Date(lastBill.created_at).toLocaleDateString('en-IN') : 'Recent')} · Stylist: {lastBill.staff_name}
                </Text>
                <Text style={{ fontSize: 11, color: colors.accent, fontWeight: '600' }}>
                  {t('viewInvoice', 'View invoice →')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ORDER HISTORY */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={[styles.sectionTitle, { color: colors.accent, marginBottom: 0 }]}>
            {t('orderHistory', 'ORDER HISTORY')}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textDim }}>
            {customerBills.length} {customerBills.length === 1 ? 'order' : 'orders'}
          </Text>
        </View>

        <View style={styles.visitsList}>
          {customerBills.length === 0 ? (
            <View style={{ paddingVertical: 14 }}>
              <Text style={{ color: colors.textDim, fontSize: 12.5 }}>
                No completed orders or bills on file yet.
              </Text>
            </View>
          ) : (
            customerBills.map((b) => {
              const rawDate = b.created_at || (b.issued_at && !b.issued_at.includes(':') ? b.issued_at : null);
              const d = rawDate ? new Date(rawDate) : new Date();
              const isValid = !isNaN(d.getTime());
              const dateStr = isValid
                ? `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`
                : 'Recent';
              const itemsSummary =
                b.items?.map((it) => it.service_name_snapshot).filter(Boolean).join(', ') ||
                'Salon Services';

              return (
                <TouchableOpacity
                  key={b.id}
                  activeOpacity={0.7}
                  onPress={() => onOpenInvoice?.(b)}
                  style={[
                    styles.historyRow,
                    {
                      borderBottomColor: colors.divider,
                      ...getGlass(colors.isDark).card,
                    },
                  ]}
                >
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.accent }}>
                        {b.invoice_number}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textDim }}>· {dateStr}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: colors.text }} numberOfLines={1}>
                      {itemsSummary}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.text }}>
                        {inrFromMinor(b.total_minor)}
                      </Text>
                      <ChevronRightIcon size={14} color={colors.textDim} />
                    </View>
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '600',
                        color:
                          b.status === 'paid'
                            ? '#2ecc71'
                            : b.status === 'partially_paid'
                            ? '#f1c40f'
                            : '#e74c3c',
                        marginTop: 2,
                      }}
                    >
                      {b.status === 'paid' ? 'Paid' : b.status === 'partially_paid' ? 'Partial' : 'Due'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Actions Row */}
        <View style={styles.actionsRow}>
          <Button
            label={t('newBill', 'New bill')}
            onPress={() => onStartBill(customer)}
            style={{ flex: 1 }}
          />
          <Button
            label={t('bookSlot', 'Book slot')}
            variant="secondary"
            onPress={() => onBookSlot(customer)}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            onPress={() => onWhatsApp(customer)}
            style={{ width: 44, height: 44, paddingHorizontal: 0 }}
          >
            <ChatIcon size={17} color={colors.text} />
          </Button>
        </View>
      </ScrollView>

      <CustomerManagerModal
        visible={isEditModalOpen}
        shopId={shopId || ''}
        customerToEdit={customer}
        onClose={() => setIsEditModalOpen(false)}
        onAddSuccess={() => {}}
        onBatchSuccess={() => {}}
        onEditSuccess={(updated) => {
          onUpdateCustomer?.(updated);
        }}
      />

      <SettleDueModal
        visible={isSettleModalOpen}
        customer={customer}
        onClose={() => setIsSettleModalOpen(false)}
        onConfirm={async (customerId, method, amountMinor) => {
          await onSettleDue?.(customerId, method, amountMinor);
          setIsSettleModalOpen(false);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginRight: 6,
  },
  deleteTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginRight: 6,
  },
  starButton: {
    padding: 6,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginTop: 16,
    marginBottom: 4,
  },
  avatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLargeText: {
    fontSize: 19,
    fontWeight: '500',
  },
  customerName: {
    fontSize: 21,
    fontWeight: '500',
  },
  customerPhone: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  phoneActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  headerActionBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    marginBottom: 16,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    padding: 10,
    borderRadius: radii.md,
  },
  statLabel: {
    fontSize: 9.5,
    letterSpacing: 0.9,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '500',
    marginTop: 3,
  },
  notesCard: {
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 14,
  },
  stylistLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  visitsList: {
    marginBottom: 18,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    gap: 10,
  },
  visitDate: {
    width: 48,
    fontSize: 11,
  },
  visitWhat: {
    flex: 1,
    fontSize: 13,
  },
  visitAmt: {
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  lastOrderCard: {
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderRadius: radii.sm,
    marginBottom: 6,
  },
});
