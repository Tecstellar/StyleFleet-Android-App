import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Modal } from '../../components/common/KeyboardAwareModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { serviceRepository } from '../../repositories/serviceRepository';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from '../../components/common/GlassBackdrop';
import { getGlass } from '../../theme/glass';
import { findDuplicateService } from '../../utils/serviceName';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../../components/common/Button';
import { BackIcon, TrashIcon, EditIcon, PlusIcon, ChatIcon, MoreVerticalIcon, MenuScanIcon } from '../../components/common/SvgIcons';
import { Chip } from '../../components/common/Chip';
import { Service, Offer, ServiceCategory, Customer } from '../../types/domain';
import { inrFromMinor } from '../../utils/format';
import { radii, shadows } from '../../theme/spacing';


/** The price field: it springs up in size while it is being edited, right where it sits in the row. */
const ZoomPriceInput = ({
  value,
  onChange,
  onDone,
  color,
  bg,
  textColor,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  color: string;
  bg: string;
  textColor: string;
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.spring(scale, { toValue: 1.3, friction: 6, tension: 120, useNativeDriver: true }).start();
  }, [scale]);
  return (
    <Animated.View
      style={[
        { flexDirection: 'row', alignItems: 'center', width: 138, gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 14, borderWidth: 2, borderColor: color, backgroundColor: bg },
        { transform: [{ scale }], zIndex: 10, elevation: 6 },
      ]}
    >
      <Text style={{ color, fontWeight: '800', fontSize: 14 }}>₹</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={onDone}
        onBlur={onDone}
        style={{ flex: 1, minWidth: 52, padding: 0, fontSize: 14, fontWeight: '800', color: textColor }}
      />
    </Animated.View>
  );
};

interface PricingScreenProps {
  services: Service[];
  offers: Offer[];
  categories?: ServiceCategory[];
  customers?: Customer[];
  shopId?: string;
  shopName?: string;
  onBack: () => void;
  /** The navigator asks this before leaving (Android back button). Returns true when it handled the press. */
  backGuardRef?: React.MutableRefObject<(() => boolean) | null>;
  onAddCategory?: (categoryName: string) => Promise<ServiceCategory>;
  onAddService: (category: string, name: string, priceRupees: number) => Promise<void>;
  onUpdateService?: (serviceId: string, updates: { name?: string; priceRupees?: number; categoryName?: string }) => Promise<void>;
  onRemoveService: (serviceId: string) => Promise<void>;
  onToggleOffer: (offerId: string) => Promise<void>;
  onRemoveOffer: (offerId: string) => Promise<void>;
  onAddOffer: (name: string, description: string, discountType: 'percentage' | 'fixed', discountValue: number) => Promise<void>;
  onImportMenuAI?: (items: { category: string; name: string; priceRupees: number }[]) => Promise<{ added: number } | void>;
}

type DragApi = {
  dragStart: (svc: Service, g: { x0: number; y0: number }) => void;
  dragMove: (g: { moveX: number; moveY: number }) => void;
  dragEnd: (g: { moveX: number; moveY: number } | null) => void;
};

// Grip at the left of a service row. Each grip owns its responder and knows its service,
// so the drag starts the moment the finger lands on it.
const DragGrip = ({ svc, api, color }: { svc: Service; api: React.MutableRefObject<DragApi>; color: string }) => {
  const svcRef = useRef(svc);
  svcRef.current = svc;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e, g) => api.current.dragStart(svcRef.current, g),
      onPanResponderMove: (_e, g) => api.current.dragMove(g),
      onPanResponderRelease: (_e, g) => api.current.dragEnd(g),
      onPanResponderTerminate: () => api.current.dragEnd(null),
    })
  ).current;
  return (
    <View
      {...responder.panHandlers}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityLabel={`Drag ${svc.name} to another category`}
      style={styles.gripHandle}
    >
      <Text style={{ color, fontSize: 16, lineHeight: 16 }}>{'\u22EE\u22EE'}</Text>
    </View>
  );
};

