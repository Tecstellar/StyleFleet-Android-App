import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Modal } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { getGlass } from '../../theme/glass';
import { radii } from '../../theme/spacing';
import { InstalledWhatsAppApp } from '../../services/whatsappLauncher';

import { WhatsAppBrandIcon, WhatsAppBusinessBrandIcon } from './SvgIcons';

interface WhatsAppAppPickerModalProps {
  visible: boolean;
  apps: InstalledWhatsAppApp[];
  onSelect: (app: InstalledWhatsAppApp) => void;
  onCancel: () => void;
}

/** Shown when WhatsApp and WhatsApp Business options are available. */
export const WhatsAppAppPickerModal = ({ visible, apps, onSelect, onCancel }: WhatsAppAppPickerModalProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const glass = getGlass(colors.isDark);

  // If empty, present both standard apps as options
  const displayApps: InstalledWhatsAppApp[] =
    apps && apps.length > 0
      ? apps
      : [
          { id: 'whatsapp', label: 'WhatsApp', packageName: 'com.whatsapp', iconBase64: null },
          { id: 'business', label: 'WhatsApp Business', packageName: 'com.whatsapp.w4b', iconBase64: null },
        ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
          <View style={[styles.grabber, { backgroundColor: colors.divider }]} />
          <Text style={[styles.title, { color: colors.text }]}>{t('waPickTitle', 'Send bill with')}</Text>
          <Text style={[styles.sub, { color: colors.textDim }]}>
            {t('waPickSub', 'Choose which WhatsApp account to open and send this bill:')}
          </Text>

          {displayApps.map((app) => (
            <TouchableOpacity
              key={app.id}
              activeOpacity={0.85}
              onPress={() => onSelect(app)}
              accessibilityRole="button"
              accessibilityLabel={app.label}
              style={[styles.row, glass.card, { borderWidth: 1 }]}
            >
              {app.id === 'business' ? (
                <WhatsAppBusinessBrandIcon size={44} />
              ) : (
                <WhatsAppBrandIcon size={44} />
              )}
              <View style={{ flex: 1, marginLeft: 2 }}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{app.label}</Text>
                <Text style={[styles.rowSub, { color: colors.textDim }]}>
                  {app.id === 'business'
                    ? t('waBusinessSub', 'Business account')
                    : t('waPersonalSub', 'Personal account')}
                </Text>
              </View>
              <Text style={{ fontSize: 18, color: colors.accent, fontWeight: '700' }}>→</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.8}
            style={[styles.cancel, { borderColor: colors.divider }]}
          >
            <Text style={{ color: colors.textDim, fontWeight: '600' }}>{t('cancel', 'Cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 22,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 12.5, lineHeight: 18, marginTop: 4, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12, marginBottom: 10 },
  icon: { width: 44, height: 44, borderRadius: 12 },
  iconFallback: { alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 1 },
  cancel: { height: 46, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
