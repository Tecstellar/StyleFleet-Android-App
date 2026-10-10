// This Edge Function handles Cashfree payments so the secret key never reaches the app.
//
// Rules it enforces (the app is never trusted for money):
//  - The price is decided here from the plan and the shop's registration date, not taken from the app.
//  - Every order is tagged with its shop and plan when created. A payment can only activate that shop and
//    that plan, and only for an amount that plan can cost.
//  - An order activates a plan once. Asking again returns the plan already activated.
//  - A failed database write is reported as a failure, never as a success.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  acceptableAmountsRupees,
  CanonicalPlanId,
  isUuid,
  isWithinLaunchOffer,
  legacyOrderBelongsToShop,
  normalizePlanId,
  planDays,
  priceRupees,
} from "../_shared/plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { action } = body;

    const appId = Deno.env.get("CASHFREE_APP_ID") || "";
    const secretKey = Deno.env.get("CASHFREE_SECRET_KEY") || "";
    const env = (Deno.env.get("CASHFREE_ENVIRONMENT") || "PRODUCTION").toUpperCase();

    const baseUrl = env === "PRODUCTION" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";

    const cashfreeHeaders = {
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "Content-Type": "application/json",
    };

    // ACTION 1: CREATE ORDER
    if (action === "create-order") {
      const { shopId, planId, expectedAmount, customerName, customerPhone, customerEmail } = body;

      const plan: CanonicalPlanId | null = normalizePlanId(planId);
      if (!plan) return json({ error: "Unknown plan" }, 400);
      if (!isUuid(shopId)) return json({ error: "Missing shop" }, 400);

      // The price depends on when this shop registered, which only the database knows
      const { data: shop, error: shopError } = await supabaseClient
        .from("shops")
        .select("id, created_at")
        .eq("id", shopId)
        .maybeSingle();
      if (shopError || !shop) return json({ error: "Shop not found" }, 404);

      const amount = priceRupees(plan, isWithinLaunchOffer(shop.created_at));

      // The app shows a price; if it differs from the real one, say so instead of charging a surprise
      if (expectedAmount !== undefined && Number(expectedAmount) !== amount) {
        return json(
          { error: `The price for this plan is now ₹${amount.toLocaleString("en-IN")}. Please reopen the plans screen and try again.` },
          409
        );
      }

      const cleanPhone = (customerPhone || "9999999999").replace(/\D/g, "").slice(-10);
      const safeOrderId = `sf_${shopId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}_${Date.now()}`;

      const payload = {
        order_id: safeOrderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: `cust_${shopId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
          customer_name: customerName || "Salon Owner",
          customer_phone: cleanPhone,
          customer_email: customerEmail || "owner@stylefleet.app",
        },
        order_meta: {
          return_url: `stylefleet://payment-callback?order_id=${safeOrderId}`,
        },
        order_note: `StyleFleet Plan: ${plan}`,
        // Read back when the payment is verified, so an order can only ever activate this shop and plan
        order_tags: { shop_id: shopId, plan_id: plan },
      };

      const response = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: cashfreeHeaders,
        body: JSON.stringify(payload),
      });
      const orderData = await response.json();

      if (!response.ok || !orderData.payment_session_id) {
        return json(
          { error: orderData.message || "Failed to create Cashfree order", details: orderData },
          response.status || 400
        );
      }

      return json({
        success: true,
        orderId: safeOrderId,
        cfOrderId: orderData.cf_order_id,
        paymentSessionId: orderData.payment_session_id,
        amount,
      });
    }

    // ACTION 2: VERIFY ORDER & ACTIVATE SUBSCRIPTION
    if (action === "verify-order") {
      const { orderId, shopId: claimedShopId, planId: claimedPlanId } = body;
      if (!orderId || typeof orderId !== "string") return json({ error: "Missing orderId" }, 400);

      const response = await fetch(`${baseUrl}/orders/${orderId}`, { method: "GET", headers: cashfreeHeaders });
      const orderData = await response.json();
      if (!response.ok) {
        return json({ error: orderData.message || "Failed to fetch order from Cashfree" }, response.status || 400);
      }

      if (orderData.order_status !== "PAID") {
        return json({ success: false, status: orderData.order_status, message: "Payment pending or failed" });
      }

      // Which shop and plan was this order made for? Taken from the order itself, not from the app.
      const tags = (orderData.order_tags || {}) as Record<string, string>;
      let shopId: string | null = isUuid(tags.shop_id) ? tags.shop_id : null;
      let plan: CanonicalPlanId | null = normalizePlanId(tags.plan_id);

      if (!shopId || !plan) {
        // Orders made before tagging existed: accept only if the order id itself belongs to the claimed shop
        const legacyPlan = normalizePlanId(claimedPlanId);
        if (isUuid(claimedShopId) && legacyPlan && legacyOrderBelongsToShop(orderId, claimedShopId)) {
          shopId = claimedShopId;
          plan = legacyPlan;
        }
      }
      if (!shopId || !plan) {
        return json({ error: "This payment cannot be matched to a salon. Please contact support." }, 422);
      }

      // The app must be asking about the shop the order was made for
      if (claimedShopId && claimedShopId !== shopId) {
        return json({ error: "This payment belongs to a different salon." }, 403);
      }

      // The amount paid must be a price this plan can have
      const paidRupees = Number(orderData.order_amount);
      if (!acceptableAmountsRupees(plan).includes(paidRupees)) {
        return json({ error: "The amount paid does not match this plan. Please contact support." }, 422);
      }

      // Already activated by an earlier call: return that plan, add nothing
      const existing = await supabaseClient
        .from("subscriptions")
        .select("*")
        .eq("cashfree_order_id", orderId)
        .limit(1)
        .maybeSingle();
      if (existing.error) return json({ error: "Could not check the subscription. Please try again." }, 500);
      if (existing.data) {
        return json({ success: true, status: "PAID", subscription: existing.data, message: "Subscription already active." });
      }

      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + planDays(plan) * 86400000);

      const { data: subData, error: subError } = await supabaseClient
        .from("subscriptions")
        .insert({
          shop_id: shopId,
          plan_id: plan,
          status: "active",
          subscription_start_date: startDate.toISOString(),
          subscription_end_date: endDate.toISOString(),
          cashfree_order_id: orderId,
          cashfree_payment_id: orderData.cf_order_id?.toString() || null,
          amount_minor: Math.round(paidRupees * 100),
          currency: orderData.order_currency || "INR",
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (subError) {
        // Two calls raced and the other one won: that is still a single activation
        if (subError.code === "23505") {
          const again = await supabaseClient.from("subscriptions").select("*").eq("cashfree_order_id", orderId).limit(1).maybeSingle();
          if (again.data) {
            return json({ success: true, status: "PAID", subscription: again.data, message: "Subscription already active." });
          }
        }
        // Paid but not recorded: say so, so the app does not tell the owner it worked
        return json({ error: "Your payment was received but the plan could not be activated yet. Please try again in a moment or contact support." }, 500);
      }

      return json({ success: true, status: "PAID", subscription: subData, message: "Subscription activated successfully!" });
    }

    // ACTION 3: CHECK ORDER (read-only: says whether an order was paid, changes nothing)
    if (action === "check-order") {
      const { orderId } = body;
      if (!orderId || typeof orderId !== "string") return json({ error: "Missing orderId" }, 400);

      const response = await fetch(`${baseUrl}/orders/${orderId}`, { method: "GET", headers: cashfreeHeaders });
      const orderData = await response.json();

      return json({
        success: response.ok,
        paid: response.ok && orderData.order_status === "PAID",
        status: orderData.order_status ?? null,
      });
    }

    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error: any) {
    return json({ error: error.message || "Internal server error" }, 500);
  }
});
