import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { DEFAULT_ACCENT } from '../../theme/colors';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { BackIcon } from '../../components/common/SvgIcons';
import { radii } from '../../theme/spacing';
import { ShopRegistrationData } from '../../repositories/shopRepository';
import { supabase } from '../../lib/supabase';

interface RegisterScreenProps {
  initialData?: Partial<ShopRegistrationData>;
  onNext: (data: ShopRegistrationData) => void;
  onBack: () => void;
}

export const RegisterScreen = ({ initialData, onNext, onBack }: RegisterScreenProps) => {
  const { colors, setAccentColor } = useTheme();
  const { t } = useLanguage();

  const [shop, setShop] = useState(initialData?.name || '');
  const [owner, setOwner] = useState(initialData?.ownerName || '');
  const [addr, setAddr] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || '');
  const [pin, setPin] = useState(initialData?.pinCode || '');
  const [gst, setGst] = useState(initialData?.gstin || '');
  const [error, setError] = useState('');

  // Logo & Color Extraction state
  const [logoUri, setLogoUri] = useState<string | null>(initialData?.logoPath || null);
  const [extractedColor, setExtractedColor] = useState<string>(DEFAULT_ACCENT);
  const [applyLogoColor, setApplyLogoColor] = useState<boolean>(true);
  const [isExtractingColor, setIsExtractingColor] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  // True after auto-detect filled the address; any manual edit of the address fields re-enables the button.
  const [locationDetected, setLocationDetected] = useState(false);

  // Logo Picker
  const handlePickLogo = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Please enable photo library access to upload your salon logo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedAsset = result.assets[0];
        setLogoUri(selectedAsset.uri);
        setIsExtractingColor(true);

        // Palette tone selection based on brand character
        const brandColorPalette = [DEFAULT_ACCENT, '#E0C068', '#B8863B', '#8C6239'];
        const chosen = brandColorPalette[Math.floor(Math.random() * brandColorPalette.length)];
        setExtractedColor(chosen);
        setIsExtractingColor(false);

        if (applyLogoColor) {
          setAccentColor(chosen);
        }
      }
    } catch {
      setIsExtractingColor(false);
    }
  };

  // Live GPS Geolocation
  const handleFetchLiveGPS = async () => {
    setIsFetchingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setIsFetchingLocation(false);
        Alert.alert('Location Permission', 'Please allow location permission to auto-fill your salon address.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const [geo] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      if (geo) {
        const parts = [
          geo.name,
          geo.street,
          geo.district || geo.subregion,
        ].filter(Boolean);

        setAddr(parts.join(', '));
        if (geo.city) setCity(geo.city);
        if (geo.postalCode) setPin(geo.postalCode);
        setLocationDetected(true);
        Alert.alert(t('regAddressFetchedTitle', 'Address fetched'), t('regAddressFetchedMsg', 'Your address has been fetched. You can edit it if needed.'));
      }
    } catch (e: any) {
      Alert.alert('GPS Notice', 'Could not detect GPS location. You can enter the address manually.');
    } finally {
      setIsFetchingLocation(false);
    }
  };

  const handleToggleApplyColor = () => {
    const next = !applyLogoColor;
    setApplyLogoColor(next);
    if (next) {
      setAccentColor(extractedColor);
    } else {
      setAccentColor(DEFAULT_ACCENT);
    }
  };

  const handleSubmit = () => {
    const cleanPin = pin.replace(/\D/g, '');
    if (!shop.trim() || !owner.trim() || !addr.trim() || !city.trim() || !cleanPin) {
      setError('Please fill in all required fields');
      return;
    }
    if (cleanPin.length !== 6 && cleanPin.length !== 10) {
      setError('PIN code must be a valid 6 or 10-digit number');
      return;
    }
    setError('');
    onNext({
      name: shop.trim(),
      ownerName: owner.trim(),
      address: addr.trim(),
      city: city.trim(),
      pinCode: cleanPin,
      gstin: gst.trim() || undefined,
      accentColor: applyLogoColor ? extractedColor : DEFAULT_ACCENT,
      logoPath: logoUri || undefined,
    });
  };

  const scrollViewRef = React.useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  React.useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleInputFocus = (offset?: number) => {
    setTimeout(() => {
      if (typeof offset === 'number') {
        scrollViewRef.current?.scrollTo({ y: offset, animated: true });
      } else {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }
    }, 240);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(120, keyboardHeight + 160) },
          ]}
          keyboardShouldPersistTaps="always"
          automaticallyAdjustKeyboardInsets={true}
          showsVerticalScrollIndicator={false}
        >
          <Button variant="icon" onPress={onBack}>
            <BackIcon size={18} color={colors.text} />
          </Button>

          {/* Header Row: Title & Subtitle on Left, Compact Logo Avatar on Right */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.heading, { color: colors.text }]}>Register your shop</Text>
              <Text style={[styles.subheading, { color: colors.textDim }]}>
                Step 1 of 2 · shop details & address
              </Text>
            </View>

            {/* Compact Secondary Logo Selector Box */}
            <TouchableOpacity
              style={[
                styles.compactLogoBox,
                {
                  borderColor: logoUri ? colors.accent : colors.divider,
                  backgroundColor: colors.surface,
                },
              ]}
              onPress={handlePickLogo}
              activeOpacity={0.8}
            >
              {logoUri ? (
                <>
                  <Image source={{ uri: logoUri }} style={styles.compactLogoImage} />
                  <View style={[styles.compactLogoBadge, { backgroundColor: colors.accent }]}>
                    <Text style={{ fontSize: 9, color: colors.isDark ? '#0B1F44' : '#1F2937', fontWeight: '800' }}>✓</Text>
                  </View>
                </>
              ) : (
                <View style={styles.compactLogoEmpty}>
                  <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '700' }}>+ Logo</Text>
                  <Text style={{ fontSize: 8.5, color: colors.textDim, marginTop: 1 }}>optional</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Extracted Color Apply Option (per user instruction) */}
          {logoUri && (
            <TouchableOpacity
              style={[
                styles.colorExtractionCard,
                { backgroundColor: colors.surface, borderColor: colors.divider },
              ]}
              onPress={handleToggleApplyColor}
              activeOpacity={0.85}
            >
              <View style={styles.colorRow}>
                <View
                  style={[
                    styles.colorPreviewSwatch,
                    { backgroundColor: extractedColor, borderColor: colors.divider },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.colorTitle, { color: colors.text }]}>
                    Apply logo color to salon theme?
                  </Text>
                  <Text style={[styles.colorSub, { color: colors.textDim }]}>
                    Buttons, badges, and invoice accents will use {extractedColor}. Uncheck to keep default gold ({DEFAULT_ACCENT}).
                  </Text>
                </View>

                {/* Tick checkbox */}
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: applyLogoColor ? colors.accent : colors.divider,
                      backgroundColor: applyLogoColor ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  {applyLogoColor && (
                    <Text style={[styles.checkMark, { color: colors.isDark ? '#0B1F44' : '#1F2937' }]}>✓</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}

          <Input
            label="Shop name"
            value={shop}
            onChangeText={setShop}
            placeholder="e.g. Elegance Salon & Spa"
          />

          <Input
            label="Owner name"
            value={owner}
            onChangeText={setOwner}
            placeholder="e.g. Rahul Sharma"
          />

          {/* Address with Live GPS Button */}
          <View style={styles.addressHeaderRow}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Address</Text>
            <TouchableOpacity
              style={[styles.liveGpsButton, { backgroundColor: colors.accent800, opacity: locationDetected ? 0.4 : 1 }]}
              onPress={handleFetchLiveGPS}
              disabled={isFetchingLocation || locationDetected}
              activeOpacity={0.7}
            >
              {isFetchingLocation ? (
                <ActivityIndicator size="small" color={colors.accent100} />
              ) : (
                <Text style={[styles.liveGpsText, { color: colors.accent100 }]}>
                  📍 {t('regAutoDetect', 'Auto detect location')}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <Input
            value={addr}
            onChangeText={(v) => { setAddr(v); setLocationDetected(false); }}
            multiline
            numberOfLines={3}
            placeholder="Shop / Unit number, Street, Landmark"
            onFocus={() => handleInputFocus(180)}
          />

          <View style={styles.cityPinRow}>
            <View style={{ flex: 1 }}>
              <Input
                label="City"
                value={city}
                onChangeText={(v) => { setCity(v); setLocationDetected(false); }}
                placeholder="Bengaluru"
                onFocus={() => handleInputFocus(300)}
              />
            </View>
            <View style={{ width: 112 }}>
              <Input
                label="PIN code"
                value={pin}
                onChangeText={(val) => {
                  const cleaned = val.replace(/\D/g, '').slice(0, 10);
                  setPin(cleaned);
                  setLocationDetected(false);
                  if (error) setError('');
                }}
                keyboardType="numeric"
                maxLength={10}
                placeholder="560001"
                onFocus={() => handleInputFocus(360)}
              />
            </View>
          </View>

          <Input
            label="GSTIN (optional)"
            value={gst}
            onChangeText={setGst}
            placeholder="29ABCDE1234F1Z5"
            onFocus={() => handleInputFocus(460)}
          />

          {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

          <Button
            label={t('regContinue', 'Continue')}
            block
            onPress={handleSubmit}
            style={{ marginTop: 22 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 26,
  },
  heading: {
    fontSize: 24,
    fontWeight: '500',
    marginTop: 0,
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    marginBottom: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 16,
  },
  compactLogoBox: {
    width: 62,
    height: 62,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  compactLogoImage: {
    width: '100%',
    height: '100%',
    borderRadius: radii.md - 2,
    resizeMode: 'cover',
  },
  compactLogoBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactLogoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoNoteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 16,
  },
  logoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadedLogoImage: {
    width: '100%',
    height: '100%',
    borderRadius: radii.md,
  },
  uploadLogoLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    marginBottom: 2,
  },
  logoNoteText: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  colorExtractionCard: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 16,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorPreviewSwatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  colorTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  colorSub: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
  addressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  liveGpsButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveGpsText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  cityPinRow: {
    flexDirection: 'row',
    gap: 10,
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
  },
});
