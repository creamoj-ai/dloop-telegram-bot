// ============================================================================
// DLOOP SUPABASE EDGE FUNCTION - STRIPE WEBHOOK
// ============================================================================
// FASE 2: Riceve eventi Stripe → aggiorna order payment_status → notifica merchant
// Deploy: supabase functions deploy stripe-webhook
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.11.0";

// ─────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Get Stripe signature for webhook verification
    const signature = req.headers.get("stripe-signature");
    const body = await req.text();

    if (!signature) {
      console.error("[stripe-webhook] Missing stripe-signature header");
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Verify webhook signature
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    } catch (err) {
      console.error("[stripe-webhook] Webhook signature verification failed:", (err as Error).message);
      return new Response(
        JSON.stringify({ error: "Webhook signature verification failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[stripe-webhook] Event received:", event.type, event.id);

    // 3. Handle checkout.session.completed event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      const dealerId = session.metadata?.dealer_id;

      if (!orderId) {
        console.warn("[stripe-webhook] No order_id in metadata");
        return new Response(
          JSON.stringify({ error: "No order_id in metadata" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[stripe-webhook] Payment completed for order:", orderId);

      // 4. Initialize Supabase (service_role auto-injected by Supabase)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // 5. Update order payment status
      const { data: orderData, error: updateError } = await supabase
        .from("merchant_orders")
        .update({
          payment_status: "completed",
          stripe_payment_intent_id: session.payment_intent as string,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .select("id, dealer_id, total_with_fee, items")
        .single();

      if (updateError || !orderData) {
        console.error("[stripe-webhook] Failed to update order:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update order", details: updateError?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[stripe-webhook] Order updated:", orderId);

      // 6. Get dealer info for notification
      const { data: dealerData, error: dealerError } = await supabase
        .from("dealers")
        .select("business_name, telegram_chat_id")
        .eq("id", orderData.dealer_id)
        .single();

      if (dealerError || !dealerData || !dealerData.telegram_chat_id) {
        console.warn("[stripe-webhook] Dealer not found or no telegram_chat_id");
        // Don't fail the webhook, order is already updated
        return new Response(
          JSON.stringify({ success: true, order_id: orderId, notification_sent: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 7. Send Telegram notification to merchant
      const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
      const notificationSent = await sendPaymentConfirmation(
        telegramBotToken,
        Number(dealerData.telegram_chat_id),
        {
          orderId: orderId,
          storeName: dealerData.business_name,
          totalAmount: orderData.total_with_fee,
          items: orderData.items,
        }
      );

      // 8. Success response
      return new Response(
        JSON.stringify({
          success: true,
          order_id: orderId,
          notification_sent: notificationSent,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Other event types - just acknowledge
    return new Response(
      JSON.stringify({ received: true, event_type: event.type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[stripe-webhook] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// HELPER: Send payment confirmation to merchant
// ─────────────────────────────────────────────────────────────────────────

async function sendPaymentConfirmation(
  botToken: string,
  chatId: number,
  data: {
    orderId: string;
    storeName: string;
    totalAmount: number;
    items: any[];
  }
): Promise<boolean> {
  const itemsList = data.items
    .map((i: any) => `- ${i.quantity}x ${i.name}`)
    .join("\n");

  const message = `PAGAMENTO RICEVUTO

Negozio: ${data.storeName}
Ordine ID: ${data.orderId.substring(0, 8)}

Items:
${itemsList}

IMPORTO PAGATO: EUR ${data.totalAmount.toFixed(2)}

Ordine pronto per dispatch al rider.`.trim();

  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Telegram API] Error:", result);
      return false;
    }

    console.log("[Telegram API] Payment confirmation sent:", result.result?.message_id);
    return true;

  } catch (err) {
    console.error("[Telegram API] Request failed:", err);
    return false;
  }
}

// ============================================================================
// DEPLOY INSTRUCTIONS:
//
// 1. Deploy function:
//    supabase functions deploy stripe-webhook
//
// 2. Set secrets (if not already set):
//    supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
//    supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxx
//
// 3. Configure Stripe webhook:
//    - Dashboard → Developers → Webhooks → Add endpoint
//    - URL: https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/stripe-webhook
//    - Events: checkout.session.completed
//    - Copy webhook signing secret → set as STRIPE_WEBHOOK_SECRET
//
// 4. Test:
//    - Create payment via whatsapp-webhook
//    - Complete payment on Stripe
//    - Check merchant receives confirmation
// ============================================================================
