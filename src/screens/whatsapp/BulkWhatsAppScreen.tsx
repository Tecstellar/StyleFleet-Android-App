import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { useLanguage } from '../../i18n/LanguageContext';
import { fmt } from '../../i18n/format';
import { Button } from '../../components/common/Button';
import { BackIcon, CheckIcon } from '../../components/common/SvgIcons';
import {
  WHATSAPP_TEMPLATES,
  FESTIVAL_OFFER_TEMPLATES,
  FestivalOfferTemplate,
  WhatsAppAudience,
  whatsappRepository,
} from '../../repositories/whatsappRepository';
import { Customer } from '../../types/domain';
import { radii } from '../../theme/spacing';

interface BulkWhatsAppScreenProps {
  shopName: string;
  customers?: Customer[];
  onBack: () => void;
  onSendBulk: (params: { audience: WhatsAppAudience; message: string }) => void;
}

const WA_GREEN = '#128C7E';

export const BulkWhatsAppScreen = ({
  shopName,
  customers = [],
  onBack,
}: BulkWhatsAppScreenProps) => {
  const { colors } = useTheme();
  const glass = getGlass(colors.isDark);
  const { t } = useLanguage();
  const tf = (key: string, fallback: string, vars: Record<string, string | number> = {}) =>
    fmt(t(key, fallback), vars);

  // 1. TEMPLATE SELECTION
  const festivalTemplates = FESTIVAL_OFFER_TEMPLATES;
  const standardTemplateKeys = Object.keys(WHATSAPP_TEMPLATES);

  const [selectedTemplateType, setSelectedTemplateType] = useState<'festival' | 'standard'>('festival');
  const [selectedFestivalId, setSelectedFestivalId] = useState<string>('diwali');
  const [selectedStandardKey, setSelectedStandardKey] = useState<string>(standardTemplateKeys[0] || 'Monthly offer');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // 2. EDITABLE OFFER FIELDS
  const [offerTitle, setOfferTitle] = useState('Diwali Festive Sparkle');
  const [offerDiscount, setOfferDiscount] = useState('Flat 20% OFF');
  const [offerValidity, setOfferValidity] = useState('Valid till Diwali night');
  const [message, setMessage] = useState(FESTIVAL_OFFER_TEMPLATES[0]?.templateBody || '');

  const handleSelectFestivalTemplate = (tmpl: FestivalOfferTemplate) => {
    setSelectedFestivalId(tmpl.id);
    setOfferTitle(tmpl.title);
    setOfferDiscount(tmpl.defaultOffer);
    setOfferValidity(tmpl.defaultValidity);
    setMessage(tmpl.templateBody);
    setIsDropdownOpen(false);
  };

  const handleSelectStandardTemplate = (key: string) => {
    setSelectedStandardKey(key);
    setOfferTitle(key);
    setOfferDiscount('Exclusive Special');
    setOfferValidity('Valid this month');
    setMessage(WHATSAPP_TEMPLATES[key] || '');
    setIsDropdownOpen(false);
  };

  const handleSelectCustomOffer = () => {
    setSelectedFestivalId('custom_new');
    setSelectedStandardKey('custom_new');
    setOfferTitle('Special Salon Offer');
    setOfferDiscount('Flat 20% OFF');
    setOfferValidity('Valid this week');
    setMessage(
      `Hello [name]! Enjoy [offer] on all grooming & hair services at [shop]. [validity]. Reply to book your appointment!`
    );
    setIsDropdownOpen(false);
  };

  // 3. AUDIENCE & CUSTOMER SELECTION
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'mvp' | 'dues' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [sentCustomerIds, setSentCustomerIds] = useState<Set<string>>(new Set());

  const filteredCustomers = useMemo(() => {
    let list = customers || [];

    if (audienceFilter === 'mvp') {
      list = list.filter((c) => c.is_starred);
    } else if (audienceFilter === 'dues') {
      list = list.filter((c) => (c.outstanding_due_minor || 0) > 0);
    } else if (audienceFilter === 'inactive') {
      const nowMs = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      list = list.filter((c) => {
        if (!c.last_visit_date) return false;
        const v = new Date(c.last_visit_date).getTime();
        return !isNaN(v) && nowMs - v > thirtyDaysMs;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
  }, [customers, audienceFilter, searchQuery]);

  const [displayLimit, setDisplayLimit] = useState(50);

  useEffect(() => {
    setSelectedCustomerIds(new Set());
    setDisplayLimit(50);
  }, [audienceFilter]);

  useEffect(() => {
    setDisplayLimit(50);
  }, [searchQuery]);

  const toggleSelectCustomer = useCallback((id: string) => {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedCustomerIds((prev) => {
      if (prev.size === filteredCustomers.length && filteredCustomers.length > 0) return new Set();
      return new Set(filteredCustomers.map((c) => c.id));
    });
  }, [filteredCustomers]);

  const handleInsertTag = (tag: string) => {
    setMessage((prev) => `${prev} ${tag}`);
  };

  // 4. PREVIEW
  const firstSelectedCustomer = customers.find((c) => selectedCustomerIds.has(c.id)) || customers[0];
  const sampleCustomerName = firstSelectedCustomer ? firstSelectedCustomer.name : t('waClientName', 'Valued Client');

  const previewText = whatsappRepository.renderPreview(
    message,
    sampleCustomerName,
    shopName,
    offerDiscount,
    offerValidity
  );

  // 5. OPEN THE CUSTOMER'S WHATSAPP CHAT
  const handleSendSingleWhatsApp = useCallback(
    async (customer: Customer) => {
      const cleanPhone = (customer.phone || '').replace(/\D/g, '').slice(-10);
      if (!cleanPhone || cleanPhone.length < 10) {
        Alert.alert(
          t('waInvalidTitle', 'Invalid number'),
          tf('waInvalidMsg', '{name} does not have a valid 10-digit mobile number.', { name: customer.name })
        );
        return;
      }

      const personalized = whatsappRepository.renderPreview(
        message,
        customer.name,
        shopName,
        offerDiscount,
        offerValidity
      );

      const encodedMsg = encodeURIComponent(personalized);
      const waUrl = `whatsapp://send?phone=91${cleanPhone}&text=${encodedMsg}`;

      try {
        await Linking.openURL(waUrl);
        setSentCustomerIds((prev) => new Set([...prev, customer.id]));
      } catch {
        try {
          await Linking.openURL(`https://wa.me/91${cleanPhone}?text=${encodedMsg}`);
          setSentCustomerIds((prev) => new Set([...prev, customer.id]));
        } catch {
          Alert.alert(t('waInvalidTitle', 'Invalid number'), t('waLaunchFail', 'Could not open WhatsApp on this device.'));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message, shopName, offerDiscount, offerValidity, t]
  );

  // 6. SEND TO THE NEXT SELECTED CUSTOMER
  const handleSendToTargetCustomers = async () => {
    const unSentSelected = filteredCustomers.filter(
      (c) => selectedCustomerIds.has(c.id) && !sentCustomerIds.has(c.id)
    );
    const targetList =
      unSentSelected.length > 0
        ? unSentSelected
        : filteredCustomers.filter((c) => selectedCustomerIds.has(c.id));

    if (targetList.length === 0) {
      Alert.alert(t('waNoneTitle', 'No customers selected'), t('waNoneMsg', 'Select at least one customer to send this offer.'));
      return;
    }
    await handleSendSingleWhatsApp(targetList[0]);
  };

  const selectedCount = selectedCustomerIds.size;
  const sentCount = filteredCustomers.filter(
    (c) => selectedCustomerIds.has(c.id) && sentCustomerIds.has(c.id)
  ).length;
  const remainingCount = Math.max(0, selectedCount - sentCount);

  const currentFestivalItem = festivalTemplates.find((x) => x.id === selectedFestivalId);
  const customLabel = t('waCustom', 'Write my own message');
  const activeTemplateLabel =
    selectedTemplateType === 'festival'
      ? selectedFestivalId === 'custom_new'
        ? customLabel
        : currentFestivalItem?.title || offerTitle
      : selectedStandardKey === 'custom_new'
      ? customLabel
      : selectedStandardKey;

  const Label = ({ children }: { children: React.ReactNode }) => (
    <Text style={[styles.fieldLabel, { color: colors.textDim }]}>{children}</Text>
  );

  const inputStyle = [
    styles.textInput,
    { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <GlassBackdrop isDark={colors.isDark} />

      <View style={[styles.topBar, { borderBottomColor: colors.divider }]}>
        <Button variant="icon" onPress={onBack}>
          <BackIcon size={18} color={colors.text} />
        </Button>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {t('whatsAppOffersAndAds', 'WhatsApp Offers & Ads')}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* STEP 1: TEMPLATE */}
          <Text style={[styles.stepTitle, { color: colors.text }]}>{t('waStep1', 'Step 1 · Choose a message')}</Text>

          <View style={[styles.segment, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            {(['festival', 'standard'] as const).map((type) => {
              const active = selectedTemplateType === type;
              return (
                <TouchableOpacity
                  key={type}
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelectedTemplateType(type);
                    setIsDropdownOpen(false);
                  }}
                  style={[styles.segmentTab, active && { backgroundColor: colors.accent }]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.segmentText, { color: active ? '#161826' : colors.textDim, fontWeight: active ? '700' : '500' }]}
                  >
                    {type === 'festival' ? t('waTabFestival', 'Festival offers') : t('waTabRecall', 'Recall messages')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Label>{t('waTemplate', 'Template')}</Label>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setIsDropdownOpen((prev) => !prev)}
            style={[
              styles.dropdownTrigger,
              {
                backgroundColor: glass.card.backgroundColor,
                borderColor: isDropdownOpen ? colors.accent : glass.card.borderColor,
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.dropdownTriggerText, { color: colors.text }]}>
              {activeTemplateLabel}
            </Text>
            <Text style={{ color: colors.textDim, fontSize: 12 }}>{isDropdownOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {isDropdownOpen && (
            <View style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
                {selectedTemplateType === 'festival'
                  ? festivalTemplates.map((tmpl) => {
                      const isSelected = selectedFestivalId === tmpl.id;
                      return (
                        <TouchableOpacity
                          key={tmpl.id}
                          activeOpacity={0.7}
                          onPress={() => handleSelectFestivalTemplate(tmpl)}
                          style={[styles.dropdownItem, { borderBottomColor: colors.divider }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.dropdownItemTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                              {tmpl.title}
                            </Text>
                            <Text style={[styles.dropdownItemSub, { color: colors.textDim }]}>
                              {tmpl.category} · {tmpl.defaultOffer}
                            </Text>
                          </View>
                          {isSelected && <CheckIcon size={14} color={colors.accent} />}
                        </TouchableOpacity>
                      );
                    })
                  : standardTemplateKeys.map((key) => {
                      const isSelected = selectedStandardKey === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          activeOpacity={0.7}
                          onPress={() => handleSelectStandardTemplate(key)}
                          style={[styles.dropdownItem, { borderBottomColor: colors.divider }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.dropdownItemTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                              {key}
                            </Text>
                            <Text style={[styles.dropdownItemSub, { color: colors.textDim }]}>
                              {t('waRecallSub', 'Recall message')}
                            </Text>
                          </View>
                          {isSelected && <CheckIcon size={14} color={colors.accent} />}
                        </TouchableOpacity>
                      );
                    })}
                <TouchableOpacity activeOpacity={0.7} onPress={handleSelectCustomOffer} style={styles.dropdownItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropdownItemTitle, { color: colors.accent, fontWeight: '700' }]}>{customLabel}</Text>
                    <Text style={[styles.dropdownItemSub, { color: colors.textDim }]}>
                      {t('waCustomSub', 'Set your own title, discount and wording')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* STEP 2: EDIT */}
          <Text style={[styles.stepTitle, { color: colors.text }]}>{t('waStep2', 'Step 2 · Edit the message')}</Text>
          <View style={[styles.card, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <Label>{t('waFieldTitle', 'Offer title')}</Label>
            <TextInput
              style={inputStyle}
              value={offerTitle}
              onChangeText={setOfferTitle}
              placeholderTextColor={colors.placeholder || colors.textDim}
            />

            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <Label>{t('waFieldDiscount', 'Discount')}</Label>
                <TextInput
                  style={inputStyle}
                  value={offerDiscount}
                  onChangeText={setOfferDiscount}
                  placeholderTextColor={colors.placeholder || colors.textDim}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Label>{t('waFieldValidity', 'Validity')}</Label>
                <TextInput
                  style={inputStyle}
                  value={offerValidity}
                  onChangeText={setOfferValidity}
                  placeholderTextColor={colors.placeholder || colors.textDim}
                />
              </View>
            </View>

            <View style={styles.labelRow}>
              <Label>{t('waFieldMessage', 'Message')}</Label>
              <Text style={{ fontSize: 11, color: colors.textDim }}>{tf('waChars', '{n} characters', { n: message.length })}</Text>
            </View>
            <TextInput
              style={[styles.messageInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
              multiline
              value={message}
              onChangeText={setMessage}
              textAlignVertical="top"
              placeholderTextColor={colors.placeholder || colors.textDim}
            />

            <View style={styles.tagsRow}>
              <Text style={[styles.tagsHint, { color: colors.textDim }]}>{t('waInsert', 'Insert')}:</Text>
              {['[name]', '[shop]', '[offer]', '[validity]'].map((tag) => (
                <TouchableOpacity
                  key={tag}
                  activeOpacity={0.7}
                  onPress={() => handleInsertTag(tag)}
                  style={[styles.tagPill, { borderColor: colors.divider }]}
                >
                  <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.text }}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* STEP 3: PREVIEW */}
          <Text style={[styles.stepTitle, { color: colors.text }]}>{t('waStep3', 'Step 3 · Preview')}</Text>
          <View style={[styles.card, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}>
            <View style={[styles.previewBubble, { backgroundColor: colors.isDark ? '#1F3B33' : '#E7F5EC', borderColor: colors.isDark ? '#2B5648' : '#BFE3CD' }]}>
              <Text style={[styles.previewText, { color: colors.text }]}>{previewText}</Text>
            </View>
            <Text style={[styles.previewNote, { color: colors.textDim }]}>
              {tf('waPreviewNote', 'How {name} will receive it', { name: sampleCustomerName })}
            </Text>
          </View>

          {/* STEP 4: CUSTOMERS */}
          <View style={styles.stepRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.stepTitle, { color: colors.text, marginTop: 0 }]}>{t('waStep4', 'Step 4 · Choose customers')}</Text>
              <Text style={[styles.stepSub, { color: colors.textDim }]}>
                {tf('waSelectedSent', '{a} selected · {b} sent', { a: selectedCount, b: sentCount })}
              </Text>
            </View>
            <TouchableOpacity onPress={toggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.linkText, { color: colors.accent }]}>
                {selectedCustomerIds.size === filteredCustomers.length && filteredCustomers.length > 0
                  ? t('waDeselectAll', 'Deselect all')
                  : t('waSelectAll', 'Select all')}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {[
              { id: 'all' as const, label: tf('waFilterAll', 'All ({n})', { n: customers.length }) },
              { id: 'mvp' as const, label: tf('waFilterMvp', 'MVP ({n})', { n: customers.filter((c) => c.is_starred).length }) },
              {
                id: 'dues' as const,
                label: tf('waFilterDues', 'With dues ({n})', { n: customers.filter((c) => (c.outstanding_due_minor || 0) > 0).length }),
              },
              { id: 'inactive' as const, label: t('waFilterInactive', 'Not visited in 30+ days') },
            ].map((f) => {
              const active = audienceFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  activeOpacity={0.8}
                  onPress={() => setAudienceFilter(f.id)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? colors.accent : glass.card.backgroundColor,
                      borderColor: active ? colors.accent : glass.card.borderColor,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: active ? '700' : '500', color: active ? '#161826' : colors.text }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TextInput
            style={[styles.searchInput, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor, color: colors.text }]}
            placeholder={t('waSearch', 'Search by name or phone')}
            placeholderTextColor={colors.placeholder || colors.textDim}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <View style={styles.customerList}>
            {filteredCustomers.length === 0 ? (
              <View style={[styles.card, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor, alignItems: 'center' }]}>
                <Text style={{ color: colors.textDim, fontSize: 13, textAlign: 'center' }}>
                  {t('waNoMatch', 'No customers match this filter.')}
                </Text>
              </View>
            ) : (
              <>
                {filteredCustomers.slice(0, displayLimit).map((cust) => (
                  <CustomerRowItem
                    key={cust.id}
                    cust={cust}
                    isSelected={selectedCustomerIds.has(cust.id)}
                    isSent={sentCustomerIds.has(cust.id)}
                    onToggle={toggleSelectCustomer}
                    onSend={handleSendSingleWhatsApp}
                    colors={colors}
                    cardBg={glass.card.backgroundColor as string}
                    cardBorder={glass.card.borderColor as string}
                    labels={{
                      send: t('waSend', 'Send'),
                      sent: t('waSent', 'Sent'),
                      due: (n: number) => tf('waDue', 'Due ₹{n}', { n }),
                    }}
                  />
                ))}

                {filteredCustomers.length > displayLimit && (
                  <TouchableOpacity
                    onPress={() => setDisplayLimit((prev) => prev + 50)}
                    style={[styles.showMoreBtn, { backgroundColor: glass.card.backgroundColor, borderColor: glass.card.borderColor }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.linkText, { color: colors.accent }]}>
                      {tf('waShowMore', 'Show more ({n} remaining)', { n: filteredCustomers.length - displayLimit })}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* BOTTOM ACTION BAR */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.divider }]}>
        <Text style={[styles.batchNote, { color: colors.textDim }]}>
          {sentCount > 0
            ? tf('waSentOf', 'Sent to {a} of {b} customers', { a: sentCount, b: selectedCount })
            : t('waOpensChat', "Opens each customer's WhatsApp chat")}
        </Text>
        <TouchableOpacity
          disabled={selectedCount === 0}
          activeOpacity={0.85}
          onPress={handleSendToTargetCustomers}
          style={[
            styles.sendBulkBtn,
            { backgroundColor: selectedCount === 0 ? (colors.isDark ? '#27272a' : '#e4e4e7') : WA_GREEN },
          ]}
        >
          <Text
            numberOfLines={2}
            style={[styles.sendBulkBtnText, { color: selectedCount === 0 ? colors.textDim : '#FFFFFF' }]}
          >
            {selectedCount === 0
              ? t('waSelectToSend', 'Select customers to send')
              : remainingCount > 0
              ? tf('waSendRemaining', 'Send on WhatsApp ({n} remaining)', { n: remainingCount })
              : tf('waAllSent', 'All {n} customers sent', { n: selectedCount })}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 },
  stepTitle: { fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 20, marginBottom: 10, gap: 10 },
  stepSub: { fontSize: 12, marginTop: 1 },
  linkText: { fontSize: 13, fontWeight: '600' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radii.md, padding: 3, marginBottom: 12 },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  segmentText: { fontSize: 13 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 5 },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  dropdownTriggerText: { flex: 1, fontSize: 14, fontWeight: '600' },
  dropdownMenu: { borderWidth: 1, borderRadius: radii.md, marginTop: 4, overflow: 'hidden' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
  dropdownItemTitle: { fontSize: 13.5, marginBottom: 2 },
  dropdownItemSub: { fontSize: 11.5 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 14 },
  textInput: { height: 44, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 12, fontSize: 14, marginBottom: 12 },
  twoCols: { flexDirection: 'row', gap: 10 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  messageInput: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  tagsHint: { fontSize: 12 },
  tagPill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  previewBubble: { borderWidth: 1, borderRadius: radii.md, padding: 12 },
  previewText: { fontSize: 14, lineHeight: 20 },
  previewNote: { fontSize: 11.5, marginTop: 8 },
  chipsRow: { gap: 6, paddingBottom: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderRadius: radii.pill },
  searchInput: { height: 44, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, fontSize: 14, marginBottom: 10 },
  customerList: { gap: 6 },
  showMoreBtn: { paddingVertical: 12, borderRadius: radii.sm, alignItems: 'center', borderWidth: 1, marginTop: 4 },
  bottomBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 8 },
  batchNote: { fontSize: 12, textAlign: 'center' },
  sendBulkBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: radii.md },
  sendBulkBtnText: { fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  checkBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  customerName: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  customerPhone: { fontSize: 12, marginTop: 1 },
  dueText: { fontSize: 11.5, fontWeight: '600', color: '#EF4444' },
  singleSendBtn: { minWidth: 60, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.sm, borderWidth: 1, alignItems: 'center' },
});

interface CustomerRowItemProps {
  cust: Customer;
  isSelected: boolean;
  isSent: boolean;
  onToggle: (id: string) => void;
  onSend: (cust: Customer) => void;
  colors: ReturnType<typeof useTheme>['colors'];
  cardBg: string;
  cardBorder: string;
  labels: { send: string; sent: string; due: (n: number) => string };
}

const CustomerRowItem = React.memo(
  ({ cust, isSelected, isSent, onToggle, onSend, colors, cardBg, cardBorder, labels }: CustomerRowItemProps) => {
    const dueRupees = Math.round((cust.outstanding_due_minor || 0) / 100);
    return (
      <View
        style={[
          styles.customerRow,
          { backgroundColor: cardBg, borderColor: isSelected ? colors.accent : cardBorder },
        ]}
      >
        <TouchableOpacity
          onPress={() => onToggle(cust.id)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
        >
          <View
            style={[
              styles.checkBox,
              {
                backgroundColor: isSelected ? colors.accent : 'transparent',
                borderColor: isSelected ? colors.accent : colors.textDim,
              },
            ]}
          >
            {isSelected && <CheckIcon size={11} color="#161826" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.customerName, { color: colors.text }]}>
              {cust.name}
            </Text>
            <Text style={[styles.customerPhone, { color: colors.textDim }]}>
              +91 {cust.phone}
              {dueRupees > 0 ? '  ·  ' : ''}
              {dueRupees > 0 ? <Text style={styles.dueText}>{labels.due(dueRupees)}</Text> : null}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onSend(cust)}
          style={[
            styles.singleSendBtn,
            {
              backgroundColor: isSent ? 'transparent' : WA_GREEN,
              borderColor: isSent ? colors.divider : WA_GREEN,
            },
          ]}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: isSent ? colors.textDim : '#FFFFFF' }}>
            {isSent ? labels.sent : labels.send}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
);
