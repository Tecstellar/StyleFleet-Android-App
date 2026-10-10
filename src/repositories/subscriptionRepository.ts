import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { PlanId, getPlanById } from '../config/planConfig';
import { SubscriptionRecord } from '../types/domain';
import {
  TrialCalculationResult,
  SubscriptionCalculationResult,
  calculateTrialStatus,
  calculateSubscriptionStatus,
  isWithinFirst30DaysOfRegistration,
} from '../utils/subscriptionUtils';

const STORAGE_KEY_SUB_CACHE = '@salon_os_sub_cache_';
const STORAGE_KEY_REG_DATE = '@salon_os_reg_date_';
const STORAGE_KEY_ACTIVE_PLAN = '@salon_os_active_plan_';

export const CASHFREE_ENV = (process.env.EXPO_PUBLIC_CASHFREE_ENV || 'SANDBOX').toUpperCase();
// The Cashfree secret key never ships in the app: every Cashfree call goes through the
// `cashfree-service` Supabase Edge Function, which holds the key as a server secret.

/** The reason the payment server gave when it refused a request (its answer comes back inside the error). */
async function serverReason(error: unknown): Promise<string | null> {
  try {
    const response = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
    if (response && typeof response.json === 'function') {
      const body = (await response.json()) as { error?: unknown; message?: unknown } | null;
      if (typeof body?.error === 'string' && body.error) return body.error;
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
  } catch {
    // the answer was not readable: the caller shows its own wording
  }
  return null;
}

export interface SubscriptionInfo {
  type: 'trial' | 'subscription';
  trial?: TrialCalculationResult;
  subscription?: SubscriptionCalculationResult;
  rawRecord?: SubscriptionRecord | null;
  registrationDateIso: string;
}

export class SubscriptionRepository {
  /**
   * Clears any local active plan cache for a shop (e.g. if order was unpaid or cancelled).
   */
  async clearActivePlan(shopId?: string): Promise<void> {
    const targetShopKey = shopId || 'default';
    try {
      await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_PLAN + targetShopKey);
      await AsyncStorage.removeItem(STORAGE_KEY_SUB_CACHE + targetShopKey);
      if (shopId) {
        await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_PLAN + shopId);
        await AsyncStorage.removeItem(STORAGE_KEY_SUB_CACHE + shopId);
      }
      await AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_PLAN + 'default');
      await AsyncStorage.removeItem(STORAGE_KEY_SUB_CACHE + 'default');
    } catch {
      // Ignore
    }
  }

  /**
   * Direct verification helper to check if a specific Cashfree order was actually PAID.
   */
  async checkIsOrderPaid(orderId: string): Promise<boolean> {
    try {
      if (!orderId || orderId.startsWith('test_')) return false;

      const { data, error } = await supabase.functions.invoke('cashfree-service', {
        body: { action: 'check-order', orderId },
      });
      return !error && data?.paid === true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch current subscription or trial status for a shop.
   * Priority:
   * 1. Active paid subscription in `subscriptions` table (authoritative).
   * 2. Verified paid local subscription (cleared if unverified/unpaid).
   * 3. Authoritative creation date of the shop or user profile in Supabase (Free Trial).
   * 4. Local offline cache fallback.
   */
  async getSubscriptionInfo(shopId: string, userId?: string): Promise<SubscriptionInfo> {
    const targetShopKey = shopId || 'default';
    try {
      // 1. Try querying Supabase subscriptions table for any active subscription first
      let subRecord: SubscriptionRecord | null = null;
      if (shopId) {
        try {
          const { data, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('shop_id', shopId)
            .in('status', ['active', 'cancelled'])
            .order('created_at', { ascending: false })
            .limit(10);

          // Pending / failed payment attempts must never hide a paid or manually granted plan:
          // take the newest active plan that has not expired yet
          if (!error && data && data.length > 0) {
            const rows = data as SubscriptionRecord[];
            subRecord = rows.find((r) => !calculateSubscriptionStatus(r).isExpired) || rows[0];
          }
        } catch {
          // Table may not exist yet or offline
        }
      }

      // If active subscription exists in Supabase and not expired
      if (subRecord && (subRecord.status === 'active' || subRecord.status === 'cancelled')) {
        const subCalc = calculateSubscriptionStatus(subRecord);
        if (!subCalc.isExpired) {
          // Sync to local persistent storage
          await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_PLAN + targetShopKey, JSON.stringify(subRecord));
          const result: SubscriptionInfo = {
            type: 'subscription',
            subscription: subCalc,
            rawRecord: subRecord,
            registrationDateIso: subRecord.created_at,
          };
          await this.cacheInfo(shopId, result);
          return result;
        }
      }

      // 2. If no valid subscription in Supabase, verify local persistent storage
      const localPlanRaw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_PLAN + targetShopKey);
      if (localPlanRaw) {
        try {
          const localRecord: SubscriptionRecord = JSON.parse(localPlanRaw);
          if (localRecord && (localRecord.status === 'active' || localRecord.status === 'cancelled')) {
            // Strictly verify if this local plan was actually paid
            let isVerifiedPaid = false;
            if (localRecord.cashfree_order_id) {
              isVerifiedPaid = await this.checkIsOrderPaid(localRecord.cashfree_order_id);
            }

            if (!isVerifiedPaid) {
              // Unpaid / premature / fake plan detected! Clear it immediately.
              await this.clearActivePlan(shopId);
            } else {
              const subCalc = calculateSubscriptionStatus(localRecord);
              if (!subCalc.isExpired) {
                const result: SubscriptionInfo = {
                  type: 'subscription',
                  subscription: subCalc,
                  rawRecord: localRecord,
                  registrationDateIso: localRecord.created_at,
                };
                await this.cacheInfo(shopId, result);
                return result;
              }
            }
          }
        } catch {
          await this.clearActivePlan(shopId);
        }
      }

      // 3. Fetch authoritative registration date for Free Trial
      let registrationDateIso: string | null = null;

      // Check shop created_at
      if (shopId) {
        try {
          const { data: shopData } = await supabase
            .from('shops')
            .select('created_at')
            .eq('id', shopId)
            .single();

          if (shopData?.created_at) {
            registrationDateIso = shopData.created_at;
          }
        } catch {
          // Ignore
        }
      }

      // Check user profile created_at if shop created_at not found
      if (!registrationDateIso && userId) {
        try {
          const { data: profData } = await supabase
            .from('profiles')
            .select('created_at')
            .eq('id', userId)
            .single();

          if (profData?.created_at) {
            registrationDateIso = profData.created_at;
          }
        } catch {
          // Ignore
        }
      }

      // Check cached registration date
      if (!registrationDateIso) {
        const cachedReg = await AsyncStorage.getItem(STORAGE_KEY_REG_DATE + targetShopKey);
        if (cachedReg) {
          registrationDateIso = cachedReg;
        }
      }

      // Fallback to now if brand new
      if (!registrationDateIso) {
        registrationDateIso = new Date().toISOString();
        await AsyncStorage.setItem(STORAGE_KEY_REG_DATE + targetShopKey, registrationDateIso);
      } else {
        await AsyncStorage.setItem(STORAGE_KEY_REG_DATE + targetShopKey, registrationDateIso);
      }

      // Calculate trial status from authoritative registration timestamp
      const trialCalc = calculateTrialStatus(registrationDateIso);
      const result: SubscriptionInfo = {
        type: 'trial',
        trial: trialCalc,
        rawRecord: subRecord,
        registrationDateIso,
      };

      await this.cacheInfo(shopId, result);
      return result;
    } catch {
      // 4. Fallback to cached info if network fails
      const cached = await this.getCachedInfo(shopId);
      if (cached) return cached;

      const nowIso = new Date().toISOString();
      return {
        type: 'trial',
        trial: calculateTrialStatus(nowIso),
        rawRecord: null,
        registrationDateIso: nowIso,
      };
    }
  }

  /**
   * Calls Supabase Edge Function to create a Cashfree payment order.
   * If Edge Function is not yet deployed, falls back to direct Cashfree Hosted Links API.
   */
  async createPaymentOrder(params: {
    shopId: string;
    planId: PlanId;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    isLaunchOffer?: boolean;
    registrationDateIso?: string;
  }): Promise<{ paymentSessionId: string; orderId: string; paymentLinkUrl?: string; cfOrderId?: string; isSandbox?: boolean }> {
    const isLaunch =
      params.isLaunchOffer !== undefined
        ? params.isLaunchOffer
        : isWithinFirst30DaysOfRegistration(params.registrationDateIso);
    const plan = getPlanById(params.planId, isLaunch);
    if (!plan) {
      throw new Error('Invalid plan selected');
    }

    const cleanPhone = (params.customerPhone || '9999999999').replace(/\D/g, '').slice(-10);
    const safeLinkId = `sf_link_${(params.shopId || 'shop').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}_${Date.now()}`;

    // The order is created on the server, which holds the Cashfree secret
    {
      const { data, error } = await supabase.functions.invoke('cashfree-service', {
        body: {
          action: 'create-order',
          shopId: params.shopId,
          planId: params.planId,
          // The server decides the price; this is only what the owner saw, so a mismatch is reported
          expectedAmount: plan.priceInRupees,
          customerName: params.customerName || 'Salon Owner',
          customerPhone: cleanPhone,
          customerEmail: params.customerEmail || 'owner@stylefleet.app',
        },
      });

      if (!error && data && (data.paymentLinkUrl || data.paymentSessionId)) {
        return {
          paymentSessionId: data.paymentSessionId || '',
          paymentLinkUrl: data.paymentLinkUrl,
          orderId: data.orderId || safeLinkId,
          cfOrderId: data.cfOrderId,
          isSandbox: CASHFREE_ENV !== 'PRODUCTION',
        };
      }

      throw new Error(
        (data && typeof data.error === 'string' && data.error) ||
          (await serverReason(error)) ||
          'Unable to start the payment. Please check your internet connection and try again.'
      );
    }
  }

  /**
   * Calls Supabase Edge Function or Cashfree API to verify payment and activate subscription.
   */
  async verifyPaymentOrder(params: {
    orderId: string;
    shopId: string;
    planId: PlanId;
    /** Whether the salon paid the launch-offer price (used only if the gateway does not report the amount) */
    isLaunchOffer?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    // The payment is checked on the server, which holds the Cashfree secret
    try {
      const { data, error } = await supabase.functions.invoke('cashfree-service', {
        body: {
          action: 'verify-order',
          orderId: params.orderId,
          shopId: params.shopId,
          planId: params.planId,
        },
      });

      if (!error && data && data.success) {
        const paidMinor = Number(data?.subscription?.amount_minor);
        await this.recordSubscription({
          shopId: params.shopId,
          userId: '',
          planId: params.planId,
          orderId: params.orderId,
          isLaunchOffer: params.isLaunchOffer,
          amountMinor: Number.isFinite(paidMinor) && paidMinor > 0 ? paidMinor : undefined,
          serverRecorded: true,
        });
        return {
          success: true,
          message: data.message || 'Payment verified and plan activated!',
        };
      }

      if (!error && data) {
        return {
          success: false,
          message: `Order status: ${data.status || 'PENDING'}. Please complete payment.`,
        };
      }
      return {
        success: false,
        message:
          (await serverReason(error)) ||
          'Could not verify payment. Please check your internet connection and try again.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Could not verify payment',
      };
    }
  }

  /**
   * Activates a subscription both in local persistent storage and Supabase.
   */
  async recordSubscription(params: {
    shopId: string;
    userId: string;
    planId: PlanId;
    orderId?: string;
    paymentId?: string;
    /** What the gateway says was actually paid, in paise. Wins over the plan's list price. */
    amountMinor?: number;
    isLaunchOffer?: boolean;
    /** The payment server already saved the subscription, so do not add a second row for the same payment. */
    serverRecorded?: boolean;
  }): Promise<SubscriptionRecord | null> {
    const plan = getPlanById(params.planId, params.isLaunchOffer ?? false);
    if (!plan) throw new Error('Invalid plan');

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + plan.durationDays * 86400000);
    const targetShopKey = params.shopId || 'default';

    const recordData: SubscriptionRecord = {
      id: `sub_${Date.now()}`,
      shop_id: params.shopId && params.shopId.length > 20 ? params.shopId : null,
      user_id: params.userId && params.userId.length > 20 ? params.userId : targetShopKey,
      plan_id: params.planId,
      status: 'active',
      trial_start_date: null,
      trial_end_date: null,
      subscription_start_date: startDate.toISOString(),
      subscription_end_date: endDate.toISOString(),
      cashfree_order_id: params.orderId || null,
      cashfree_payment_id: params.paymentId || null,
      amount_minor: params.amountMinor ?? plan.priceInRupees * 100,
      currency: 'INR',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 1. Persist locally first (immediate update, survives restart)
    try {
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_PLAN + targetShopKey, JSON.stringify(recordData));
      await AsyncStorage.removeItem(STORAGE_KEY_SUB_CACHE + targetShopKey);
      if (params.shopId) {
        await AsyncStorage.removeItem(STORAGE_KEY_SUB_CACHE + params.shopId);
      }
    } catch {
      // Ignore
    }

    // 2. Persist to Supabase subscriptions table (skipped when the payment server already saved this payment)
    if (params.serverRecorded) return recordData;
    try {
      await supabase.from('subscriptions').insert({
        shop_id: recordData.shop_id,
        user_id: params.userId && params.userId.length > 20 ? params.userId : null,
        plan_id: recordData.plan_id,
        status: recordData.status,
        subscription_start_date: recordData.subscription_start_date,
        subscription_end_date: recordData.subscription_end_date,
        cashfree_order_id: recordData.cashfree_order_id,
        cashfree_payment_id: recordData.cashfree_payment_id,
        amount_minor: recordData.amount_minor,
        currency: recordData.currency,
        updated_at: recordData.updated_at,
      });
    } catch {
      // If table not migrated yet, local persistence has already succeeded
    }

    return recordData;
  }

  private async cacheInfo(shopId: string, info: SubscriptionInfo): Promise<void> {
    try {
      const targetKey = shopId || 'default';
      await AsyncStorage.setItem(STORAGE_KEY_SUB_CACHE + targetKey, JSON.stringify(info));
    } catch {
      // Ignore
    }
  }

  /**
   * Fetches all subscription history records for a shop, latest first.
   */
  async getSubscriptionHistory(shopId: string): Promise<SubscriptionRecord[]> {
    const records: SubscriptionRecord[] = [];
    const seenIds = new Set<string>();

    if (shopId) {
      try {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false });

        if (!error && data && Array.isArray(data)) {
          for (const item of data) {
            records.push(item as SubscriptionRecord);
            seenIds.add(item.id);
            if (item.cashfree_order_id) seenIds.add(item.cashfree_order_id);
          }
        }
      } catch {
        // Table or network fallback
      }
    }

    // Check local persistent storage for current active plan
    try {
      const targetShopKey = shopId || 'default';
      const localPlanRaw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_PLAN + targetShopKey);
      if (localPlanRaw) {
        const localRecord: SubscriptionRecord = JSON.parse(localPlanRaw);
        if (
          localRecord &&
          !seenIds.has(localRecord.id) &&
          (!localRecord.cashfree_order_id || !seenIds.has(localRecord.cashfree_order_id))
        ) {
          records.unshift(localRecord);
          seenIds.add(localRecord.id);
        }
      }
    } catch {
      // Ignore
    }

    return records;
  }

  private async getCachedInfo(shopId: string): Promise<SubscriptionInfo | null> {
    try {
      const targetKey = shopId || 'default';
      const raw = await AsyncStorage.getItem(STORAGE_KEY_SUB_CACHE + targetKey);
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore
    }
    return null;
  }
}

export const subscriptionRepository = new SubscriptionRepository();
