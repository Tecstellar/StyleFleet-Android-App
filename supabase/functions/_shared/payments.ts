// Plan prices, the launch-offer rule and the Razorpay rules, as the payment functions need them.
// The app shows prices from src/config/planConfig.ts; __tests__/payment_server_rules.test.ts fails
// if the two ever disagree, so change both together.
// No imports on purpose: this file runs in Deno (Edge Functions) and in Jest.
//
// Razorpay: the account is shared with other apps, so every StyleFleet order carries notes
// { app: "stylefleet", shop_id, plan_id }. Anything without that tag is ignored, never activated.

export type CanonicalPlanId = "3_months" | "6_months" | "12_months";

interface PlanSpec {
  days: number;
  /** INR after the launch offer */
  regularPrice: number;
  /** INR during the launch offer */
  launchPrice: number;
}

export const PLAN_SPECS: Record<CanonicalPlanId, PlanSpec> = {
  "3_months": { days: 90, regularPrice: 2999, launchPrice: 2999 },
  "6_months": { days: 180, regularPrice: 5999, launchPrice: 4799 },
  "12_months": { days: 365, regularPrice: 11999, launchPrice: 5999 },
};

export const LAUNCH_OFFER_DAYS = 30;

/** Accepts the ids the app has used ("6_months", "sf_plan_6m", "6m") and returns the canonical one, or null. */
export function normalizePlanId(planId: unknown): CanonicalPlanId | null {
  if (typeof planId !== "string") return null;
  const id = planId.replace("sf_plan_", "").replace("12m", "12_months").replace("6m", "6_months").replace("3m", "3_months");
  return id in PLAN_SPECS ? (id as CanonicalPlanId) : null;
}

const utcMidnight = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Same day counting as isWithinFirst30DaysOfRegistration in the app: day 0 to day 30 are inside the offer. */
export function isWithinLaunchOffer(registrationIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!registrationIso) return false;
  const reg = new Date(registrationIso);
  if (isNaN(reg.getTime())) return false;
  const days = Math.floor((utcMidnight(now) - utcMidnight(reg)) / 86400000);
  if (days < 0) return true; // clock skew counts as day 0
  return days <= LAUNCH_OFFER_DAYS;
}

/** What a salon must pay, in INR. Decided here, never taken from the app. */
export function priceRupees(planId: CanonicalPlanId, launchOffer: boolean): number {
  const spec = PLAN_SPECS[planId];
  return launchOffer ? spec.launchPrice : spec.regularPrice;
}

/** The amounts an order for this plan may legitimately have (launch or regular price). */
export function acceptableAmountsRupees(planId: CanonicalPlanId): number[] {
  const spec = PLAN_SPECS[planId];
  return Array.from(new Set([spec.launchPrice, spec.regularPrice]));
}

export function planDays(planId: CanonicalPlanId): number {
  return PLAN_SPECS[planId].days;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Orders made before payments were tagged carry the shop's first 8 id characters in their order id ("sf_<8>_<time>"). */
export function legacyOrderBelongsToShop(orderId: string, shopId: string): boolean {
  const prefix = shopId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return prefix.length === 8 && orderId.startsWith(`sf_${prefix}_`);
}

// ---------------------------------------------------------------- Razorpay

export const APP_TAG = "stylefleet";

export interface OrderTarget {
  shopId: string;
  plan: CanonicalPlanId;
}

/** Which shop and plan an order was made for, or null when it is not a StyleFleet order. */
export function orderTargetFromNotes(notes: unknown): OrderTarget | null {
  if (!notes || typeof notes !== "object") return null;
  const n = notes as Record<string, unknown>;
  if (n.app !== APP_TAG) return null;
  const plan = normalizePlanId(n.plan_id);
  if (!isUuid(n.shop_id) || !plan) return null;
  return { shopId: n.shop_id, plan };
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 as lowercase hex, which is how Razorpay writes its signatures. */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Compares without stopping at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Razorpay signs a webhook by HMAC-SHA256 of the exact request body with the webhook secret. */
export async function webhookSignatureIsValid(rawBody: string, signature: string | null, webhookSecret: string): Promise<boolean> {
  if (!signature || !webhookSecret) return false;
  return safeEqual(await hmacSha256Hex(rawBody, webhookSecret), signature.trim().toLowerCase());
}

/** The checkout result is signed with HMAC-SHA256 of "order_id|payment_id" using the key secret. */
export async function checkoutSignatureIsValid(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqual(await hmacSha256Hex(`${orderId}|${paymentId}`, keySecret), signature.trim().toLowerCase());
}

export interface PaidOrder {
  orderId: string;
  paymentId: string | null;
  notes: unknown;
  /** Amount paid, in paise */
  amountPaise: number;
  currency: string | null;
}

export type ActivationResult =
  | { ok: true; subscription: unknown; alreadyActive: boolean }
  | { ok: false; status: number; error: string };

// Only the parts of the Supabase client this file uses
interface Db {
  from: (table: string) => any;
}

/**
 * Turns a paid order into one active subscription.
 * Safe to call any number of times for the same order: the first call saves it, the rest return it.
 */
export async function activatePaidOrder(db: Db, order: PaidOrder, claimedShopId?: string | null): Promise<ActivationResult> {
  const target = orderTargetFromNotes(order.notes);
  if (!target) {
    return { ok: false, status: 422, error: "This payment cannot be matched to a salon. Please contact support." };
  }
  if (claimedShopId && claimedShopId !== target.shopId) {
    return { ok: false, status: 403, error: "This payment belongs to a different salon." };
  }

  const amountPaise = Number(order.amountPaise);
  const allowedPaise = acceptableAmountsRupees(target.plan).map((rupees) => rupees * 100);
  if (!allowedPaise.includes(amountPaise)) {
    return { ok: false, status: 422, error: "The amount paid does not match this plan. Please contact support." };
  }

  const existing = await db.from("subscriptions").select("*").eq("cashfree_order_id", order.orderId).limit(1).maybeSingle();
  if (existing.error) {
    return { ok: false, status: 500, error: "Could not check the subscription. Please try again." };
  }
  if (existing.data) return { ok: true, subscription: existing.data, alreadyActive: true };

  const start = new Date();
  const end = new Date(start.getTime() + planDays(target.plan) * 86400000);

  // The columns are named after the first gateway; they now hold the Razorpay order and payment ids
  const inserted = await db
    .from("subscriptions")
    .insert({
      shop_id: target.shopId,
      plan_id: target.plan,
      status: "active",
      subscription_start_date: start.toISOString(),
      subscription_end_date: end.toISOString(),
      cashfree_order_id: order.orderId,
      cashfree_payment_id: order.paymentId,
      amount_minor: amountPaise,
      currency: order.currency || "INR",
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (inserted.error) {
    // Two calls raced and the other one won: still a single activation
    if (inserted.error.code === "23505") {
      const again = await db.from("subscriptions").select("*").eq("cashfree_order_id", order.orderId).limit(1).maybeSingle();
      if (again.data) return { ok: true, subscription: again.data, alreadyActive: true };
    }
    return {
      ok: false,
      status: 500,
      error: "Your payment was received but the plan could not be activated yet. Please try again in a moment or contact support.",
    };
  }
  return { ok: true, subscription: inserted.data, alreadyActive: false };
}
