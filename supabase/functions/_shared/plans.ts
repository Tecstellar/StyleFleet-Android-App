// Plan prices and the launch-offer rule, as the payment function needs them.
// The app shows prices from src/config/planConfig.ts; __tests__/payment_server_rules.test.ts fails
// if the two ever disagree, so change both together.
// No imports on purpose: this file runs in Deno (Edge Function) and in Jest.

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
