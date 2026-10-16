import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { fmt } from '../../i18n/format';
import { radii } from '../../theme/spacing';
import { getInitials } from '../../utils/format';
import { StaffMember, StylistPermissions, DEFAULT_STYLIST_PERMISSIONS } from '../../types/domain';
import {
  PERMISSION_GROUPS,
  MODULE_KEYS,
  PERMISSION_KEYS,
  PermissionKey,
  SENSITIVE_PERMISSIONS,
  countAllowed,
  resolvePermissions,
  samePermissions,
} from '../../utils/stylistAccess';

interface StylistPermissionsModalProps {
  staff: StaffMember | null;
  onClose: () => void;
  onSave: (staffId: string, permissions: StylistPermissions) => Promise<void>;
}

const LABELS: Record<PermissionKey, { label: string; sub: string; labelFallback: string; subFallback: string }> = {
  customers: { label: 'spCustomers', sub: 'spCustomersSub', labelFallback: 'Customers', subFallback: 'See the customer list, history and dues' },
  sales: { label: 'spSales', sub: 'spSalesSub', labelFallback: 'Sales & billing', subFallback: 'Create bills and view invoices' },
  appointments: { label: 'spAppointments', sub: 'spAppointmentsSub', labelFallback: 'Appointments', subFallback: 'See the schedule and book clients' },
  reminders: { label: 'spReminders', sub: 'spRemindersSub', labelFallback: 'Reminders & WhatsApp', subFallback: 'Send reminders and offers' },
  expenses: { label: 'spExpenses', sub: 'spExpensesSub', labelFallback: 'Expenses', subFallback: 'Add and view shop expenses' },
  reports: { label: 'spReports', sub: 'spReportsSub', labelFallback: 'Reports', subFallback: 'View business reports and totals' },
  team: { label: 'spTeam', sub: 'spTeamSub', labelFallback: 'Team', subFallback: 'Manage stylists and invites' },
  profile: { label: 'spProfile', sub: 'spProfileSub', labelFallback: 'Shop profile', subFallback: 'Edit shop details and settings' },
  expensesHistory: { label: 'spExpensesHistory', sub: 'spExpensesHistorySub', labelFallback: 'Past expenses', subFallback: 'Needs Expenses. Off: only expenses from today are shown' },
  reportsHistory: { label: 'spReportsHistory', sub: 'spReportsHistorySub', labelFallback: 'Full reports', subFallback: 'Needs Reports. Off: only their own sales from today are shown' },
  shareBills: { label: 'spShareBills', sub: 'spShareBillsSub', labelFallback: 'Share bills', subFallback: 'Send bills to customers on WhatsApp or as PDF' },
};

const ALL_ON = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as unknown as StylistPermissions;
const ALL_OFF = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as unknown as StylistPermissions;

