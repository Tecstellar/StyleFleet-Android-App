import { Linking, Platform } from 'react-native';
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

/** Open a chat with the prepared message, in the chosen app or the system default. */
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
      // chosen app could not open the chat: fall through to the system default
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
