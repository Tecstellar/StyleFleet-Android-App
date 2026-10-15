import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { otaUpdateService, OtaState } from '../../services/otaUpdateService';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { SparklesIcon, CrossIcon } from './SvgIcons';

export const OtaUpdateCard: React.FC = () => {
  const [updateState, setUpdateState] = useState<OtaState>({
    isChecking: false,
    isDownloading: false,
    isUpdateReady: false,
    error: null,
  });
  const [isApplying, setIsApplying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { colors } = useTheme();
  const { t } = useLanguage();

  useEffect(() => {
    const unsubscribe = otaUpdateService.subscribe(setUpdateState);
    otaUpdateService.checkForUpdates();
    return unsubscribe;
  }, []);

  // Whenever a new update finishes downloading and is ready, ensure modal shows
  useEffect(() => {
    if (updateState.isUpdateReady) {
      setIsDismissed(false);
    }
  }, [updateState.isUpdateReady]);

  // Only render when an update is downloaded and ready, or actively downloading
  if ((!updateState.isUpdateReady && !updateState.isDownloading) || isDismissed) {
    return null;
  }

  const handleUpdatePress = async () => {
    setIsApplying(true);
    await otaUpdateService.applyUpdateAndReload();
  };

  const accentColor = colors.accent || '#D9A441';
  const isDark = colors.isDark;

  return (
    <Modal
      transparent
      visible={true}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setIsDismissed(true)}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#141C2E' : '#FFFFFF',
              borderColor: 'rgba(217, 164, 65, 0.45)',
            },
          ]}
        >
          {/* Top-right close button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setIsDismissed(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.closeBtn,
              { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
            ]}
          >
            <CrossIcon size={13} color={isDark ? '#94A3B8' : '#64748B'} strokeWidth={2.2} />
          </TouchableOpacity>

          {/* Glowing central icon badge */}
          <View style={[styles.iconBadge, { borderColor: 'rgba(217, 164, 65, 0.4)' }]}>
            <SparklesIcon size={26} color={accentColor} strokeWidth={2} />
          </View>

          {/* Mini pill tag */}
          <View style={styles.tagPill}>
            <Text style={[styles.tagText, { color: accentColor }]}>
              {t('otaUpdateTag', 'STYLEFLEET UPDATE')}
            </Text>
          </View>

          {/* Main title */}
          <Text style={[styles.title, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
            {t('otaUpdateForYou', 'A little update for you')}
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            {updateState.isDownloading
              ? t('otaDownloading', 'Downloading update in background…')
              : t('otaUpdatePrompt', 'Please update to continue')}
          </Text>

          {/* Primary Action Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={updateState.isDownloading || isApplying}
            onPress={handleUpdatePress}
            style={[
              styles.updateBtn,
              {
                backgroundColor: accentColor,
                opacity: updateState.isDownloading || isApplying ? 0.75 : 1,
              },
            ]}
          >
            {isApplying || updateState.isDownloading ? (
              <View style={styles.btnLoadingRow}>
                <ActivityIndicator size="small" color="#161826" />
                <Text style={styles.updateBtnText}>
                  {isApplying
                    ? t('otaApplying', 'Applying update…')
                    : t('otaDownloadingShort', 'Downloading…')}
                </Text>
              </View>
            ) : (
              <Text style={styles.updateBtnText}>
                {t('otaUpdateNow', 'Update Now')}
              </Text>
            )}
          </TouchableOpacity>

          {/* Secondary 'Remind me later' link */}
          {!isApplying && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setIsDismissed(true)}
              style={styles.laterBtn}
            >
              <Text style={[styles.laterText, { color: isDark ? '#64748B' : '#94A3B8' }]}>
                {t('otaRemindLater', 'Remind me later')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 16, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1.5,
    shadowColor: '#D9A441',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 18,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(217, 164, 65, 0.14)',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tagPill: {
    backgroundColor: 'rgba(217, 164, 65, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 10,
    marginBottom: 10,
  },
  tagText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  updateBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    shadowColor: '#D9A441',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateBtnText: {
    color: '#161826',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  laterBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  laterText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
});