export const StylistPermissionsModal = ({ staff, onClose, onSave }: StylistPermissionsModalProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const glass = getGlass(colors.isDark);

  const saved = useMemo(() => resolvePermissions(staff?.permissions), [staff]);
  const [draft, setDraft] = useState<StylistPermissions>(saved);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const allowed = countAllowed(draft);
  const total = MODULE_KEYS.length;
  const changed = !samePermissions(draft, saved);

  const toggle = (key: PermissionKey) => setDraft((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    if (!staff || isSaving || !changed) return;
    setIsSaving(true);
    try {
      await onSave(staff.id, draft);
      onClose();
      Alert.alert(t('spSavedTitle', 'Access updated'), fmt(t('spSavedMsg', '{name} access has been saved.'), { name: staff.name }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      Alert.alert(t('spSaveFailed', 'Could not save access'), message);
    } finally {
      setIsSaving(false);
    }
  };

  const chip = (label: string, onPress: () => void, active: boolean) => (
    <TouchableOpacity
      key={label}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={isSaving}
      style={[
        styles.chip,
        glass.inset,
        { borderWidth: 1 },
        active && { borderColor: colors.accent },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.accent : colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={!!staff} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={isSaving ? undefined : onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
          <View style={[styles.grabber, { backgroundColor: colors.divider }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: colors.accent + '24', borderColor: colors.accent + '66' }]}>
              <Text style={[styles.avatarText, { color: colors.accent }]}>{getInitials(staff?.name || '')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {t('spTitle', 'Stylist Access')}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textDim }]} numberOfLines={1}>
                {staff?.name} {'·'} {staff?.role || 'Stylist'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ color: colors.textDim, fontSize: 18, fontWeight: '700' }}>{'✕'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            {/* Summary + quick presets */}
            <View style={[styles.summary, glass.inset, { borderWidth: 1 }]}>
              <View style={styles.summaryTop}>
                <Text style={[styles.summaryCount, { color: colors.text }]}>
                  {fmt(t('spAllowedCount', '{n} of {total} allowed'), { n: allowed, total })}
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.divider }]}>
                <View style={[styles.trackFill, { width: `${(allowed / total) * 100}%`, backgroundColor: colors.accent }]} />
              </View>
              <View style={styles.chipRow}>
                {chip(t('spAllowAll', 'Allow all'), () => setDraft(ALL_ON), samePermissions(draft, ALL_ON))}
                {chip(t('spBlockAll', 'Block all'), () => setDraft(ALL_OFF), samePermissions(draft, ALL_OFF))}
                {chip(t('spDefault', 'Default'), () => setDraft(DEFAULT_STYLIST_PERMISSIONS), samePermissions(draft, DEFAULT_STYLIST_PERMISSIONS))}
              </View>
            </View>

            <Text style={[styles.intro, { color: colors.textMuted }]}>
              {fmt(t('spIntro', 'Choose what {name} can open in the app. Changes apply when they next open StyleFleet.'), {
                name: staff?.name || '',
              })}
            </Text>

            {PERMISSION_GROUPS.map((group) => (
              <View key={group.titleKey} style={{ marginTop: 6 }}>
                <Text style={[styles.groupTitle, { color: colors.textDim }]}>
                  {t(group.titleKey, group.titleFallback)}
                </Text>
                {group.keys.map((key) => {
                  const on = draft[key] === true;
                  const meta = LABELS[key];
                  const sensitive = SENSITIVE_PERMISSIONS.includes(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      activeOpacity={0.85}
                      onPress={() => toggle(key)}
                      disabled={isSaving}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={t(meta.label, meta.labelFallback)}
                      style={[
                        styles.row,
                        glass.card,
                        { borderWidth: 1 },
                        on && { borderColor: colors.accent + '88' },
                      ]}
                    >
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <View style={styles.rowTitleLine}>
                          <Text style={[styles.rowLabel, { color: colors.text }]}>
                            {t(meta.label, meta.labelFallback)}
                          </Text>
                          {sensitive && (
                            <View style={styles.sensitiveBadge}>
                              <Text style={styles.sensitiveText}>{t('spSensitive', 'Sensitive')}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.rowSub, { color: colors.textDim }]}>
                          {t(meta.sub, meta.subFallback)}
                        </Text>
                      </View>
                      <View style={styles.switchWrap}>
                        <View
                          style={[
                            styles.switchTrack,
                            glass.inset,
                            { borderWidth: 1 },
                            on && { backgroundColor: colors.accent, borderColor: colors.accent },
                          ]}
                        >
                          <View
                            style={[
                              styles.switchKnob,
                              { backgroundColor: on ? '#0D0E11' : colors.textDim },
                              on ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
                            ]}
                          />
                        </View>
                        <Text style={[styles.switchState, { color: on ? colors.accent : colors.textDim }]}>
                          {on ? t('spAllowed', 'Allowed') : t('spBlocked', 'Blocked')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          {/* Footer: solid, pinned */}
          <View style={[styles.footer, { borderTopColor: colors.divider }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isSaving}
              activeOpacity={0.8}
              style={[styles.cancelBtn, { borderColor: colors.divider }]}
            >
              <Text style={{ color: colors.textDim, fontWeight: '600' }}>{t('cancel', 'Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={!changed || isSaving}
              activeOpacity={0.85}
              style={[
                styles.saveBtn,
                { backgroundColor: colors.accent, opacity: !changed && !isSaving ? 0.45 : 1 },
              ]}
            >
              {isSaving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator color="#0D0E11" size="small" />
                  <Text style={styles.saveText}>{t('spSaving', 'Saving...')}</Text>
                </View>
              ) : (
                <Text style={styles.saveText} numberOfLines={1}>
                  {changed ? t('spSave', 'Save access') : t('spUnchanged', 'No changes yet')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 1 },
  summary: { borderRadius: radii.md, padding: 12 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  summaryCount: { fontSize: 13.5, fontWeight: '700' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: 3 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { flex: 1, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center' },
  chipText: { fontSize: 12, fontWeight: '700' },
  intro: { fontSize: 12, lineHeight: 17, marginTop: 10, marginBottom: 4 },
  groupTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowLabel: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  sensitiveBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(245, 158, 11, 0.16)' },
  sensitiveText: { fontSize: 9.5, fontWeight: '800', color: '#F59E0B', textTransform: 'uppercase' },
  switchWrap: { alignItems: 'center', gap: 3, minWidth: 58 },
  switchTrack: { width: 46, height: 26, borderRadius: 13, padding: 2, justifyContent: 'center' },
  switchKnob: { width: 20, height: 20, borderRadius: 10 },
  switchState: { fontSize: 10, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, marginTop: 4 },
  cancelBtn: { flex: 1, height: 46, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flex: 2, height: 46, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  saveText: { color: '#0D0E11', fontWeight: '800', fontSize: 14 },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
