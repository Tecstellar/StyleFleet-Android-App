import React, { useState, useMemo, useEffect } from 'react';
import { openWhatsAppPreferred } from '../../services/whatsappLauncher';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Modal } from '../common/KeyboardAwareModal';
import { useTheme } from '../../theme/ThemeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../common/Button';
import { BackIcon, ChatIcon, CheckIcon, SearchIcon, WhatsAppIcon } from '../common/SvgIcons';
import {
  FESTIVAL_OFFER_TEMPLATES,
  FestivalOfferTemplate,
  whatsappRepository,
} from '../../repositories/whatsappRepository';
import { Customer } from '../../types/domain';
import { radii } from '../../theme/spacing';

interface FestivalOffersModalProps {
  visible: boolean;
  shopName: string;
  customers: Customer[];
  initialOfferTitle?: string;
  initialDiscountDesc?: string;
  onClose: () => void;
}

export const FestivalOffersModal = ({
  visible,
  shopName,
  customers = [],
  initialOfferTitle,
  initialDiscountDesc,
  onClose,
}: FestivalOffersModalProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const templates = FESTIVAL_OFFER_TEMPLATES;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('diwali');

  const [offerTitle, setOfferTitle] = useState('');
  const [offerDiscount, setOfferDiscount] = useState('');
  const [offerValidity, setOfferValidity] = useState('');
  const [messageBody, setMessageBody] = useState('');

  // Customer Selection State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [customerFilter, setCustomerFilter] = useState<'all' | 'mvp' | 'dues' | 'inactive'>('all');
  const [sentCustomerIds, setSentCustomerIds] = useState<Set<string>>(new Set());

  // Initialize from selected template or initial props
  useEffect(() => {
    if (initialOfferTitle || initialDiscountDesc) {
      setSelectedTemplateId('custom');
      setOfferTitle(initialOfferTitle || 'Special Offer');
      setOfferDiscount(initialDiscountDesc || 'Special Discount');
      setOfferValidity('Valid this week');
      setMessageBody(
        `Hello [name]! Special offer from [shop]: ${initialOfferTitle || 'Exclusive Offer'} (${initialDiscountDesc || 'Special Discount'}). Valid this week. Reply BOOK to claim your chair!`
      );
    } else {
      const tmpl = templates.find((t) => t.id === selectedTemplateId) || templates[0];
      setOfferTitle(tmpl.title);
      setOfferDiscount(tmpl.defaultOffer);
      setOfferValidity(tmpl.defaultValidity);
      setMessageBody(tmpl.templateBody);
    }
  }, [selectedTemplateId, initialOfferTitle, initialDiscountDesc, visible]);

  const handleSelectTemplate = (tmpl: FestivalOfferTemplate) => {
    setSelectedTemplateId(tmpl.id);
    setOfferTitle(tmpl.title);
    setOfferDiscount(tmpl.defaultOffer);
    setOfferValidity(tmpl.defaultValidity);
    setMessageBody(tmpl.templateBody);
  };

  // Filter customers
  const filteredCustomers = useMemo(() => {
    let list = customers || [];

    if (customerFilter === 'mvp') {
      list = list.filter((c) => c.is_starred);
    } else if (customerFilter === 'dues') {
      list = list.filter((c) => (c.outstanding_due_minor || 0) > 0);
    } else if (customerFilter === 'inactive') {
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
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, customerFilter, searchQuery]);

  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedCustomerIds.size === filteredCustomers.length) {
      setSelectedCustomerIds(new Set());
    } else {
      setSelectedCustomerIds(new Set(filteredCustomers.map((c) => c.id)));
    }
  };

  // Sample customer for preview
  const previewCustomer = useMemo(() => {
    if (selectedCustomerIds.size > 0) {
      const firstId = Array.from(selectedCustomerIds)[0];
      const found = customers.find((c) => c.id === firstId);
      if (found) return found;
    }
    return customers.length > 0 ? customers[0] : null;
  }, [selectedCustomerIds, customers]);

  const previewText = useMemo(() => {
    return whatsappRepository.renderPreview(
      messageBody,
      previewCustomer?.name || 'Customer',
      shopName,
      offerDiscount,
      offerValidity
    );
  }, [messageBody, previewCustomer, shopName, offerDiscount, offerValidity]);

  // Send single customer WhatsApp
  const sendWhatsAppToCustomer = (customer: Customer) => {
    const cleanPhone = customer.phone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      Alert.alert(
        'Phone Number Invalid',
        `No valid 10-digit phone found for ${customer.name}.`
      );
      return;
    }

    const personalizedMsg = whatsappRepository.renderPreview(
      messageBody,
      customer.name,
      shopName,
      offerDiscount,
      offerValidity
    );

    openWhatsAppPreferred(cleanPhone, personalizedMsg).catch((e: unknown) => Alert.alert('WhatsApp', e instanceof Error ? e.message : 'Could not open WhatsApp.'));

    setSentCustomerIds((prev) => new Set(prev).add(customer.id));
  };

  const handleSendPrimary = () => {
    if (selectedCustomerIds.size === 0) {
      Alert.alert('Select Customers', 'Please select at least one customer to send the offer.');
      return;
    }

    const selectedList = customers.filter((c) => selectedCustomerIds.has(c.id));
    if (selectedList.length === 1) {
      sendWhatsAppToCustomer(selectedList[0]);
    } else {
      // First customer open directly, rest can be sent via list
      sendWhatsAppToCustomer(selectedList[0]);
      Alert.alert(
        'WhatsApp Broadcast',
        `WhatsApp opened for ${selectedList[0].name}. You can tap "Send" next to remaining selected customers to dispatch their messages.`,
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalCard, { backgroundColor: colors.bg }]}>
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.divider }]}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <BackIcon size={18} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('festivalOffers', 'Festival & Promotional Offers')}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textDim }}>
                Select a festive template or create an offer to send via WhatsApp
              </Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* 1. OCCASION TEMPLATES SELECTOR */}
            <Text style={[styles.sectionLabel, { color: colors.accent }]}>
              {t('selectTemplate', 'CHOOSE OCCASION TEMPLATE')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templatesScroll}>
              {templates.map((tmpl) => {
                const isSel = selectedTemplateId === tmpl.id;
                return (
                  <TouchableOpacity
                    key={tmpl.id}
                    activeOpacity={0.8}
                    onPress={() => handleSelectTemplate(tmpl)}
                    style={[
                      styles.templateChip,
                      {
                        backgroundColor: isSel ? colors.accent900 : colors.surface,
                        borderColor: isSel ? colors.accent : colors.divider,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: isSel ? '700' : '500',
                        color: isSel ? colors.accent : colors.text,
                      }}
                    >
                      {tmpl.category}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 2. EDITABLE OFFER DETAILS */}
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.fieldLabel, { color: colors.textDim }]}>
                Offer Title
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                value={offerTitle}
                onChangeText={setOfferTitle}
                placeholder="Offer Title (e.g. Diwali Festive Sparkle)"
                placeholderTextColor={colors.textDim}
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textDim }]}>
                    Discount / Benefit
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                    value={offerDiscount}
                    onChangeText={setOfferDiscount}
                    placeholder="e.g. Flat 20% OFF"
                    placeholderTextColor={colors.textDim}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textDim }]}>
                    {t('offerValidity', 'Validity')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                    value={offerValidity}
                    onChangeText={setOfferValidity}
                    placeholder="e.g. Valid till Sunday"
                    placeholderTextColor={colors.textDim}
                  />
                </View>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textDim, marginTop: 10 }]}>
                WhatsApp Message (Fully Editable)
              </Text>
              <TextInput
                style={[
                  styles.messageInput,
                  { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text },
                ]}
                multiline
                numberOfLines={3}
                value={messageBody}
                onChangeText={setMessageBody}
                placeholder="Enter offer message with [name], [shop], [offer], [validity]..."
                placeholderTextColor={colors.textDim}
              />
              <Text style={{ fontSize: 10.5, color: colors.textSubtle, marginTop: 4 }}>
                Tags automatically replaced: [name], [shop], [offer], [validity]
              </Text>
            </View>

            {/* 3. MESSAGE PREVIEW */}
            <Text style={[styles.sectionLabel, { color: colors.accent, marginTop: 14 }]}>
              MESSAGE PREVIEW
            </Text>
            <View style={[styles.previewCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.chatBubble, { backgroundColor: colors.accent900 }]}>
                <Text style={[styles.chatBubbleText, { color: colors.accent100 }]}>
                  {previewText}
                </Text>
              </View>
              <Text style={[styles.previewSub, { color: colors.textSubtle }]}>
                as {previewCustomer?.name || 'Customer'} will see it
              </Text>
            </View>

            {/* 4. SELECT CUSTOMERS */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.accent, marginBottom: 0 }]}>
                SELECT CUSTOMERS ({selectedCustomerIds.size} / {filteredCustomers.length})
              </Text>
              <TouchableOpacity onPress={handleSelectAll}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.accent }}>
                  {selectedCustomerIds.size === filteredCustomers.length && filteredCustomers.length > 0
                    ? 'Deselect All'
                    : 'Select All'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Search and Audience Filter Chips */}
            <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
              <SearchIcon size={14} color={colors.textDim} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search by customer name or phone..."
                placeholderTextColor={colors.textDim}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            <View style={styles.filterRow}>
              {(['all', 'mvp', 'dues', 'inactive'] as const).map((mode) => {
                const isSel = customerFilter === mode;
                const label =
                  mode === 'all'
                    ? 'All'
                    : mode === 'mvp'
                    ? '★ MVP'
                    : mode === 'dues'
                    ? 'Pending dues'
                    : 'Not seen 30d';
                return (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setCustomerFilter(mode)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: isSel ? colors.accent900 : colors.surface,
                        borderColor: isSel ? colors.accent : colors.divider,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: isSel ? '700' : '500',
                        color: isSel ? colors.accent : colors.textDim,
                      }}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Customer List */}
            <View style={styles.customerList}>
              {filteredCustomers.length === 0 ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <Text style={{ color: colors.textDim, fontSize: 12.5 }}>
                    No matching customers found.
                  </Text>
                </View>
              ) : (
                filteredCustomers.map((cust) => {
                  const isSelected = selectedCustomerIds.has(cust.id);
                  const isSent = sentCustomerIds.has(cust.id);

                  return (
                    <TouchableOpacity
                      key={cust.id}
                      activeOpacity={0.8}
                      onPress={() => toggleCustomer(cust.id)}
                      style={[
                        styles.customerRow,
                        {
                          backgroundColor: isSelected ? colors.accent900 : colors.surface,
                          borderColor: isSelected ? colors.accent : colors.divider,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: isSelected ? colors.accent : colors.divider,
                            backgroundColor: isSelected ? colors.accent : 'transparent',
                          },
                        ]}
                      >
                        {isSelected && <CheckIcon size={12} color="#000" />}
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.custName, { color: colors.text }]} numberOfLines={1}>
                          {cust.name} {cust.is_starred ? '★' : ''}
                        </Text>
                        <Text style={[styles.custPhone, { color: colors.textDim }]}>
                          +91 {cust.phone}
                        </Text>
                      </View>

                      {isSelected && (
                        <TouchableOpacity
                          style={[
                            styles.sendMiniBtn,
                            { backgroundColor: isSent ? colors.surface : colors.accent },
                          ]}
                          onPress={() => sendWhatsAppToCustomer(cust)}
                        >
                          <WhatsAppIcon size={12} color={isSent ? colors.textDim : '#0D0F14'} />
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '600',
                              color: isSent ? colors.textDim : '#0D0F14',
                            }}
                          >
                            {isSent ? 'Sent' : 'Send'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>

          {/* Bottom Action Bar */}
          <View style={[styles.bottomBar, { borderTopColor: colors.divider, backgroundColor: colors.surface }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: colors.textDim }}>
                {selectedCustomerIds.size} recipient{selectedCustomerIds.size === 1 ? '' : 's'} selected
              </Text>
              {selectedCustomerIds.size > 1 && (
                <Text style={{ fontSize: 11, color: colors.accent, fontWeight: '500' }}>
                  Tap individual "Send" or dispatch directly
                </Text>
              )}
            </View>
            <Button
              icon={<WhatsAppIcon size={16} color="#0D0F14" />}
              label={
                selectedCustomerIds.size === 0
                  ? 'Select customers to send'
                  : selectedCustomerIds.size === 1
                  ? 'Send via WhatsApp'
                  : `Send to ${selectedCustomerIds.size} customers`
              }
              block
              disabled={selectedCustomerIds.size === 0}
              onPress={handleSendPrimary}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '92%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    padding: 6,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  templatesScroll: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  templateChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1.2,
    marginRight: 8,
  },
  card: {
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12.5,
  },
  messageInput: {
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: 10,
    fontSize: 12.5,
    lineHeight: 18,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  previewCard: {
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 10,
  },
  chatBubble: {
    maxWidth: '92%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  previewSub: {
    fontSize: 10.5,
    marginTop: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  customerList: {
    gap: 6,
    marginBottom: 12,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  custName: {
    fontSize: 13,
    fontWeight: '600',
  },
  custPhone: {
    fontSize: 11,
  },
  sendMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
});
