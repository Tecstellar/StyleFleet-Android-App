import React, { useState } from 'react';
import { openWhatsAppPreferred } from '../../services/whatsappLauncher';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Platform,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Chip } from '../../components/common/Chip';
import { StarIcon, PhoneCallIcon, WhatsAppIcon, SearchIcon, PlusIcon } from '../../components/common/SvgIcons';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { fmt } from '../../i18n/format';
import { getGlass } from '../../theme/glass';
import { Customer } from '../../types/domain';
import { inr, inrFromMinor, getInitials } from '../../utils/format';
import { CustomerManagerModal } from '../../components/customers/CustomerManagerModal';
import { SettleDueModal } from '../../components/customers/SettleDueModal';
import { customerRepository } from '../../repositories/customerRepository';
import { usePullRefresh } from '../../hooks/usePullRefresh';

interface CustomersScreenProps {
  onRefresh?: () => Promise<void>;
  customers: Customer[];
  shopId?: string;
  onSelectCustomer: (customer: Customer) => void;
  onToggleStar: (customerId: string) => void;
  onAddCustomer?: (customer: Customer) => void;
  onBatchAddCustomers?: (customers: Customer[]) => void;
  onUpdateCustomer?: (customer: Customer) => void;
  onSettleDue?: (customerId: string, method?: 'cash' | 'upi', amountMinor?: number) => void;
  /** Bulk import from phone contacts is for owners only. */
  allowContactImport?: boolean;
}

