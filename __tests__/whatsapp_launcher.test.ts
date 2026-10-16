import { translations, LanguageCode } from '../src/i18n/translations';

const mockPlatform = { OS: 'android' };
const mockLinking = { canOpenURL: jest.fn(), openURL: jest.fn() };
const mockAlert = { alert: jest.fn() };
const mockIntent = { getApplicationIconAsync: jest.fn(), startActivityAsync: jest.fn() };

jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform;
  },
  Linking: mockLinking,
  Alert: mockAlert,
}));
jest.mock('expo-intent-launcher', () => mockIntent);

// eslint-disable-next-line import/first
import {
  WHATSAPP_APPS,
  buildChatUrls,
  getInstalledWhatsAppApps,
  openWhatsAppChat,
  openWhatsAppPreferred,
  setPreferredWhatsApp,
  whatsAppChoiceFor,
} from '../src/services/whatsappLauncher';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../plugins/withWhatsAppQueries');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const launcherPlugin = require('../plugins/withIntentLauncherPackage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

const installOnly = (...packages: string[]) =>
  mockIntent.getApplicationIconAsync.mockImplementation((pkg: string) =>
    packages.includes(pkg) ? Promise.resolve('ICON-' + pkg) : Promise.reject(new Error('PackageNotFound'))
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatform.OS = 'android';
  mockLinking.canOpenURL.mockResolvedValue(true);
  mockLinking.openURL.mockResolvedValue(undefined);
  mockIntent.startActivityAsync.mockResolvedValue({ resultCode: 0 });
});

describe('when to ask which WhatsApp', () => {
  it('asks only when both are installed', () => {
    expect(whatsAppChoiceFor(2)).toBe('ask');
    expect(whatsAppChoiceFor(1)).toBe('single');
    expect(whatsAppChoiceFor(0)).toBe('none');
  });

  it('detects both apps', async () => {
    installOnly('com.whatsapp', 'com.whatsapp.w4b');
    const apps = await getInstalledWhatsAppApps();
    expect(apps.map((a) => a.id)).toEqual(['whatsapp', 'business']);
    expect(apps[1].iconBase64).toBe('ICON-com.whatsapp.w4b');
    expect(whatsAppChoiceFor(apps.length)).toBe('ask');
  });

  it('detects only the one that is installed', async () => {
    installOnly('com.whatsapp.w4b');
    const apps = await getInstalledWhatsAppApps();
    expect(apps.map((a) => a.id)).toEqual(['business']);
    expect(whatsAppChoiceFor(apps.length)).toBe('single');
  });

  it('finds nothing when neither is visible, so the caller uses the system default', async () => {
    installOnly();
    expect(await getInstalledWhatsAppApps()).toEqual([]);
  });

  it('does not probe on iOS', async () => {
    mockPlatform.OS = 'ios';
    expect(await getInstalledWhatsAppApps()).toEqual([]);
    expect(mockIntent.getApplicationIconAsync).not.toHaveBeenCalled();
  });
});

describe('opening the chat', () => {
  const app = WHATSAPP_APPS[1]; // WhatsApp Business

  it('builds links with the +91 number and an encoded message', () => {
    const urls = buildChatUrls('98765 43210', 'Hi & bye ₹100');
    expect(urls.native).toBe('whatsapp://send?phone=919876543210&text=' + encodeURIComponent('Hi & bye ₹100'));
    expect(urls.web).toContain('https://api.whatsapp.com/send?phone=919876543210');
  });

  it('sends to the chosen app only', async () => {
    await openWhatsAppChat('9876543210', 'hello', app);
    expect(mockIntent.startActivityAsync).toHaveBeenCalledWith(
      'android.intent.action.VIEW',
      expect.objectContaining({ packageName: 'com.whatsapp.w4b', data: expect.stringContaining('whatsapp://send') })
    );
    expect(mockLinking.openURL).not.toHaveBeenCalled();
  });

  it('says so, and never opens the other WhatsApp, if the chosen app cannot open it', async () => {
    mockIntent.startActivityAsync.mockRejectedValue(new Error('ActivityNotFound'));
    await expect(openWhatsAppChat('9876543210', 'hello', app)).rejects.toThrow(/WhatsApp Business/);
    expect(mockLinking.openURL).not.toHaveBeenCalled();
  });

  it('uses the system default when no app was chosen', async () => {
    await openWhatsAppChat('9876543210', 'hello');
    expect(mockIntent.startActivityAsync).not.toHaveBeenCalled();
    expect(mockLinking.openURL).toHaveBeenCalledWith(expect.stringContaining('whatsapp://send'));
  });

  it('uses the web link when WhatsApp cannot be opened by scheme', async () => {
    mockLinking.canOpenURL.mockResolvedValue(false);
    await openWhatsAppChat('9876543210', 'hello');
    expect(mockLinking.openURL).toHaveBeenCalledWith(expect.stringContaining('https://api.whatsapp.com/send'));
  });
});