export const PricingScreen = ({
  services,
  offers,
  categories: propCategories = [],
  customers = [],
  shopId = '',
  shopName = 'My Salon',
  onBack,
  backGuardRef,
  onAddCategory,
  onAddService,
  onUpdateService,
  onRemoveService,
  onToggleOffer,
  onRemoveOffer,
  onAddOffer,
  onImportMenuAI,
}: PricingScreenProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  // Add Mode Toggle: 'service' | 'category'
  const [pageTab, setPageTab] = useState<'prices' | 'offers'>('prices');
  const [showAddItem, setShowAddItem] = useState(false);

  const shareOffer = async (o: { name: string; description: string | null; discount_type: 'percentage' | 'fixed'; discount_value: number }) => {
    const deal = o.discount_type === 'percentage' ? `${o.discount_value}% off` : `\u20b9${o.discount_value} off`;
    const lines = [`\u2728 ${o.name} at ${shopName}`, `${deal}${o.description ? ` \u2013 ${o.description}` : ''}`, '', 'Book your visit today!'];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch (e: any) {
      Alert.alert('Could not share', e?.message || 'Please try again.');
    }
  };
  const [catMode, setCatMode] = useState<'existing' | 'new'>('existing');
  const [itemCat, setItemCat] = useState('');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Add Service Form
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcPrice, setNewSvcPrice] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('All');
  const [isAddingService, setIsAddingService] = useState(false);

  // Inline price edit: tap a price, type, press Done (or tap away) to save
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState('');
  // Price changes wait here until the owner presses Save (rupees, keyed by service id)
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [savingAll, setSavingAll] = useState(false);
  const draftCount = Object.keys(drafts).length;
  const priceOf = (svc: Service): number => drafts[svc.id] ?? Math.round(svc.price_minor / 100);

  const scrollRef = useRef<ScrollView>(null);
  const blockY = useRef<Record<string, number>>({});
  const listY = useRef<Record<string, number>>({});
  const tileY = useRef<Record<string, number>>({});
  const [kbHeight, setKbHeight] = useState(0);
  React.useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const setDraft = (svc: Service, value: number) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (value === Math.round(svc.price_minor / 100)) delete next[svc.id];
      else next[svc.id] = value;
      return next;
    });
  };

  const startPriceEdit = (svc: Service) => {
    if (!onUpdateService || savingAll) return;
    editingPriceIdRef.current = svc.id;
    setEditingPriceId(svc.id);
    setEditingPriceValue(String(priceOf(svc)));
  };

  // Keep the row being edited near the top so the keyboard never covers it. The list gets extra
  // room at the bottom while editing, otherwise rows near the end could not scroll up far enough.
  React.useEffect(() => {
    if (!editingPriceId) return;
    const svc = services.find((sv) => sv.id === editingPriceId);
    if (!svc) return;
    const cat = svc.category_name || 'Hair';
    const top = (blockY.current[cat] ?? 0) + (listY.current[cat] ?? 0) + (tileY.current[svc.id] ?? 0);
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, top - 90), animated: true }), 120);
    return () => clearTimeout(timer);
  }, [editingPriceId, kbHeight]);

  const closePriceEdit = () => {
    editingPriceIdRef.current = null;
    setEditingPriceId(null);
    Keyboard.dismiss();
  };

  const commitPriceEdit = (svc: Service) => {
    if (editingPriceIdRef.current !== svc.id) return; // already closed (blur after Done)
    const next = parseFloat(editingPriceValue);
    if (!isNaN(next) && next > 0) setDraft(svc, next);
    else if (editingPriceValue.trim() !== '') Alert.alert('Invalid Price', 'Please enter a valid price in Rupees');
    closePriceEdit();
  };

  const stepPrice = (svc: Service, delta: number) => {
    if (savingAll) return;
    setDraft(svc, Math.max(1, priceOf(svc) + delta));
  };

  /** Saves every pending price. Returns true when all of them went through. */
  const saveAll = async (): Promise<boolean> => {
    if (!onUpdateService || savingAll || draftCount === 0) return draftCount === 0;
    setSavingAll(true);
    const failed: string[] = [];
    for (const [id, price] of Object.entries(drafts)) {
      try {
        await onUpdateService(id, { priceRupees: price });
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch {
        failed.push(services.find((sv) => sv.id === id)?.name || 'a service');
      }
    }
    setSavingAll(false);
    if (failed.length > 0) {
      Alert.alert("Some prices weren't saved", `Couldn't save: ${failed.join(', ')}. Your edits are still here, try Save again.`);
      return false;
    }
    return true;
  };

  const askSaveThenLeave = () => {
    Alert.alert(
      t('prUnsavedTitle', 'Unsaved changes'),
      t('prUnsavedMsg', 'Do you want to save your price changes before leaving?'),
      [
        { text: t('prKeepEditing', 'Keep editing'), style: 'cancel' },
        {
          text: t('prDiscard', 'Discard'),
          style: 'destructive',
          onPress: () => {
            setDrafts({});
            onBack();
          },
        },
        {
          text: t('prSave', 'Save'),
          onPress: async () => {
            if (await saveAll()) onBack();
          },
        },
      ]
    );
  };

  const requestBack = () => {
    if (editingPriceId) closePriceEdit();
    if (draftCount > 0) askSaveThenLeave();
    else onBack();
  };

  // let the navigator's Android back button ask the same question
  const backHandlerRef = useRef(requestBack);
  backHandlerRef.current = requestBack;
  React.useEffect(() => {
    if (!backGuardRef) return;
    backGuardRef.current = () => {
      if (!editingPriceIdRef.current && draftCountRef.current === 0) return false;
      backHandlerRef.current();
      return true;
    };
    return () => {
      backGuardRef.current = null;
    };
  }, [backGuardRef]);
  const editingPriceIdRef = useRef<string | null>(null);
  editingPriceIdRef.current = editingPriceId;
  const draftCountRef = useRef(0);
  draftCountRef.current = draftCount;

  // Blinking hint next to the import button
  const aiBlink = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(aiBlink, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(aiBlink, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [aiBlink]);

  // Drag a service by its grip and drop it on a category chip to move it
  const rootRef = useRef<View>(null);
  const chipRefs = useRef<Record<string, View | null>>({});
  const chipRects = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const rootOrigin = useRef({ x: 0, y: 0 });
  const dragSvcRef = useRef<Service | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dragPos = useRef(new Animated.ValueXY()).current;
  const [dragSvc, setDragSvc] = useState<Service | null>(null);
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);

  const hitChip = (x: number, y: number): string | null => {
    for (const [cat, r] of Object.entries(chipRects.current)) {
      if (cat !== 'All' && x >= r.x && x <= r.x + r.w && y >= r.y - 6 && y <= r.y + r.h + 6) return cat;
    }
    return null;
  };

  const dragStart = (svc: Service, g: { x0: number; y0: number }) => {
    dragSvcRef.current = svc;
    chipRects.current = {};
    Object.entries(chipRefs.current).forEach(([cat, ref]) => {
      ref?.measureInWindow((x, y, w, h) => {
        chipRects.current[cat] = { x, y, w, h };
      });
    });
    rootRef.current?.measureInWindow((x, y) => {
      rootOrigin.current = { x, y };
    });
    dragPos.setValue({ x: g.x0 - rootOrigin.current.x, y: g.y0 - rootOrigin.current.y });
    setScrollLocked(true);
    setDragSvc(svc);
  };

  const dragMove = (g: { moveX: number; moveY: number }) => {
    dragPos.setValue({ x: g.moveX - rootOrigin.current.x, y: g.moveY - rootOrigin.current.y });
    const over = hitChip(g.moveX, g.moveY);
    if (over !== hoverRef.current) {
      hoverRef.current = over;
      setHoverCat(over);
    }
  };

  const dragEnd = async (g: { moveX: number; moveY: number } | null) => {
    const svc = dragSvcRef.current;
    const target = g ? hitChip(g.moveX, g.moveY) : null;
    dragSvcRef.current = null;
    hoverRef.current = null;
    setHoverCat(null);
    setDragSvc(null);
    setScrollLocked(false);
    if (svc && target && onUpdateService && target !== (svc.category_name || 'Hair')) {
      try {
        await onUpdateService(svc.id, { categoryName: target });
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Could not move service');
      }
    }
  };
  const dragApi = useRef({ dragStart, dragMove, dragEnd });
  dragApi.current = { dragStart, dragMove, dragEnd };

  // Quick adjust: category filter, +/- stepper, raise-all shortcut
  const [isRaising, setIsRaising] = useState(false);
  const PRICE_STEP = 10;

  const raiseAll = (kind: 'percent' | 'flat', amount: number) => {
    if (!onUpdateService || isRaising) return;
    const targets = services.filter((sv) => selectedCat === 'All' || (sv.category_name || 'Hair') === selectedCat);
    if (targets.length === 0) return;
    const label = kind === 'percent' ? `${amount}%` : `₹${amount}`;
    const nextPrice = (sv: Service) => {
      const cur = Math.round(sv.price_minor / 100);
      // Percent raises round to the nearest 5 rupees so prices stay clean
      return kind === 'percent' ? Math.max(5, Math.round((cur * (1 + amount / 100)) / 5) * 5) : cur + amount;
    };
    const first = targets[0];
    Alert.alert(
      'Raise prices',
      `Raise ${targets.length} ${selectedCat === 'All' ? '' : selectedCat + ' '}services by ${label}?\n\nExample: ${first.name} ₹${Math.round(
        first.price_minor / 100
      )} → ₹${nextPrice(first)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Raise',
          onPress: async () => {
            setIsRaising(true);
            const failed: string[] = [];
            for (const sv of targets) {
              try {
                await onUpdateService(sv.id, { priceRupees: nextPrice(sv) });
              } catch {
                failed.push(sv.name);
              }
            }
            setIsRaising(false);
            Alert.alert(
              failed.length ? 'Partly updated' : 'Prices updated',
              failed.length
                ? `Updated ${targets.length - failed.length}. Couldn't update: ${failed.join(', ')}`
                : `${targets.length} prices raised by ${label}.`
            );
          },
        },
      ]
    );
  };

  const nameInputRef = useRef<TextInput>(null);
  const priceInputRef = useRef<TextInput>(null);

  // Service Action Menu (Three-dot ⋮)
  const [menuService, setMenuService] = useState<Service | null>(null);

  // Edit Service Modal
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editSvcName, setEditSvcName] = useState('');
  const [editSvcPrice, setEditSvcPrice] = useState('');
  const [editSvcCat, setEditSvcCat] = useState('');
  const [isEditingSaving, setIsEditingSaving] = useState(false);

  // Add Offer Modal
  const [showAddOfferModal, setShowAddOfferModal] = useState(false);
  const [offerName, setOfferName] = useState('');
  const [offerDesc, setOfferDesc] = useState('');
  const [offerDiscount, setOfferDiscount] = useState('');
  const [offerType, setOfferType] = useState<'percentage' | 'fixed'>('percentage');
  const [isSavingOffer, setIsSavingOffer] = useState(false);

  // AI Menu Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0); // 0 to 100
  const [importStatusText, setImportStatusText] = useState('');

  // Extract unique categories from persisted database categories + services + custom categories + defaults
  const categories = useMemo(() => {
    const fromProps = (propCategories || []).map((c) => c.name);
    return Array.from(
      new Set([
        ...fromProps,
        ...services.map((s) => s.category_name || 'Hair'),
        ...customCategories,
        'Hair',
        'Beard',
        'Colour',
        'Care',
        'Packages',
      ])
    );
  }, [propCategories, services, customCategories]);

  const openAddItem = () => {
    setNewSvcName('');
    setNewSvcPrice('');
    setNewCategoryName('');
    setCatMode('existing');
    setItemCat(selectedCat === 'All' ? categories[0] || 'Hair' : selectedCat);
    setShowAddItem(true);
  };

  const handleAdd = async () => {
    if (isAddingService) return;
    const price = parseFloat(newSvcPrice);
    if (!newSvcName.trim()) {
      Alert.alert('Service Name Required', 'Please enter a name for the service');
      return;
    }
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price in Rupees');
      return;
    }

    const cleanNewCat = newCategoryName.trim().replace(/\s+/g, ' ');
    if (catMode === 'new' && !cleanNewCat) {
      Alert.alert('Category Name Required', 'Enter a name for the new category');
      return;
    }
    // A "new" category that already exists (any case) just uses the existing one
    const matchedCat = categories.find((c) => c.toLowerCase() === cleanNewCat.toLowerCase());
    const targetCat = catMode === 'new' ? matchedCat || cleanNewCat : itemCat || categories[0] || 'Hair';

    const dup = findDuplicateService(services, newSvcName);
    if (dup) {
      const dupPrice = Math.round(dup.price_minor / 100);
      if (onUpdateService && dupPrice !== price) {
        Alert.alert(
          'Already in your price list',
          `"${dup.name}" (${dup.category_name || 'Hair'}) is already listed at \u20b9${dupPrice}.\n\nUpdate its price to \u20b9${price}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: `Update to \u20b9${price}`,
              onPress: async () => {
                try {
                  await onUpdateService(dup.id, { priceRupees: price });
                  setNewSvcName('');
                  setNewSvcPrice('');
                  setShowAddItem(false);
                } catch (e: any) {
                  Alert.alert('Error', e?.message || 'Could not update price');
                }
              },
            },
          ]
        );
      } else {
        Alert.alert('Already in your price list', `"${dup.name}" (${dup.category_name || 'Hair'}) is already listed at \u20b9${dupPrice}.`);
      }
      return;
    }

    if (isAddingService) return;
    setIsAddingService(true);
    try {
      await onAddService(targetCat, newSvcName.trim(), price);
      setNewSvcName('');
      setNewSvcPrice('');
      setNewCategoryName('');
      setShowAddItem(false);
      setSelectedCat(targetCat);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not add service');
    } finally {
      setIsAddingService(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingService || !onUpdateService) return;
    const price = parseFloat(editSvcPrice);
    if (!editSvcName.trim() || isNaN(price) || price <= 0) {
      Alert.alert('Invalid Input', 'Please enter valid service name and price');
      return;
    }

    const dupEdit = findDuplicateService(services, editSvcName, editingService.id);
    if (dupEdit) {
      Alert.alert('Already in your price list', `"${dupEdit.name}" (${dupEdit.category_name || 'Hair'}) already exists. Use a different name.`);
      return;
    }

    setIsEditingSaving(true);
    try {
      await onUpdateService(editingService.id, {
        name: editSvcName.trim(),
        priceRupees: price,
        categoryName: editSvcCat,
      });
      setIsEditingSaving(false);
      setEditingService(null);
    } catch (e: any) {
      setIsEditingSaving(false);
      Alert.alert('Error', e.message || 'Failed to update service');
    }
  };

  const handleSaveOffer = async () => {
    if (!offerName.trim()) {
      Alert.alert('Required', 'Please enter offer title');
      return;
    }
    const val = parseFloat(offerDiscount);
    if (isNaN(val) || val <= 0) {
      Alert.alert('Required', 'Please enter discount value');
      return;
    }

    setIsSavingOffer(true);
    try {
      await onAddOffer(offerName.trim(), offerDesc.trim(), offerType, val);
      setIsSavingOffer(false);
      setShowAddOfferModal(false);
      setOfferName('');
      setOfferDesc('');
      setOfferDiscount('');
    } catch (e: any) {
      setIsSavingOffer(false);
      Alert.alert('Error', e.message || 'Could not save offer');
    }
  };

  // AI Menu Import Flow
  const startMenuImport = async () => {
    Alert.alert(
      'Import from Menu',
      'Select a source for your salon menu card:',
      [
        {
          text: 'Camera',
          onPress: () => pickImage(ImagePicker.launchCameraAsync),
        },
        {
          text: 'Photo Gallery',
          onPress: () => pickImage(ImagePicker.launchImageLibraryAsync),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const pickImage = async (launcher: any) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera / gallery permission is required to import menu.');
        return;
      }

      const result = await launcher({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await processMenuImage(asset.base64 || '', asset.uri);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to select image');
    }
  };

  const processMenuImage = async (base64Data: string, fileUri: string) => {
    // Prepare Base64 if not already present
    let rawBase64 = base64Data;
    if (!rawBase64 && fileUri) {
      try {
        rawBase64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: 'base64' as any,
        });
      } catch (err) {
        console.warn('Could not read base64 from uri:', err);
      }
    }

    if (!rawBase64) {
      Alert.alert('Error', 'Could not read image content');
      return;
    }

    setIsImporting(true);
    setImportProgress(20);
    setImportStatusText('Analyzing salon menu with AI...');

    try {
      // The AI key stays on the server: the Edge Function does the Gemini call
      const items = await serviceRepository.extractMenuItems(rawBase64);

      setImportProgress(65);
      setImportStatusText('Parsing extracted services & prices...');

      if (items.length === 0) {
        throw new Error('No recognizable services found in menu image');
      }

      setImportProgress(85);
      setImportStatusText(`Saving ${items.length} services to database...`);

      // Never invent a price: an item without a readable price is left out, not saved as 100
      const importable = items
        .filter((it) => Number(it.price) > 0)
        .map((it) => ({ category: it.category || 'General', name: it.name, priceRupees: Number(it.price) }));
      if (importable.length === 0) throw new Error('No services with a readable price were found in the menu image');
      const result = onImportMenuAI ? await onImportMenuAI(importable) : undefined;
      const added = result && typeof result === 'object' ? result.added : importable.length;
      const skipped = items.length - added;

      setImportProgress(100);
      setImportStatusText('Done!');
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        Alert.alert(
          'Import Successful',
          skipped > 0
            ? `${added} new services saved to your price list. ${skipped} skipped (already in your list, or no readable price).`
            : `${added} services saved to your price list.`
        );
      }, 600);
    } catch (err: any) {
      setIsImporting(false);
      setImportProgress(0);
      Alert.alert('AI Import Notice', err.message || 'Could not process menu card.');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View ref={rootRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <GlassBackdrop isDark={colors.isDark} />
      <View style={styles.topBar}>
        <Button variant="icon" onPress={requestBack}>
          <BackIcon size={18} color={colors.text} />
        </Button>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{t('priceList', 'Price List')}</Text>
          <Text style={[styles.countText, { color: colors.textDim, marginLeft: 0 }]} numberOfLines={1}>
            {services.length} {t('services')}
          </Text>
        </View>
        {pageTab === 'prices' && (
        <View style={{ alignItems: 'center', gap: 3 }}>
          <Animated.View style={{ opacity: aiBlink, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.accent }}>
            <Text style={{ color: '#0D0F14', fontSize: 9.5, fontWeight: '700' }} numberOfLines={1}>
              {t('importAiHint', 'Use AI to import')}
            </Text>
          </Animated.View>
        <TouchableOpacity
          style={[styles.importBtn, { backgroundColor: colors.accent + '1F', borderColor: colors.accent + '77' }]}
          onPress={startMenuImport}
          activeOpacity={0.85}
          disabled={isImporting}
          accessibilityRole="button"
          accessibilityLabel={t('importFromMenu', 'Import from Menu')}
        >
          {isImporting ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <MenuScanIcon size={20} color={colors.accent} />
          )}
          <Text style={[styles.importBtnText, { color: colors.accent }]} numberOfLines={2}>
            {t('importFromMenu', 'Import from Menu')}
          </Text>
        </TouchableOpacity>
        </View>
        )}
      </View>

      {/* Two separate areas: the price list and discount offers */}
      <View style={{ flexDirection: 'row', marginHorizontal: 14, marginBottom: 6, padding: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, gap: 3 }}>
        {([['prices', 'Price list', colors.accent], ['offers', 'Discount offers', '#2DD4BF']] as const).map(([k, label, tone]) => {
          const on = pageTab === k;
          return (
            <TouchableOpacity
              key={k}
              activeOpacity={0.85}
              onPress={() => setPageTab(k)}
              style={{ flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: on ? tone : 'transparent' }}
            >
              <Text style={{ color: on ? '#0D0F14' : colors.textDim, fontSize: 12.5, fontWeight: '700' }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Add button + category chips (filter, and drop targets when dragging) */}
      {pageTab === 'prices' && (
      <View
        style={[
          styles.quickAdd,
          { backgroundColor: getGlass(colors.isDark).card.backgroundColor, borderColor: getGlass(colors.isDark).card.borderColor },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {['All', ...categories].map((cat) => {
            const on = selectedCat === cat;
            const hover = hoverCat === cat;
            return (
              <View
                key={cat}
                ref={(r) => {
                  chipRefs.current[cat] = r;
                }}
                collapsable={false}
              >
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSelectedCat(cat)}
                  style={{
                    paddingHorizontal: 9,
                    height: 26,
                    justifyContent: 'center',
                    borderRadius: 13,
                    borderWidth: hover ? 2 : 1,
                    borderColor: on || hover ? colors.accent : colors.divider,
                    backgroundColor: on ? colors.accent : 'transparent',
                  }}
                >
                  <Text style={{ color: on ? '#0D0F14' : colors.textDim, fontSize: 11.5, fontWeight: '700' }} numberOfLines={1}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={openAddItem}
          accessibilityRole="button"
          accessibilityLabel="Add item"
          style={{ flexDirection: 'row', height: 30, paddingHorizontal: 11, gap: 4, borderRadius: 15, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.accent, backgroundColor: '#0F2754' }}
        >
          {/* Same navy gradient as the login hero */}
          <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 30" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="addItemGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#0B1F44" />
                <Stop offset="1" stopColor="#14336E" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="30" fill="url(#addItemGrad)" />
          </Svg>
          <PlusIcon size={14} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>Add item</Text>
        </TouchableOpacity>
        </View>
      </View>
      )}

      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scrollContent, editingPriceId ? { paddingBottom: Math.max(kbHeight, 320) + 40 } : null]} keyboardShouldPersistTaps="handled" scrollEnabled={!scrollLocked}>
        {/* Progress Bar when importing */}
        {isImporting && (
          <View style={[styles.progressCard, { ...getGlass(colors.isDark).card, borderWidth: 1 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.text, fontSize: 12 }}>{importStatusText}</Text>
              <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                {importProgress}%
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.trackBg }]}>
              <View style={[styles.progressFill, { width: `${importProgress}%`, backgroundColor: colors.accent }]} />
            </View>
          </View>
        )}

        {/* ======================================================== */}
        {/* 2. SERVICE GROUPS, QUICK ADJUST                           */}
        {/* ======================================================== */}

        {pageTab === 'prices' && (
          <>
        {onUpdateService && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              marginBottom: 6,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: getGlass(colors.isDark).card.borderColor,
              backgroundColor: getGlass(colors.isDark).card.backgroundColor,
            }}
          >
            <Text numberOfLines={1} style={{ flex: 1, color: colors.textDim, fontSize: 12 }}>
              {isRaising ? 'Updating prices…' : `Raise ${selectedCat === 'All' ? 'all' : selectedCat} prices by`}
            </Text>
            {([['percent', 5, '5%'], ['percent', 10, '10%'], ['flat', 50, '₹50']] as const).map(([k, n, l]) => (
              <TouchableOpacity
                key={l}
                activeOpacity={0.8}
                disabled={isRaising}
                onPress={() => raiseAll(k, n)}
                style={{
                  paddingHorizontal: 10,
                  minHeight: 28,
                  justifyContent: 'center',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.accent,
                  backgroundColor: colors.accent + '1F',
                }}
              >
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {categories.map((cat) => {
          if (selectedCat !== 'All' && selectedCat !== cat) return null;
          const catServices = services.filter((s) => (s.category_name || 'Hair') === cat);
          if (catServices.length === 0) return null;

          return (
            <View key={cat} style={styles.categoryBlock} onLayout={(e) => { blockY.current[cat] = e.nativeEvent.layout.y; }}>
              <Text style={[styles.categoryHeader, { color: colors.accent }]}>
                {cat.toUpperCase()} ({catServices.length})
              </Text>
              <View style={styles.servicesList} onLayout={(e) => { listY.current[cat] = e.nativeEvent.layout.y; }}>
                {catServices.map((s) => {

                  const isEditingPrice = editingPriceId === s.id;
                  const isDrafted = drafts[s.id] !== undefined;
                  return (
                    <View
                      key={s.id}
                      onLayout={(e) => { tileY.current[s.id] = e.nativeEvent.layout.y; }}
                      style={[
                        styles.serviceTile,
                        {
                          backgroundColor: getGlass(colors.isDark).card.backgroundColor,
                          borderColor: isEditingPrice ? colors.accent : getGlass(colors.isDark).card.borderColor,
                        },
                      ]}
                    >
                      {onUpdateService && <DragGrip svc={s} api={dragApi} color={colors.textDim} />}
                      <Text numberOfLines={2} style={[styles.serviceName, { color: colors.text }]}>
                        {s.name}
                      </Text>

                      {isEditingPrice ? (
                        <ZoomPriceInput
                          value={editingPriceValue}
                          onChange={(v) => setEditingPriceValue(v.replace(/[^0-9.]/g, ''))}
                          onDone={() => commitPriceEdit(s)}
                          color={colors.accent}
                          bg={colors.bg}
                          textColor={colors.text}
                        />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, width: 138 }}>
                          {onUpdateService && (
                            <TouchableOpacity
                              activeOpacity={0.7}
                              onPress={() => stepPrice(s, -PRICE_STEP)}
                              disabled={savingAll || isRaising}
                              accessibilityLabel={`Decrease price of ${s.name}`}
                              style={[styles.stepBtn, { borderColor: colors.divider }]}
                            >
                              <Text style={[styles.stepBtnText, { color: colors.accent }]}>−</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => startPriceEdit(s)}
                            disabled={!onUpdateService}
                            accessibilityLabel={`Edit price of ${s.name}`}
                            style={[styles.pricePill, { flex: 1, backgroundColor: colors.accent + (isDrafted ? '44' : '1F'), borderColor: isDrafted ? colors.accent : colors.accent + '55' }]}
                          >
                            <Text style={[styles.servicePrice, { color: colors.accent }]}>{inrFromMinor(priceOf(s) * 100)}</Text>
                          </TouchableOpacity>
                          {onUpdateService && (
                            <TouchableOpacity
                              activeOpacity={0.7}
                              onPress={() => stepPrice(s, PRICE_STEP)}
                              disabled={savingAll || isRaising}
                              accessibilityLabel={`Increase price of ${s.name}`}
                              style={[styles.stepBtn, { borderColor: colors.divider }]}
                            >
                              <Text style={[styles.stepBtnText, { color: colors.accent }]}>+</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={() => setMenuService(s)}
                        style={styles.tileMenuBtn}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Options for ${s.name}`}
                      >
                        <MoreVerticalIcon size={16} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
          </>
        )}

        {/* ======================================================== */}
        {/* 4. OFFERS SECTION WITH FULL CRUD                         */}
        {/* ======================================================== */}
        {pageTab === 'offers' && (
          <>
            <View style={{ marginBottom: 8 }}>
              <Text style={{ color: '#2DD4BF', fontSize: 15, fontWeight: '700' }}>Discount offers</Text>
              <Text style={{ color: colors.textDim, fontSize: 11.5, marginTop: 2 }}>
                Customize your offers and share them with your customers. These are separate from your price list.
              </Text>
            </View>

            {offers.length === 0 && (
              <Text style={{ color: colors.textDim, fontSize: 12.5, paddingVertical: 14, textAlign: 'center' }}>
                No offers yet. Create your first one below.
              </Text>
            )}

            <View style={styles.offersList}>
              {offers.map((o) => (
                <View
                  key={o.id}
                  style={[styles.offerCard, { ...getGlass(colors.isDark).card, borderWidth: 1, borderColor: o.is_active ? '#2DD4BF' : getGlass(colors.isDark).card.borderColor }]}
                >
                  <View style={{ minWidth: 46, height: 34, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2DD4BF' + '26' }}>
                    <Text style={{ color: '#2DD4BF', fontSize: 12.5, fontWeight: '800' }} numberOfLines={1}>
                      {o.discount_type === 'percentage' ? `${o.discount_value}%` : `\u20b9${o.discount_value}`}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.offerName, { color: colors.text }]}>{o.name}</Text>
                    {!!o.description && (
                      <Text style={[styles.offerDetail, { color: colors.textDim }]}>{o.description}</Text>
                    )}
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => onToggleOffer(o.id).catch((e: any) => Alert.alert('Error', e?.message || 'Could not update the offer'))}
                    accessibilityLabel={`${o.name} ${o.is_active ? 'on' : 'off'}`}
                    style={[
                      styles.toggleTrack,
                      {
                        backgroundColor: o.is_active ? '#2DD4BF' + '40' : 'transparent',
                        borderColor: o.is_active ? '#2DD4BF' : colors.divider,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleKnob,
                        { left: o.is_active ? 18 : 2, backgroundColor: o.is_active ? '#2DD4BF' : colors.textDim },
                      ]}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => shareOffer(o)}
                    activeOpacity={0.8}
                    accessibilityLabel={`Share ${o.name}`}
                    style={{ height: 28, paddingHorizontal: 9, borderRadius: 14, borderWidth: 1, borderColor: '#2DD4BF', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#2DD4BF', fontSize: 11.5, fontWeight: '700' }}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => onRemoveOffer(o.id).catch((e: any) => Alert.alert('Error', e?.message || 'Could not remove the offer'))} style={styles.actionIconBtn} activeOpacity={0.7}>
                    <TrashIcon size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowAddOfferModal(true)}
              style={{ marginTop: 12, minHeight: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2DD4BF' }}
            >
              <Text style={{ color: '#0D0F14', fontSize: 13.5, fontWeight: '700' }}>+ Create offer</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ======================================================== */}
      {/* VERTICAL THREE-DOT SERVICE ACTION MENU                   */}
      {/* ======================================================== */}
      <Modal visible={!!menuService} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuService(null)}
        >
          <View
            style={[
              styles.actionMenuCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.divider,
              },
            ]}
          >
            {/* Edit Option */}
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => {
                const s = menuService;
                setMenuService(null);
                if (s) {
                  setEditingService(s);
                  setEditSvcName(s.name);
                  setEditSvcPrice(String(Math.round(s.price_minor / 100)));
                  setEditSvcCat(s.category_name || 'Hair');
                }
              }}
            >
              <EditIcon size={16} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>{t('edit', 'Edit')}</Text>
            </TouchableOpacity>

            {/* Delete Option */}
            <TouchableOpacity
              style={[styles.menuItem, { borderTopWidth: 1, borderTopColor: colors.divider }]}
              activeOpacity={0.7}
              onPress={() => {
                const s = menuService;
                setMenuService(null);
                if (s) {
                  Alert.alert(
                    t('deleteService', 'Delete Service'),
                    `Are you sure you want to remove "${s.name}" from your price list?`,
                    [
                      { text: t('cancel', 'Cancel'), style: 'cancel' },
                      {
                        text: t('delete', 'Delete'),
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await onRemoveService(s.id);
                          } catch (err: any) {
                            Alert.alert('Error', err?.message || 'Could not delete service');
                          }
                        },
                      },
                    ]
                  );
                }
              }}
            >
              <TrashIcon size={16} color="#EF4444" />
              <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{t('delete', 'Delete')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ======================================================== */}
      {/* EDIT SERVICE MODAL                                       */}
      {/* ======================================================== */}
      <Modal visible={showAddItem} animationType="slide" transparent onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !isAddingService && setShowAddItem(false)} />
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Add item</Text>
                  <TouchableOpacity onPress={() => setShowAddItem(false)} disabled={isAddingService}>
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  ref={nameInputRef}
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                  placeholder="Item name (e.g. Beard Trim)"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={newSvcName}
                  onChangeText={setNewSvcName}
                  autoCapitalize="words"
                  autoFocus
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => priceInputRef.current?.focus()}
                />
                <TextInput
                  ref={priceInputRef}
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginTop: 10 }]}
                  placeholder="Price in ₹"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  keyboardType="numeric"
                  value={newSvcPrice}
                  onChangeText={(v) => setNewSvcPrice(v.replace(/[^0-9.]/g, ''))}
                />

                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textDim, marginTop: 14, marginBottom: 6 }}>
                  ADD TO CATEGORY
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  {([['existing', 'Existing category'], ['new', 'New category']] as const).map(([m, label]) => {
                    const on = catMode === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        activeOpacity={0.8}
                        onPress={() => setCatMode(m)}
                        style={{
                          flex: 1,
                          minHeight: 34,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: on ? colors.accent : colors.divider,
                          backgroundColor: on ? colors.accent + '24' : 'transparent',
                        }}
                      >
                        <Text style={{ color: on ? colors.accent : colors.textDim, fontSize: 12.5, fontWeight: '700' }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {catMode === 'existing' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {categories.map((cat) => (
                      <Chip key={cat} label={cat} active={itemCat === cat} onPress={() => setItemCat(cat)} size="sm" />
                    ))}
                  </View>
                ) : (
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                    placeholder="New category name (e.g. Spa, Bridal)"
                    placeholderTextColor={colors.placeholder || colors.textDim}
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={handleAdd}
                  />
                )}

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleAdd}
                  disabled={isAddingService}
                  style={[styles.addItemBtn, { backgroundColor: colors.accent, marginTop: 16, opacity: isAddingService ? 0.6 : 1 }]}
                >
                  {isAddingService ? (
                    <ActivityIndicator size="small" color="#161826" />
                  ) : (
                    <Text style={{ color: '#161826', fontSize: 14, fontWeight: '700' }}>Add to price list</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editingService} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setEditingService(null)}
            />
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Service</Text>
                  <TouchableOpacity onPress={() => setEditingService(null)}>
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                  placeholder="Service Name"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={editSvcName}
                  onChangeText={setEditSvcName}
                />

                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginTop: 10 }]}
                  placeholder="Price in ₹"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  keyboardType="numeric"
                  value={editSvcPrice}
                  onChangeText={setEditSvcPrice}
                />

                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textDim, marginTop: 12, marginBottom: 6 }}>
                  MOVE TO CATEGORY
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {categories.map((c) => {
                    const isSelected = editSvcCat === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setEditSvcCat(c)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: radii.pill,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.accent : colors.divider,
                          backgroundColor: isSelected ? colors.accent900 : colors.bg,
                        }}
                      >
                        <Text style={{ fontSize: 12, color: isSelected ? colors.accent100 : colors.textMuted }}>
                          {c}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleSaveEdit}
                  disabled={isEditingSaving}
                  style={[styles.modalAddBtn, { backgroundColor: colors.accent }]}
                >
                  {isEditingSaving ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={{ color: '#000', fontWeight: '600', fontSize: 14 }}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ======================================================== */}
      {/* ADD OFFER MODAL                                          */}
      {/* ======================================================== */}
      <Modal visible={showAddOfferModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setShowAddOfferModal(false)}
            />
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Create Promotional Offer</Text>
                  <TouchableOpacity onPress={() => setShowAddOfferModal(false)}>
                    <Text style={{ color: colors.textDim, fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                  placeholder="Offer Title (e.g. Festive Spa Discount)"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={offerName}
                  onChangeText={setOfferName}
                />

                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text, marginTop: 10 }]}
                  placeholder="Description (e.g. 20% off on all hair care)"
                  placeholderTextColor={colors.placeholder || colors.textDim}
                  value={offerDesc}
                  onChangeText={setOfferDesc}
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <TextInput
                    style={[styles.modalInput, { flex: 1, backgroundColor: colors.bg, borderColor: colors.divider, color: colors.text }]}
                    placeholder={offerType === 'percentage' ? 'Discount % (e.g. 15)' : 'Discount ₹ (e.g. 100)'}
                    placeholderTextColor={colors.placeholder || colors.textDim}
                    keyboardType="numeric"
                    value={offerDiscount}
                    onChangeText={setOfferDiscount}
                  />
                  <TouchableOpacity
                    onPress={() => setOfferType(offerType === 'percentage' ? 'fixed' : 'percentage')}
                    style={{
                      minHeight: 44,
                      paddingHorizontal: 12,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: colors.divider,
                      backgroundColor: colors.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>
                      {offerType === 'percentage' ? '% Off' : '₹ Flat'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleSaveOffer}
                  disabled={isSavingOffer}
                  style={[styles.modalAddBtn, { backgroundColor: colors.accent, marginTop: 16 }]}
                >
                  {isSavingOffer ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={{ color: '#000', fontWeight: '600', fontSize: 14 }}>Create Offer</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {dragSvc && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 50,
            transform: [{ translateX: Animated.add(dragPos.x, new Animated.Value(-60)) }, { translateY: Animated.add(dragPos.y, new Animated.Value(-48)) }],
            maxWidth: 200,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 16,
            backgroundColor: colors.accent,
          }}
        >
          <Text numberOfLines={1} style={{ color: '#0D0F14', fontSize: 12.5, fontWeight: '700' }}>
            {dragSvc.name}
          </Text>
        </Animated.View>
      )}

      {pageTab === 'prices' && onUpdateService && (
      <View style={[styles.saveBar, { backgroundColor: colors.surface, borderTopColor: colors.divider, marginBottom: Platform.OS === 'ios' ? kbHeight : 0 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={draftCount === 0 || savingAll}
          onPress={saveAll}
          style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: draftCount === 0 || savingAll ? 0.4 : 1 }]}
        >
          {savingAll ? (
            <ActivityIndicator size="small" color="#0D0F14" />
          ) : (
            <Text style={{ color: '#0D0F14', fontWeight: '800', fontSize: 15 }}>
              {draftCount > 0 ? `${t('prSave', 'Save')} (${draftCount})` : t('prSave', 'Save')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      )}
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
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  countText: {
    marginLeft: 'auto',
    fontSize: 11.5,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 20,
  },
  compactUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  compactUploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    flex: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  compactUploadButtonText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  compactSettingsBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressCard: {
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 16,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  categoryBlock: {
    marginBottom: 4,
  },
  categoryHeader: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 1,
  },
  saveBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  saveBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servicesList: {
    rowGap: 3,
  },
  serviceTile: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 6,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    minHeight: 34,
  },
  tileMenuBtn: {
    paddingHorizontal: 2,
  },
  gripHandle: {
    width: 20,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  pricePill: {
    minWidth: 60,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceEditBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 138,
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  priceEditInput: {
    minWidth: 52,
    padding: 0,
    fontSize: 14,
    fontWeight: '700',
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  serviceTextGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingRight: 4,
  },
  serviceName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  servicePrice: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionMenuCard: {
    width: 200,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 14.5,
    fontWeight: '500',
  },
  actionIconBtn: {
    padding: 6,
  },
  importBtn: {
    width: 76,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  importBtnText: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    textAlign: 'center',
  },
  uploadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    marginLeft: 8,
  },
  uploadChipText: {
    color: '#161826',
    fontSize: 11.5,
    fontWeight: '700',
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    borderRadius: 12,
  },
  quickAdd: {
    marginHorizontal: 14,
    marginBottom: 4,
    padding: 6,
    borderWidth: 1,
    borderRadius: 16,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickName: {
    flex: 1,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 13.5,
  },
  quickPrice: {
    width: 72,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    fontSize: 13.5,
  },
  quickAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSaveBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newCatChip: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 16,
  },
  addCardTitle: {
    fontSize: 12.5,
    fontWeight: '500',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 9,
  },
  serviceNameInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  servicePriceInput: {
    width: 88,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  categoriesChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  offersList: {
    gap: 8,
  },
  offerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radii.md,
  },
  offerName: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  offerDetail: {
    fontSize: 11.5,
    marginTop: 2,
  },
  toggleTrack: {
    width: 38,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
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
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  modalAddBtn: {
    minHeight: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