export const CustomersScreen = ({
  onRefresh,
  customers,
  shopId,
  onSelectCustomer,
  onToggleStar,
  onAddCustomer,
  onBatchAddCustomers,
  onUpdateCustomer,
  onSettleDue,
  allowContactImport = true,
}: CustomersScreenProps) => {
  const pullRefresh = usePullRefresh(onRefresh);
  const { colors } = useTheme();
  const glass = getGlass(colors.isDark);
  const { t } = useLanguage();
  const tf = (key: string, fallback: string, vars: Record<string, string | number> = {}) =>
    fmt(t(key, fallback), vars);

  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'All' | 'MVP ★' | 'Dues'>('All');
  const [modalVisible, setModalVisible] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [customerToSettle, setCustomerToSettle] = useState<Customer | null>(null);

  // Deduplicate customers by normalized 10-digit mobile number so duplicate records are never displayed
  const uniqueCustomers = React.useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      const cleanPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
      const key = cleanPhone.length === 10 ? cleanPhone : c.id;
      if (!map.has(key)) {
        map.set(key, { ...c, phone: cleanPhone.length === 10 ? cleanPhone : c.phone });
      } else {
        // Merge visits, spend, dues and flags
        const existing = map.get(key)!;
        existing.visits_count = Math.max(existing.visits_count || 0, c.visits_count || 0);
        existing.lifetime_spend_minor = Math.max(existing.lifetime_spend_minor || 0, c.lifetime_spend_minor || 0);
        existing.outstanding_due_minor = Math.max(existing.outstanding_due_minor || 0, c.outstanding_due_minor || 0);
        if (c.is_starred) existing.is_starred = true;
        if (c.notes && !existing.notes) existing.notes = c.notes;
        if (!existing.last_visit_date && c.last_visit_date) existing.last_visit_date = c.last_visit_date;
        if (!existing.due_start_date && c.due_start_date) existing.due_start_date = c.due_start_date;
      }
    }
    return Array.from(map.values());
  }, [customers]);

  // Frequent customers sorted by visits count
  const sortedCustomers = React.useMemo(() => {
    return [...uniqueCustomers].sort((a, b) => (b.visits_count || 0) - (a.visits_count || 0));
  }, [uniqueCustomers]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const sourceList = q ? uniqueCustomers : sortedCustomers;

    return sourceList.filter((c) => {
      // Deleted customers stay in the database (bills and revenue keep their history) but are never listed
      if (c.is_active === false) return false;
      if (q) {
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesPhone = c.phone.includes(q) || (qDigits.length >= 3 && c.phone.includes(qDigits));
        if (!matchesName && !matchesPhone) return false;
      }
      if (activeFilter === 'MVP ★') return c.is_starred;
      if (activeFilter === 'Dues') return c.outstanding_due_minor > 0;
      return true;
    });
  }, [uniqueCustomers, sortedCustomers, query, activeFilter]);

  const stats = React.useMemo(() => {
    const active = uniqueCustomers.filter((c) => c.is_active !== false);
    const withDues = active.filter((c) => c.outstanding_due_minor > 0);
    return {
      clients: active.length,
      mvps: active.filter((c) => c.is_starred).length,
      duesCount: withDues.length,
      duesMinor: withDues.reduce((sum, c) => sum + c.outstanding_due_minor, 0),
    };
  }, [uniqueCustomers]);

  const handleDeleteCustomer = (c: Customer) => {
    Alert.alert(
      t('cuDeleteTitle', 'Delete Customer'),
      tf('cuDeleteMsg', 'Delete "{name}"? They will be removed from your customer list. Their past bills, payments, dues and appointments stay saved, so your revenue and reports do not change.', { name: c.name }),
      [
        { text: t('cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('delete', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (shopId) {
                await customerRepository.setCustomerInactive(shopId, c.id, true);
              }
              onUpdateCustomer?.({ ...c, is_active: false });
            } catch (err: any) {
              Alert.alert(t('bkNotice', 'Notice'), err.message || t('cuDeleteFail', 'Could not delete customer. Please try again.'));
            }
          },
        },
      ]
    );
  };

  const handleOpenAddModal = () => {
    setCustomerToEdit(null);
    setModalVisible(true);
  };

  const handleOpenEditModal = (c: Customer) => {
    setCustomerToEdit(c);
    setModalVisible(true);
  };

  const handleCallCustomer = (rawPhone?: string) => {
    const clean = (rawPhone || '').replace(/\D/g, '').slice(-10);
    if (!clean || clean.length < 10) {
      Alert.alert(
        'Invalid Phone Number',
        'No valid 10-digit mobile number is registered for this customer.'
      );
      return;
    }
    const telUrl = `tel:${clean}`;
    Linking.openURL(telUrl).catch((err) => {
      console.warn('Could not open phone dialer:', err);
      Alert.alert(
        'Dialer Unavailable',
        `Unable to open phone dialer for +91 ${clean}.`
      );
    });
  };

  const handleWhatsAppCustomer = (rawPhone?: string, customerName?: string) => {
    const clean = (rawPhone || '').replace(/\D/g, '').slice(-10);
    if (!clean || clean.length < 10) {
      Alert.alert(
        'Invalid Phone Number',
        'No valid 10-digit mobile number is registered for this customer.'
      );
      return;
    }
    const greeting = customerName ? `Hello ${customerName}!` : 'Hello!';
    openWhatsAppPreferred(clean, greeting).catch((e: unknown) =>
      Alert.alert('WhatsApp Unavailable', e instanceof Error ? e.message : 'Could not open WhatsApp. Please ensure WhatsApp is installed on your device.')
    );
  };

  const renderCustomerItem = ({ item: c }: { item: Customer }) => {
    const hasDue = c.outstanding_due_minor > 0;
    const dueLabel = hasDue
      ? `${t('due', 'due')} ${inrFromMinor(c.outstanding_due_minor)}`
      : t('settled', 'settled');

    const cleanPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
    const formattedPhone = cleanPhone.length === 10
      ? `+91 ${cleanPhone.replace(/(\d{5})(\d{5})/, '$1 $2')}`
      : c.phone || t('cuNoPhone', 'No phone');

    return (
      <View
        style={[
          styles.customerCard,
          {
            backgroundColor: glass.card.backgroundColor,
            borderColor: c.is_starred ? colors.accent + '66' : glass.card.borderColor,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.customerRowMain}
          activeOpacity={0.7}
          onPress={() => onSelectCustomer(c)}
          onLongPress={() => handleDeleteCustomer(c)}
          delayLongPress={400}
        >
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: c.is_starred ? colors.accent800 : colors.neutral800,
                borderColor: c.is_starred ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text style={[styles.avatarText, { color: c.is_starred ? colors.accent100 : colors.neutral200 }]}>
              {getInitials(c.name)}
            </Text>
          </View>

          <View style={styles.customerDetails}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.customerName, { color: colors.text }]}>
                {c.name}
              </Text>
              <TouchableOpacity
                onPress={() => onToggleStar(c.id)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={c.is_starred ? 'Unstar customer' : 'Star customer'}
              >
                <StarIcon
                  size={15}
                  color={c.is_starred ? colors.accent : colors.textSubtle}
                  fill={c.is_starred ? colors.accent : 'none'}
                />
              </TouchableOpacity>
            </View>
            <Text numberOfLines={1} style={[styles.phoneText, { color: colors.textDim }]}>
              {formattedPhone}
            </Text>
            <Text numberOfLines={1} style={[styles.metaText, { color: colors.textSubtle }]}>
              {`${tf('cuVisits', '{n} visits', { n: c.visits_count })}${
                c.last_visit_date && !c.last_visit_date.includes('Invalid') && !c.last_visit_date.includes('NaN')
                  ? ` · ${tf('cuLast', 'last {d}', { d: c.last_visit_date })}`
                  : ''
              }`}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.spendText, { color: colors.text }]}>{inrFromMinor(c.lifetime_spend_minor)}</Text>
            {hasDue ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setCustomerToSettle(c)}
                style={[styles.settlePill, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.5)' }]}
              >
                <Text style={[styles.settlePillText, { color: '#F87171' }]}>
                  {t('cuSettle', 'Settle')} {inrFromMinor(c.outstanding_due_minor)}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.dueText, { color: '#10B981' }]}>✓ {dueLabel}</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Quick actions: star, call, WhatsApp */}
        <View style={styles.actionsColumn}>
          <TouchableOpacity
            onPress={() => handleCallCustomer(c.phone)}
            style={[styles.actionIconBtn, { backgroundColor: 'rgba(16, 185, 129, 0.14)', borderColor: 'rgba(16, 185, 129, 0.4)' }]}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel={`Call ${c.name}`}
          >
            <PhoneCallIcon size={13} color="#10B981" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleWhatsAppCustomer(c.phone, c.name)}
            style={[styles.actionIconBtn, { backgroundColor: 'rgba(37, 211, 102, 0.14)', borderColor: 'rgba(37, 211, 102, 0.4)' }]}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel={`WhatsApp ${c.name}`}
          >
            <WhatsAppIcon size={14} color="#25D366" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>{t('customers', 'Customers')}</Text>
            <Text style={[styles.countText, { color: colors.textDim }]}>
              {uniqueCustomers.length} {t('onFile', 'on file')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.accent }]}
            onPress={handleOpenAddModal}
            activeOpacity={0.8}
          >
            <PlusIcon size={14} color="#161826" />
            <Text style={styles.addButtonText}>{t('add', 'Add').replace(/^\+\s*/, '')}</Text>
          </TouchableOpacity>
        </View>

        {/* Live summary computed from the customer list */}
        <View style={styles.statsRow}>
          <View style={[styles.statTile, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.text }]}>{stats.clients}</Text>
            <Text style={[styles.statLabel, { color: colors.textDim }]} numberOfLines={1}>{t('cuClients', 'CLIENTS')}</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: colors.accent }]}>★ {stats.mvps}</Text>
            <Text style={[styles.statLabel, { color: colors.textDim }]} numberOfLines={1}>{t('cuMvps', 'MVPs')}</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setActiveFilter('Dues')}
            style={[
              styles.statTile,
              {
                backgroundColor: stats.duesMinor > 0 ? 'rgba(239, 68, 68, 0.10)' : glass.card.backgroundColor,
                borderColor: stats.duesMinor > 0 ? 'rgba(239, 68, 68, 0.45)' : glass.card.borderColor,
              },
            ]}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: stats.duesMinor > 0 ? '#F87171' : colors.text }]}>
              {inrFromMinor(stats.duesMinor)}
            </Text>
            <Text numberOfLines={1} style={[styles.statLabel, { color: colors.textDim }]}>
              {t('cuDues', 'DUES')}{stats.duesCount > 0 ? ` · ${stats.duesCount}` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor },
          ]}
        >
          <SearchIcon size={16} color={colors.textDim} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t('searchNameOrNumber', 'Search name or number')}
            placeholderTextColor={colors.placeholder || colors.textDim}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.textDim }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filtersRow}>
          {(['All', 'MVP ★', 'Dues'] as const).map((filter) => (
            <Chip
              key={filter}
              label={
                filter === 'All'
                  ? t('all', 'All')
                  : filter === 'MVP ★'
                  ? t('mvp', 'MVP ★')
                  : t('dues', 'Dues')
              }
              active={activeFilter === filter}
              onPress={() => setActiveFilter(filter)}
            />
          ))}
        </View>
      </View>

      <FlatList
        refreshControl={pullRefresh}
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderCustomerItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        maxToRenderPerBatch={25}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {query ? t('noCustomersFound', 'No customers matching search') : t('noCustomersOnFile', 'No customers on file')}
            </Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              {query
                ? 'Try searching with a different name or phone number.'
                : t('tapAddHint', "Tap '+ Add' in the top right to register your salon clients.")}
            </Text>
          </View>
        }
      />

      <CustomerManagerModal
        visible={modalVisible}
        shopId={shopId || ''}
        customerToEdit={customerToEdit}
        existingCustomers={uniqueCustomers}
        onClose={() => setModalVisible(false)}
        onAddSuccess={(newCust) => onAddCustomer?.(newCust)}
        onBatchSuccess={(newCusts) => onBatchAddCustomers?.(newCusts)}
        onEditSuccess={(updated) => onUpdateCustomer?.(updated)}
        allowContactImport={allowContactImport}
      />

      <SettleDueModal
        visible={!!customerToSettle}
        customer={customerToSettle}
        onClose={() => setCustomerToSettle(null)}
        onConfirm={async (customerId, method, amountMinor) => {
          await onSettleDue?.(customerId, method, amountMinor);
          setCustomerToSettle(null);
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
    paddingBottom: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  countText: {
    fontSize: 12.5,
    marginTop: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    minHeight: 38,
    borderRadius: 19,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#161826',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 100,
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  mvpPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
  customerRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '600',
  },
  customerDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  customerName: {
    fontSize: 14.5,
    fontWeight: '600',
    flexShrink: 1,
  },
  badge: {
    fontSize: 11,
    fontWeight: '600',
  },
  phoneText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
    letterSpacing: 0.2,
  },
  metaText: {
    fontSize: 11.5,
    marginTop: 1,
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 6,
  },
  spendColumn: {
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  spendText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dueText: {
    fontSize: 12,
    fontWeight: '600',
  },
  starButton: {
    padding: 6,
  },
  actionsColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  actionIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: {
    padding: 6,
  },
  settlePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 9,
    borderWidth: 1,
  },
  settlePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bottomHint: {
    paddingTop: 18,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
  },
});