describe('Android manifest plugin', () => {
  const names = (m: any) => m.queries[0].package.map((p: any) => p.$['android:name']);

  it('declares both WhatsApp packages so installs are visible on Android 11+', () => {
    expect(names(plugin.addWhatsAppQueries({}))).toEqual(['com.whatsapp', 'com.whatsapp.w4b']);
  });

  it('keeps existing queries and does not add duplicates', () => {
    const manifest = {
      queries: [{ package: [{ $: { 'android:name': 'com.whatsapp' } }], intent: [{ action: 'x' }] }],
    };
    const out = plugin.addWhatsAppQueries(plugin.addWhatsAppQueries(manifest));
    expect(names(out)).toEqual(['com.whatsapp', 'com.whatsapp.w4b']);
    expect(out.queries[0].intent).toEqual([{ action: 'x' }]);
  });
});

describe('picker strings', () => {
  const LANGS: LanguageCode[] = ['en', 'ta', 'ml', 'te', 'hi', 'kn'];
  const keys = ['waPickTitle', 'waPickSub', 'waPersonalSub', 'waBusinessSub'];
  for (const lang of LANGS) {
    it(`${lang} has every picker string`, () => {
      expect(keys.filter((k) => !translations[lang][k])).toEqual([]);
    });
  }
});

describe('every screen opens the same WhatsApp', () => {
  const lastPackage = () => mockIntent.startActivityAsync.mock.calls.pop()?.[1]?.packageName;

  it('uses the only installed app explicitly', async () => {
    installOnly('com.whatsapp.w4b');
    await openWhatsAppPreferred('9876543210', 'hi');
    expect(lastPackage()).toBe('com.whatsapp.w4b');
  });

  it('uses the remembered choice when both are installed, without asking', async () => {
    installOnly('com.whatsapp', 'com.whatsapp.w4b');
    await setPreferredWhatsApp('business');
    await openWhatsAppPreferred('9876543210', 'hi');
    expect(mockAlert.alert).not.toHaveBeenCalled();
    expect(lastPackage()).toBe('com.whatsapp.w4b');
  });

  it('asks once when there is no choice yet, then remembers it', async () => {
    installOnly('com.whatsapp', 'com.whatsapp.w4b');
    await require('@react-native-async-storage/async-storage').removeItem('@stylefleet_whatsapp_app');
    mockAlert.alert.mockImplementationOnce((_t: string, _m: string, buttons: any[]) => buttons.find((b) => b.text === 'WhatsApp Business').onPress());
    await openWhatsAppPreferred('9876543210', 'hi');
    expect(lastPackage()).toBe('com.whatsapp.w4b');
    mockAlert.alert.mockClear();
    await openWhatsAppPreferred('9876543210', 'again');
    expect(mockAlert.alert).not.toHaveBeenCalled();
  });

  it('opens nothing when the dialog is dismissed', async () => {
    installOnly('com.whatsapp', 'com.whatsapp.w4b');
    await require('@react-native-async-storage/async-storage').removeItem('@stylefleet_whatsapp_app');
    mockAlert.alert.mockImplementationOnce((_t: string, _m: string, buttons: any[]) => buttons.find((b) => b.text === 'Cancel').onPress());
    await openWhatsAppPreferred('9876543210', 'hi');
    expect(mockIntent.startActivityAsync).not.toHaveBeenCalled();
    expect(mockLinking.openURL).not.toHaveBeenCalled();
  });
});

describe('native patch for expo-intent-launcher', () => {
  const source = () => fs.readFileSync(launcherPlugin.modulePath(), 'utf8');

  it('finds its patch point in the installed library and makes it call setPackage', () => {
    const out = launcherPlugin.patchSource(source());
    expect(out).toContain('intent.setPackage(params.packageName)');
    expect(out).toContain(launcherPlugin.MARKER);
  });

  it('is safe to apply twice', () => {
    const once = launcherPlugin.patchSource(source());
    expect(launcherPlugin.patchSource(once)).toBe(once);
  });

  it('fails the build loudly if the library changes shape', () => {
    expect(() => launcherPlugin.patchSource('class Other {}')).toThrow(/patch point was not found/);
  });

  it('is registered in app.json', () => {
    const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
    expect(app.expo.plugins).toContain('./plugins/withIntentLauncherPackage');
  });
});
