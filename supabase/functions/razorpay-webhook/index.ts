// Razorpay webhook: activates a plan when a payment completes even if the app was closed first.
//
// Deploy WITHOUT the login check, because Razorpay does not send one (the signature is the protection):
//   npx supabase functions deploy razorpay-webhook --no-verify-jwt --project-ref <ref>
// In the Razorpay dashboard add a webhook to
//   https://<ref>.supabase.co/functions/v1/razorpay-webhook
// for the event "order.paid", with a secret you choose, and store that secret as RAZORPAY_WEBHOOK_SECRET.
//
// The Razorpay account is shared with other apps. Orders without the StyleFleet tag are ignored with a 200
// so Razorpay does not keep retrying them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { activatePaidOrder, orderTargetFromNotes, webhookSignatureIsValid } from "../_shared/payments.ts";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
  const rawBody = await req.text();

  // The signature is checked against the exact bytes received, before anything is read from the body
  if (!(await webhookSignatureIsValid(rawBody, req.headers.get("x-razorpay-signature"), webhookSecret))) {
    return reply({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(rawBody);
    if (event?.event !== "order.paid") return reply({ ignored: true, reason: "event not used" });

    const order = event?.payload?.order?.entity;
    const payment = event?.payload?.payment?.entity;
    if (!order?.id) return reply({ ignored: true, reason: "no order" });

    // Another app's payment on the same account: nothing for StyleFleet to do
    if (!orderTargetFromNotes(order.notes)) return reply({ ignored: true, reason: "not a StyleFleet order" });

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const result = await activatePaidOrder(db, {
      orderId: order.id,
      paymentId: payment?.id ?? null,
      notes: order.notes,
      amountPaise: Number(order.amount_paid ?? order.amount),
      currency: order.currency,
    });

    if (result.ok) return reply({ activated: !result.alreadyActive });
    // A problem retrying cannot fix is answered with 200; a temporary one with 500 so Razorpay tries again
    return reply({ error: result.error }, result.status >= 500 ? 500 : 200);
  } catch (error) {
    return reply({ error: (error as Error).message || "Could not read the event" }, 500);
  }
});
