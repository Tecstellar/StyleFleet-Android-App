import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  Image,
  Platform,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import { BackIcon, ChatIcon, EditIcon, TrashIcon, WhatsAppIcon } from '../../components/common/SvgIcons';
import { Bill, SocialLinks } from '../../types/domain';
import { inrFromMinor, getInitials } from '../../utils/format';
import { radii } from '../../theme/spacing';
import { generateInvoiceHtml } from '../../utils/invoicePdf';
import { pdfStorageService } from '../../services/pdfStorageService';
import {
  InstalledWhatsAppApp,
  getInstalledWhatsAppApps,
  openWhatsAppChat,
  whatsAppChoiceFor,
} from '../../services/whatsappLauncher';
import { WhatsAppAppPickerModal } from '../../components/common/WhatsAppAppPickerModal';
import { buildWhatsAppBillMessage } from '../../utils/whatsappFormatter';
import { shopRepository } from '../../repositories/shopRepository';

interface InvoiceScreenProps {
  bill: Bill;
  shopName: string;
  shopId?: string;
  shopAddress?: string;
  shopPhone?: string | null;
  shopGstin?: string;
  shopLogoUrl?: string | null;
  customerPhone?: string | null;
  socialLinks?: SocialLinks | null;
  shopUpiId?: string | null;
  userRole?: string;
  isStylist?: boolean;
  /** Owner switch: may this user send the bill (WhatsApp / PDF)? Defaults to the old rule: owners yes, stylists no. */
  canShareBills?: boolean;
  onSaveUpiId?: (upiId: string) => Promise<void>;
  onBack: () => void;
  onSendWhatsApp?: (bill: Bill) => void;
  onEditBill?: (bill: Bill) => void;
  onDeleteBill?: (billId: string) => Promise<void>;
  onRestoreBill?: (billId: string) => Promise<void>;
}

