// Razorpay payments for StyleFleet. The key secret lives only here, never in the app.
//
// Rules (the app is never trusted for money):
//  - The price is decided here from the plan and the shop's registration date; the app's price is a cross-check.
//  - Every order is tagged { app: "stylefleet", shop_id, plan_id } because the Razorpay account is shared
//    with other apps. A payment can only activate the shop and plan it was made for.
//  - A paid order activates a plan once; asking again returns the plan already activated.
//  - A failed database write is reported as a failure, never as a success.
//
// Secrets to set: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (the webhook secret belongs to razorpay-webhook).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isUuid, isWithinLaunchOffer, normalizePlanId, priceRupees } from "../_shared/payments.ts";
import { activatePaidOrder, APP_TAG } from "../_shared/payments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const API = "https://api.razorpay.com/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    if (!keyId || !keySecret) return json({ error: "Payments are not set up yet. Please contact support." }, 503);

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const rzpHeaders = {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
    };

    const body = await req.json();
    const { action } = body;

    // ACTION 1: CREATE ORDER
    if (action === "create-order") {
      const { shopId, planId, expectedAmount, customerName, customerPhone, customerEmail } = body;

      const plan = normalizePlanId(planId);
      if (!plan) return json({ error: "Unknown plan" }, 400);
      if (!isUuid(shopId)) return json({ error: "Missing shop" }, 400);

      // The price depends on when this shop registered, which only the database knows
      const { data: shop, error: shopError } = await db.from("shops").select("id, created_at").eq("id", shopId).maybeSingle();
      if (shopError || !shop) return json({ error: "Shop not found" }, 404);

      const amountRupees = priceRupees(plan, isWithinLaunchOffer(shop.created_at));

      // If the price the owner saw is not the real one, say so instead of charging a surprise
      if (expectedAmount !== undefined && Number(expectedAmount) !== amountRupees) {
        return json(
          { error: `The price for this plan is now ₹${amountRupees.toLocaleString("en-IN")}. Please reopen the plans screen and try again.` },
          409
        );
      }

      const response = await fetch(`${API}/orders`, {
        method: "POST",
        headers: rzpHeaders,
        body: JSON.stringify({
          amount: amountRupees * 100,
          currency: "INR",
          receipt: `sf_${shopId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}_${Date.now()}`,
          notes: { app: APP_TAG, shop_id: shopId, plan_id: plan },
        }),
      });
      const order = await response.json();

      if (!response.ok || !order.id) {
        return json({ error: order?.error?.description || "Failed to create the payment order" }, response.status || 400);
      }

      return json({
        success: true,
        orderId: order.id,
        amountPaise: order.amount,
        currency: order.currency,
        keyId, // public by design: the app needs it to open the checkout
        customer: { name: customerName || "", phone: String(customerPhone || "").replace(/\D/g, "").slice(-10), email: customerEmail || "" },
      });
    }

    // ACTIONS 2 and 3 look the order up with Razorpay, which is the source of truth for "paid"
    if (action === "verify-payment" || action === "check-order") {
      const { orderId, shopId: claimedShopId } = body;
      if (!orderId || typeof orderId !== "string" || !/^order_[A-Za-z0-9]+$/.test(orderId)) {
        return json({ error: "Missing or invalid orderId" }, 400);
      }

      const response = await fetch(`${API}/orders/${orderId}`, { headers: rzpHeaders });
      const order = await response.json();
      if (!response.ok) {
        return json({ error: order?.error?.description || "Failed to fetch the order from Razorpay" }, response.status || 400);
      }

      const paid = order.status === "paid";

      if (action === "check-order") {
        return json({ success: true, paid, status: order.status ?? null });
      }

      if (!paid) {
        return json({ success: false, status: order.status, message: "Payment pending or failed" });
      }

      // The payment id is only recorded for reference
      let paymentId: string | null = null;
      try {
        const paymentsRes = await fetch(`${API}/orders/${orderId}/payments`, { headers: rzpHeaders });
        const payments = await paymentsRes.json();
        paymentId = payments?.items?.find((p: { status?: string; id?: string }) => p.status === "captured")?.id ?? null;
      } catch {
        // not needed to activate
      }

      const result = await activatePaidOrder(
        db,
        {
          orderId,
          paymentId,
          notes: order.notes,
          amountPaise: Number(order.amount_paid ?? order.amount),
          currency: order.currency,
        },
        isUuid(claimedShopId) ? claimedShopId : null
      );

      if (!result.ok) return json({ error: result.error }, result.status);
      return json({
        success: true,
        status: "PAID",
        subscription: result.subscription,
        message: result.alreadyActive ? "Subscription already active." : "Subscription activated successfully!",
      });
    }

    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    return json({ error: (error as Error).message || "Internal server error" }, 500);
  }
});
