import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';

export interface WhatsAppApp {
  id: 'whatsapp' | 'business';
  /** Brand names are not translated. */
  label: string;
  packageName: string;
}

export interface InstalledWhatsAppApp extends WhatsAppApp {
  /** Base64 PNG of the app's own icon, when Android gave one. */
  iconBase64: string | null;
}

export const WHATSAPP_APPS: WhatsAppApp[] = [
  { id: 'whatsapp', label: 'WhatsApp', packageName: 'com.whatsapp' },
  { id: 'business', label: 'WhatsApp Business', packageName: 'com.whatsapp.w4b' },
];

export type WhatsAppChoice = 'none' | 'single' | 'ask';

/** Only ask the user when there is a choice to make (2 apps installed, or detection was hidden on Android). */
export function whatsAppChoiceFor(installedCount: number): WhatsAppChoice {
  if (installedCount >= 2) return 'ask';
  if (installedCount === 1) return 'single';
  return 'none';
}

export function buildChatUrls(phone10: string, message: string) {
  const phone = `91${phone10.replace(/\D/g, '').slice(-10)}`;
  const text = encodeURIComponent(message);
  return {
    native: `whatsapp://send?phone=${phone}&text=${text}`,
    web: `https://api.whatsapp.com/send?phone=${phone}&text=${text}`,
  };
}

/**
 * Which WhatsApp apps are installed. Android only: iOS has a single WhatsApp scheme.
 * Needs the `<queries>` entries from plugins/withWhatsAppQueries.js on Android 11+;
 * without them nothing is detected and callers fall back to the system default.
 */
export async function getInstalledWhatsAppApps(): Promise<InstalledWhatsAppApp[]> {
  if (Platform.OS !== 'android') return [];
  const found = await Promise.all(
    WHATSAPP_APPS.map(async (app): Promise<InstalledWhatsAppApp | null> => {
      try {
        const icon = await IntentLauncher.getApplicationIconAsync(app.packageName);
        return { ...app, iconBase64: icon || null };
      } catch {
        return null;
      }
    })
  );
  return found.filter((a): a is InstalledWhatsAppApp => a !== null);
}

const PREFERRED_KEY = '@stylefleet_whatsapp_app';

/** The WhatsApp the owner picked last time, so every screen opens the same one. */
export async function getPreferredWhatsAppId(): Promise<WhatsAppApp['id'] | null> {
  try {
    const v = await AsyncStorage.getItem(PREFERRED_KEY);
    return v === 'whatsapp' || v === 'business' ? v : null;
  } catch {
    return null;
  }
}

export async function setPreferredWhatsApp(id: WhatsAppApp['id']): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFERRED_KEY, id);
  } catch {
    // remembering is a convenience: the chat still opens
  }
}

/**
 * Open a chat with the prepared message. With an app given, only that app is used: if it cannot open
 * the chat we say so, instead of quietly opening the other WhatsApp (which sent bills to the wrong
 * account). Without an app the system default opens it.
 */
export async function openWhatsAppChat(phone10: string, message: string, app?: WhatsAppApp): Promise<void> {
  const urls = buildChatUrls(phone10, message);

  if (app && Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: urls.native,
        packageName: app.packageName,
      });
      return;
    } catch {
      throw new Error(
        `Could not open ${app.label}. Make sure it is installed and signed in, or choose the other WhatsApp.`
      );
    }
  }

  try {
    if (await Linking.canOpenURL(urls.native)) {
      await Linking.openURL(urls.native);
      return;
    }
  } catch {
    // fall through to the web link
  }
  await Linking.openURL(urls.web);
}

/** Ask which WhatsApp to use (a plain two-button dialog); null when dismissed. */
function askWhichWhatsApp(installed: InstalledWhatsAppApp[]): Promise<InstalledWhatsAppApp | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Send with which WhatsApp?',
      'You have both WhatsApp and WhatsApp Business. Your choice is remembered.',
      [
        ...installed.map((a) => ({ text: a.label, onPress: () => resolve(a) })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

/**
 * The one way every screen (reminders, offers, greetings, invites) opens a chat. With both apps
 * installed it uses the remembered choice, asking once if there is none; with one app it uses that app.
 */
export async function openWhatsAppPreferred(phone10: string, message: string): Promise<void> {
  if (Platform.OS === 'android') {
    const installed = await getInstalledWhatsAppApps();
    if (installed.length === 1) return openWhatsAppChat(phone10, message, installed[0]);
    if (installed.length >= 2) {
      const preferred = await getPreferredWhatsAppId();
      let app: InstalledWhatsAppApp | null | undefined = installed.find((a) => a.id === preferred);
      if (!app) {
        app = await askWhichWhatsApp(installed);
        if (!app) return;
        await setPreferredWhatsApp(app.id);
      }
      return openWhatsAppChat(phone10, message, app);
    }
  }
  return openWhatsAppChat(phone10, message);
}