export const InvoiceScreen = ({
  bill,
  shopName,
  shopId,
  shopAddress = 'Premium Salon & Spa',
  shopPhone,
  shopGstin,
  shopLogoUrl,
  customerPhone,
  socialLinks,
  shopUpiId,
  userRole,
  isStylist,
  canShareBills,
  onSaveUpiId,
  onBack,
  onSendWhatsApp,
  onEditBill,
  onDeleteBill,
  onRestoreBill,
}: InvoiceScreenProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const allowShare = canShareBills ?? !(isStylist || userRole === 'stylist');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [pendingWhatsApp, setPendingWhatsApp] = useState<{
    phone: string;
    message: string;
    apps: InstalledWhatsAppApp[];
  } | null>(null);
  const [logoError, setLogoError] = useState(false);

  // Phone state and modal
  const [activeCustomerPhone, setActiveCustomerPhone] = useState(
    customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : ''
  );
  const [phoneModalVisible, setPhoneModalVisible] = useState(false);
  const [inputPhone, setInputPhone] = useState('');

  // UPI ID state & modal for partially paid bills
  const [currentUpiId, setCurrentUpiId] = useState<string>(shopUpiId || '');
  const [showUpiModal, setShowUpiModal] = useState<boolean>(false);
  const [upiInput, setUpiInput] = useState<string>('');
  const [isSavingUpi, setIsSavingUpi] = useState<boolean>(false);

  useEffect(() => {
    if (shopUpiId) {
      setCurrentUpiId(shopUpiId);
    }
  }, [shopUpiId]);

  // Determine financial breakdown
  const isPartiallyPaid = bill.status === 'partially_paid';
  const isPending = bill.status === 'pending';

  let paidMinor = bill.paid_amount_minor;
  let dueMinor = bill.due_amount_minor;

  if (paidMinor === undefined || dueMinor === undefined) {
    if (bill.notes && bill.notes.includes('due:')) {
      const dueMatch = bill.notes.match(/due:(\d+)/);
      const paidMatch = bill.notes.match(/paid:(\d+)/);
      if (dueMatch) dueMinor = parseInt(dueMatch[1], 10);
      if (paidMatch) paidMinor = parseInt(paidMatch[1], 10);
    }
  }

  if (isPending) {
    paidMinor = 0;
    dueMinor = dueMinor ?? bill.total_minor;
  } else if (isPartiallyPaid) {
    dueMinor = dueMinor ?? 0;
    paidMinor = paidMinor ?? Math.max(0, bill.total_minor - dueMinor);
  } else {
    paidMinor = paidMinor ?? bill.total_minor;
    dueMinor = 0;
  }

  // Helper to generate the PDF file with base64 logo support
  const getSafeLogoForPdf = async (): Promise<string | null> => {
    if (!shopLogoUrl) return null;
    if (shopLogoUrl.startsWith('http') || shopLogoUrl.startsWith('data:')) {
      return shopLogoUrl;
    }
    if (shopLogoUrl.startsWith('file:') || shopLogoUrl.startsWith('content:')) {
      try {
        const info = await FileSystem.getInfoAsync(shopLogoUrl);
        if (!info.exists) {
          return null;
        }
        const b64 = await FileSystem.readAsStringAsync(shopLogoUrl, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!b64) return null;
        const mime = shopLogoUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        return `data:${mime};base64,${b64}`;
      } catch {
        // File may have been purged from cache, fallback to null
        return null;
      }
    }
    return null;
  };

  const generatePdfFile = async () => {
    const safeLogo = await getSafeLogoForPdf();

    const html = generateInvoiceHtml({
      bill,
      shopName,
      shopAddress,
      shopPhone,
      shopEmail: (socialLinks as any)?.email,
      shopGstin,
      shopLogoUrl: safeLogo,
      customerPhone: activeCustomerPhone || undefined,
    });

    return await Print.printToFileAsync({ html, base64: true });
  };

  // Pre-warm PDF generation & Supabase Storage upload in background for zero-wait instant sharing
  useEffect(() => {
    let active = true;
    const isLegacyOrInvalid = !bill.pdf_url ||
      bill.pdf_url.includes('?f=') ||
      !bill.pdf_url.endsWith('.pdf') ||
      bill.pdf_url.includes('xukj') ||
      !bill.pdf_url.includes('stylefleet.tecstellar.com/b/');

    if (isLegacyOrInvalid) {
      generatePdfFile()
        .then(({ uri, base64 }) => {
          if (active) {
            pdfStorageService.uploadInvoicePdf(
              shopId || bill.shop_id,
              bill,
              uri,
              base64
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [bill.id, bill.invoice_number]);

  // Share PDF
  const handleSharePdf = async () => {
    if (!allowShare) return;
    try {
      setIsExportingPdf(true);
      const { uri, base64 } = await generatePdfFile();
      const cleanNumber = bill.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Invoice_${cleanNumber}.pdf`;
      const targetUri = `${FileSystem.cacheDirectory}${filename}`;

      const info = await FileSystem.getInfoAsync(targetUri);
      if (info.exists) {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
      }

      if (base64) {
        await FileSystem.writeAsStringAsync(targetUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.copyAsync({ from: uri, to: targetUri });
      }

      const isShareAvailable = await Sharing.isAvailableAsync().catch(() => false);
      if (isShareAvailable) {
        await Sharing.shareAsync(targetUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share Invoice PDF - ${bill.customer_name}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'File sharing is not available on this device.');
      }
    } catch (err: any) {
      console.warn('Share PDF error:', err);
      Alert.alert('Share Error', err.message || 'Could not share PDF invoice.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Direct Native Print
  const handlePrint = async () => {
    try {
      setIsPrinting(true);
      const safeLogo = await getSafeLogoForPdf();
      const html = generateInvoiceHtml({
        bill,
        shopName,
        shopAddress,
        shopPhone,
        shopEmail: (socialLinks as any)?.email,
        shopGstin,
        shopLogoUrl: safeLogo,
        customerPhone: activeCustomerPhone || undefined,
      });
      await Print.printAsync({ html });
    } catch (err: any) {
      console.warn('Print error:', err);
      Alert.alert('Print Error', err.message || 'Could not send invoice to printer.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Send WhatsApp directly to a specific 10-digit number
  const sendWhatsAppToPhone = async (phone10: string, overrideUpiId?: string) => {
    const cleanPhone = phone10.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      setInputPhone(cleanPhone);
      setPhoneModalVisible(true);
      return;
    }

    try {
      setIsSendingWhatsApp(true);

      // 1. Instant deterministic PDF URL with background Supabase Storage upload
      let pdfUrl = bill.pdf_url;
      const isLegacyOrInvalid = !pdfUrl ||
        pdfUrl.includes('?f=') ||
        !pdfUrl.endsWith('.pdf') ||
        pdfUrl.includes('xukj') ||
        !pdfUrl.includes('stylefleet.tecstellar.com/b/');

      if (isLegacyOrInvalid) {
        const cleanNumber = (bill.invoice_number || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
        const shortId = bill.id ? bill.id.slice(0, 4) : Date.now().toString().slice(-4);
        const fileName = `${cleanNumber}_${shortId}.pdf`;
        pdfUrl = `https://stylefleet.tecstellar.com/b/${fileName}`;

        // The file must exist in storage before the link is sent, otherwise the customer gets a 404
        try {
          const { uri, base64 } = await generatePdfFile();
          pdfUrl = await pdfStorageService.uploadInvoicePdf(
            shopId || bill.shop_id,
            bill,
            uri,
            base64
          );
        } catch (pdfErr: any) {
          console.warn('PDF upload failed before WhatsApp send:', pdfErr);
          Alert.alert(
            'Could not prepare PDF',
            'The invoice PDF could not be uploaded, so the link would not open for your customer. Check your internet connection and try again.'
          );
          return;
        }
      }

      const effectiveUpi = overrideUpiId !== undefined ? overrideUpiId : currentUpiId;

      // 2. Build official WhatsApp customer message using dedicated templates
      const message = buildWhatsAppBillMessage({
        shopName,
        shopAddress,
        shopPhone,
        customerName: bill.customer_name,
        bill,
        pdfDownloadUrl: pdfUrl,
        socialLinks,
        upiId: effectiveUpi,
      });

      // 3. WhatsApp or WhatsApp Business choice
      const installed = await getInstalledWhatsAppApps();
      const choice = whatsAppChoiceFor(installed.length);
      if (choice === 'ask' || (Platform.OS === 'android' && installed.length === 0)) {
        const appsToUse: InstalledWhatsAppApp[] =
          installed.length >= 2
            ? installed
            : [
                { id: 'whatsapp', label: 'WhatsApp', packageName: 'com.whatsapp', iconBase64: null },
                { id: 'business', label: 'WhatsApp Business', packageName: 'com.whatsapp.w4b', iconBase64: null },
              ];
        setPendingWhatsApp({ phone: cleanPhone, message, apps: appsToUse });
        return;
      }

      await openWhatsAppChat(cleanPhone, message, installed[0]);
      onSendWhatsApp?.(bill);
    } catch (err: any) {
      console.warn('Error launching WhatsApp:', err);
      Alert.alert('WhatsApp Error', err.message || 'Could not open WhatsApp.');
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const handlePickWhatsApp = async (app: InstalledWhatsAppApp) => {
    const pending = pendingWhatsApp;
    setPendingWhatsApp(null);
    if (!pending) return;
    try {
      await openWhatsAppChat(pending.phone, pending.message, app);
      onSendWhatsApp?.(bill);
    } catch (err: any) {
      console.warn('Error launching WhatsApp:', err);
      Alert.alert('WhatsApp Error', err.message || 'Could not open WhatsApp.');
    }
  };

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
      Alert.alert('UPI ID Saved', 'UPI ID successfully saved to your Shop Profile.');
      if (activeCustomerPhone.length === 10) {
        sendWhatsAppToPhone(activeCustomerPhone, trimmed);
      } else {
        setInputPhone('');
        setPhoneModalVisible(true);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save UPI ID');
    } finally {
      setIsSavingUpi(false);
    }
  };

  // WhatsApp Trigger: Checks if partially paid requires UPI setup
  const handleWhatsApp = () => {
    if (!allowShare) {
      Alert.alert(
        'Not Allowed',
        'The salon owner has not given you permission to share bills. Please ask the owner to turn on Share bills for you.'
      );
      return;
    }
    const isDue = (dueMinor || 0) > 0 || isPartiallyPaid || isPending;
    if (isDue && (!currentUpiId || !currentUpiId.trim())) {
      setUpiInput('');
      setShowUpiModal(true);
      return;
    }
    if (activeCustomerPhone.length === 10) {
      sendWhatsAppToPhone(activeCustomerPhone);
    } else {
      setInputPhone('');
      setPhoneModalVisible(true);
    }
  };

  const isDeleted = bill.status === 'deleted';

  const handleDelete = () => {
    Alert.alert(
      'Delete Bill',
      `Move invoice #${bill.invoice_number} (${inrFromMinor(bill.total_minor)}) to Recently Deleted?\n\nThis bill will remain recoverable in Recently Deleted for 30 days. Note that created sales count toward subscription usage limit.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to Recently Deleted',
          style: 'destructive',
          onPress: async () => {
            if (onDeleteBill) {
              try {
                await onDeleteBill(bill.id);
                onBack();
              } catch (e: any) {
                Alert.alert('Bill not deleted', e?.message || 'Could not delete the bill. Please try again.');
              }
            }
          },
        },
      ]
    );
  };

  const handleRestore = async () => {
    if (onRestoreBill) {
      try {
        await onRestoreBill(bill.id);
        Alert.alert('Bill Restored', `Invoice #${bill.invoice_number} has been restored to active sales.`);
        onBack();
      } catch (e: any) {
        Alert.alert('Bill not restored', e?.message || 'Could not restore the bill. Please try again.');
      }
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.topBar}>
        <Button variant="icon" onPress={onBack}>
          <BackIcon size={18} color={colors.text} />
        </Button>
        <Text style={[styles.title, { color: colors.text }]}>{t('invoice')}</Text>

        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isDeleted ? (
            <TouchableOpacity
              onPress={handleRestore}
              activeOpacity={0.8}
              style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: radii.md, backgroundColor: '#22C55E' }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>Restore</Text>
            </TouchableOpacity>
          ) : (
            <>
              {onEditBill && (
                <TouchableOpacity
                  onPress={() => onEditBill(bill)}
                  activeOpacity={0.8}
                  style={{ padding: 6, borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' }}
                  accessibilityLabel="Edit Bill"
                >
                  <EditIcon size={16} color={colors.accent} />
                </TouchableOpacity>
              )}
              {onDeleteBill && (
                <TouchableOpacity
                  onPress={handleDelete}
                  activeOpacity={0.8}
                  style={{ padding: 6, borderRadius: radii.md, borderWidth: 1, borderColor: '#EF4444', justifyContent: 'center', alignItems: 'center' }}
                  accessibilityLabel="Delete Bill"
                >
                  <TrashIcon size={16} color="#EF4444" />
                </TouchableOpacity>
              )}
            </>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={[
                styles.invoiceBadge,
                {
                  backgroundColor: isDeleted ? 'rgba(239, 68, 68, 0.15)' : colors.accent900,
                  borderColor: isDeleted ? '#EF4444' : colors.accent,
                },
              ]}
            >
              <Text style={[styles.invoiceBadgeText, { color: isDeleted ? '#EF4444' : colors.accent200 }]}>
                {isDeleted ? 'DELETED' : bill.invoice_number}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* 30-Day Recently Deleted notice banner */}
      {isDeleted && (
        <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EF4444', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700' }}>
              Recently Deleted · 30-day retention
            </Text>
            <Text style={{ color: '#EF4444', fontSize: 11, marginTop: 2, opacity: 0.9 }}>
              Deleted by: {bill.deleted_by || 'Owner'}{bill.deleted_by_role ? ` (${bill.deleted_by_role === 'stylist' ? 'Stylist' : 'Owner'})` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRestore}
            style={{ backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.sm }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}>Restore</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Receipt Card */}
        <View
          style={[
            styles.receiptCard,
            { backgroundColor: colors.surface },
          ]}
        >
          {/* Shop Header & Logo */}
          <View style={styles.receiptHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.shopName, { color: colors.text }]}>{shopName}</Text>
              <Text style={[styles.shopMeta, { color: colors.textDim }]}>
                {shopAddress}
                {shopGstin ? `\nGSTIN ${shopGstin}` : ''}
              </Text>
            </View>
            {shopLogoUrl && !logoError && (shopLogoUrl.startsWith('http') || shopLogoUrl.startsWith('data:') || shopLogoUrl.startsWith('file:') || shopLogoUrl.startsWith('content:')) ? (
              <Image
                source={{ uri: shopLogoUrl.trim() }}
                style={styles.logoImage}
                resizeMode="cover"
                onError={() => setLogoError(true)}
              />
            ) : (
              <View style={[styles.logoThumb, { backgroundColor: colors.accent800 }]}>
                <Text style={{ color: colors.accent100, fontWeight: '700', fontSize: 13 }}>
                  {getInitials(shopName)}
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          {/* Billed To / Date */}
          <View style={styles.billedToRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.metaLabel, { color: colors.textDim }]}>{t('billedTo')}</Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {bill.customer_name}
              </Text>
              {activeCustomerPhone ? (
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                  📱 +91 {activeCustomerPhone}
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setInputPhone('');
                    setPhoneModalVisible(true);
                  }}
                  style={{ marginTop: 2 }}
                >
                  <Text style={{ fontSize: 11, color: colors.accent, fontWeight: '600' }}>
                    + Add Phone Number
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.metaLabel, { color: colors.textDim }]}>
                {bill.issued_at}
              </Text>
              <Text style={[styles.metaValue, { color: colors.text }]}>
                {bill.staff_name}
              </Text>
            </View>
          </View>

          {/* Line Items */}
          <View style={styles.itemsList}>
            {bill.items.map((item, idx) => (
              <View
                key={idx}
                style={[
                  styles.itemRow,
                  { borderBottomColor: colors.divider },
                ]}
              >
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={[styles.itemName, { color: colors.text }]}>
                    {item.service_name_snapshot}
                  </Text>
                  {item.quantity && item.quantity > 1 ? (
                    <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>
                      Qty: {item.quantity} · {inrFromMinor(item.unit_price_minor)} each
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.itemPrice, { color: colors.text }]}>
                  {inrFromMinor(item.line_total_minor || (item.unit_price_minor * (item.quantity || 1)))}
                </Text>
              </View>
            ))}
          </View>

          {/* Financial Totals */}
          <View style={styles.totalsBlock}>
            <View style={styles.totalLine}>
              <Text style={[styles.totalLineLabel, { color: colors.textMuted }]}>
                {t('subtotal')}
              </Text>
              <Text style={[styles.totalLineValue, { color: colors.textMuted }]}>
                {inrFromMinor(bill.subtotal_minor)}
              </Text>
            </View>

            {bill.discount_minor > 0 ? (
              <View style={styles.totalLine}>
                <Text style={[styles.totalLineLabel, { color: colors.accent }]}>
                  {t('discount')}
                </Text>
                <Text style={[styles.totalLineValue, { color: colors.accent }]}>
                  − {inrFromMinor(bill.discount_minor)}
                </Text>
              </View>
            ) : null}

            {bill.tax_minor > 0 ? (
              <View style={styles.totalLine}>
                <Text style={[styles.totalLineLabel, { color: colors.textMuted }]}>
                  {t('tax')}
                </Text>
                <Text style={[styles.totalLineValue, { color: colors.textMuted }]}>
                  {inrFromMinor(bill.tax_minor)}
                </Text>
              </View>
            ) : null}

            {bill.tip_minor && bill.tip_minor > 0 ? (
              <View style={styles.totalLine}>
                <Text style={[styles.totalLineLabel, { color: colors.text }]}>
                  {t('tip', 'Tip / Gratuity')}
                </Text>
                <Text style={[styles.totalLineValue, { color: colors.text }]}>
                  + {inrFromMinor(bill.tip_minor)}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          {/* Financial Breakdown: 4 required values */}
          <View style={{ gap: 6 }}>
            <View style={styles.totalLine}>
              <Text style={[styles.totalLineLabel, { color: colors.textDim }]}>Total Amount</Text>
              <Text style={[styles.totalLineValue, { color: colors.text, fontWeight: '700' }]}>
                {inrFromMinor(bill.total_minor)}
              </Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={[styles.totalLineLabel, { color: paidMinor > 0 ? '#16a34a' : colors.textDim, fontWeight: '500' }]}>
                Amount Paid{paidMinor > 0 ? ` (${bill.payment_method})` : ''}
              </Text>
              <Text style={[styles.totalLineValue, { color: paidMinor > 0 ? '#16a34a' : colors.textDim, fontWeight: '700' }]}>
                {inrFromMinor(paidMinor)}
              </Text>
            </View>

            <View
              style={[
                styles.totalLine,
                dueMinor > 0
                  ? {
                      borderTopWidth: 1,
                      borderTopColor: '#fca5a5',
                      borderStyle: 'dashed',
                      paddingTop: 8,
                      marginTop: 4,
                    }
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.totalLineLabel,
                  { color: dueMinor > 0 ? '#dc2626' : colors.textDim, fontWeight: dueMinor > 0 ? '700' : '500', fontSize: dueMinor > 0 ? 14 : 13 },
                ]}
              >
                Amount Due
              </Text>
              <Text
                style={[
                  styles.totalLineValue,
                  { color: dueMinor > 0 ? '#dc2626' : colors.textDim, fontWeight: dueMinor > 0 ? '800' : '700', fontSize: dueMinor > 0 ? 18 : 14 },
                ]}
              >
                {inrFromMinor(dueMinor)}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
              {isPartiallyPaid ? (
                <View
                  style={{
                    backgroundColor: '#fef3c7',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#fde68a',
                  }}
                >
                  <Text style={{ color: '#b45309', fontWeight: '700', fontSize: 11 }}>
                    PARTIALLY PAID · DUE {inrFromMinor(dueMinor)}
                  </Text>
                </View>
              ) : isPending ? (
                <View
                  style={{
                    backgroundColor: '#fee2e2',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#fecaca',
                  }}
                >
                  <Text style={{ color: '#991b1b', fontWeight: '700', fontSize: 11 }}>
                    PENDING / UNPAID
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    backgroundColor: '#dcfce7',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#bbf7d0',
                  }}
                >
                  <Text style={{ color: '#166534', fontWeight: '700', fontSize: 11 }}>
                    PAID · {bill.payment_method.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Communication & Follow-up Status */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.divider,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Reminder Status
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 2 }}>
              {bill.reminder_status || 'Not Sent'}
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Confirmation Status
            </Text>
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: bill.confirmation_status === 'Confirmed' ? '#10B981' : colors.accent,
                marginTop: 2,
              }}
            >
              {bill.confirmation_status || 'Pending'}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          {allowShare && (
            <Button
              label={isSendingWhatsApp ? 'Preparing PDF...' : 'WhatsApp'}
              icon={<WhatsAppIcon size={16} color="#FFFFFF" />}
              onPress={handleWhatsApp}
              disabled={isSendingWhatsApp}
              style={{ flex: 1.5 }}
            />
          )}
          <Button
            label={isPrinting ? '...' : 'Print'}
            variant="secondary"
            disabled={isPrinting || isSendingWhatsApp}
            onPress={handlePrint}
            style={{ flex: allowShare ? undefined : 1, paddingHorizontal: 16 }}
          />
        </View>

        <Text style={[styles.footnote, { color: colors.textSubtle }]}>
          Official invoice generated with StyleFleet.
        </Text>
      </ScrollView>

      <WhatsAppAppPickerModal
        visible={!!pendingWhatsApp}
        apps={pendingWhatsApp?.apps || []}
        onSelect={handlePickWhatsApp}
        onCancel={() => setPendingWhatsApp(null)}
      />

      {/* Phone prompt modal to redirect directly to customer WhatsApp */}
      <Modal
        visible={phoneModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhoneModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Customer Mobile Number
            </Text>
            <Text style={[styles.modalSub, { color: colors.textDim }]}>
              Enter 10-digit mobile number to open WhatsApp directly with {bill.customer_name}.
            </Text>
            <View
              style={[
                styles.phoneInputContainer,
                { backgroundColor: colors.bg, borderColor: colors.divider },
              ]}
            >
              <Text style={{ color: colors.textDim, fontWeight: '600' }}>+91 </Text>
              <TextInput
                style={[styles.phoneTextInput, { color: colors.text }]}
                placeholder="Enter 10-digit number"
                placeholderTextColor={colors.textDim}
                keyboardType="phone-pad"
                maxLength={10}
                value={inputPhone}
                onChangeText={setInputPhone}
                autoFocus
              />
            </View>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { borderColor: colors.divider }]}
                onPress={() => setPhoneModalVisible(false)}
              >
                <Text style={{ color: colors.textDim, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: '#10b981' }]}
                onPress={() => {
                  const cleaned = inputPhone.replace(/\D/g, '').slice(-10);
                  if (cleaned.length !== 10) {
                    Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number.');
                    return;
                  }
                  setActiveCustomerPhone(cleaned);
                  setPhoneModalVisible(false);
                  sendWhatsAppToPhone(cleaned);
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '700' }}>Open WhatsApp Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* UPI ID modal for partially paid bills */}
      <Modal
        visible={showUpiModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUpiModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 20 }}>💳</Text>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Enter Salon UPI ID
                </Text>
              </View>
              <Text style={[styles.modalSub, { color: colors.textDim }]}>
                This bill is partially paid. Enter your Salon UPI ID so the customer can scan or pay the balance due via WhatsApp. This will be automatically saved to your Shop Profile.
              </Text>
              <View
                style={[
                  styles.phoneInputContainer,
                  { backgroundColor: colors.bg, borderColor: colors.divider, paddingHorizontal: 12 },
                ]}
              >
                <TextInput
                  style={[styles.phoneTextInput, { color: colors.text, fontSize: 14 }]}
                  placeholder="e.g. yoursalon@okaxis or 9876543210@paytm"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={upiInput}
                  onChangeText={setUpiInput}
                  autoFocus
                />
              </View>
              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={[styles.modalCancelBtn, { borderColor: colors.divider }]}
                  onPress={() => setShowUpiModal(false)}
                >
                  <Text style={{ color: colors.textDim, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={isSavingUpi}
                  style={[styles.modalConfirmBtn, { backgroundColor: '#10b981' }]}
                  onPress={handleSaveUpiId}
                >
                  {isSavingUpi ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={{ color: '#ffffff', fontWeight: '700' }}>Save & Open Chat</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  invoiceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  invoiceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  receiptCard: {
    borderRadius: radii.lg,
    padding: 20,
    marginBottom: 20,
  },
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  shopName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  shopMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  logoImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  logoThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginVertical: 13,
  },
  billedToRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: 11.5,
  },
  metaValue: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '600',
  },
  itemsList: {
    marginTop: 14,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  itemName: {
    fontSize: 13,
  },
  itemPrice: {
    fontSize: 13,
  },
  totalsBlock: {
    marginTop: 12,
    gap: 5,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  totalLineLabel: {
    fontSize: 12.5,
  },
  totalLineValue: {
    fontSize: 12.5,
  },
  paidRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  paidLabel: {
    flex: 1,
    fontSize: 12,
  },
  grandTotal: {
    fontSize: 22,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  footnote: {
    marginTop: 12,
    fontSize: 11.5,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 18,
  },
  phoneTextInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 0,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalConfirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
});
