import * as Updates from 'expo-updates';
import { AppState, AppStateStatus } from 'react-native';

export interface OtaState {
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateReady: boolean;
  error: Error | null;
}

type OtaListener = (state: OtaState) => void;

class OtaUpdateService {
  private isChecking = false;
  private isDownloading = false;
  private isUpdateReady = false;
  private listeners: Set<OtaListener> = new Set();
  private lastCheckTime = 0;
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Listen to app foreground events
    AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        this.checkForUpdates();
      }
    });

    // Periodic check every 5 minutes while app is running
    setInterval(() => {
      if (AppState.currentState === 'active') {
        this.checkForUpdates();
      }
    }, 5 * 60 * 1000);
  }

  subscribe(listener: OtaListener): () => void {
    this.listeners.add(listener);
    listener({
      isChecking: this.isChecking,
      isDownloading: this.isDownloading,
      isUpdateReady: this.isUpdateReady,
      error: null,
    });
    return () => this.listeners.delete(listener);
  }

  private notify(error: Error | null = null) {
    for (const listener of this.listeners) {
      try {
        listener({
          isChecking: this.isChecking,
          isDownloading: this.isDownloading,
          isUpdateReady: this.isUpdateReady,
          error,
        });
      } catch (e) {
        console.warn('[OTA] Listener error:', e);
      }
    }
  }

  async checkForUpdates(force = false): Promise<void> {
    // expo-updates is only active in production release builds
    if (!Updates.isEnabled) {
      return;
    }

    const now = Date.now();
    // Throttle checks to once every 60 seconds unless forced
    if (!force && now - this.lastCheckTime < 60 * 1000) {
      return;
    }
    this.lastCheckTime = now;

    if (this.isChecking || this.isDownloading || this.isUpdateReady) {
      return;
    }

    try {
      this.isChecking = true;
      this.notify();

      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        this.isChecking = false;
        this.isDownloading = true;
        this.notify();

        await Updates.fetchUpdateAsync();
        this.isDownloading = false;
        this.isUpdateReady = true;
        this.notify();
      } else {
        this.isChecking = false;
        this.notify();
      }
    } catch (err: any) {
      this.isChecking = false;
      this.isDownloading = false;
      this.notify(err);
      console.warn('[OTA] Check failed:', err?.message || err);
    }
  }

  async applyUpdateAndReload(): Promise<void> {
    if (!Updates.isEnabled) {
      return;
    }
    try {
      await Updates.reloadAsync();
    } catch (err) {
      console.warn('[OTA] Reload failed:', err);
    }
  }
}

export const otaUpdateService = new OtaUpdateService();
