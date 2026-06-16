// ============================================================================
// DLOOP SUPABASE EDGE FUNCTION - WHATSAPP WEBHOOK
// ============================================================================
// FASE 2: Riceve ordini → crea order → genera Payment Link → notifica Telegram
// Deploy: supabase functions deploy whatsapp-webhook
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.11.0";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

interface Dealer {
  id: string;
  business_name: string;
  telegram_chat_id: number | null;
  whatsapp_number: string | null;
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  dealer_id: string;
  customer_phone: string;
  items: OrderItem[];
  total_amount: number;
  stripe_fee_amount: number;
  total_with_fee: number;
  stripe_payment_link: string;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Parse request
    const url = new URL(req.url);
    const text = url.searchParams.get("text") || "";
    const phone = url.searchParams.get("phone") || "";

    console.log("[whatsapp-webhook] Received:", { text, phone });

    if (!text || !phone) {
      return new Response(
        JSON.stringify({ error: "Missing 'text' or 'phone' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Initialize clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 3. Parse order from text (rule-based POC)
    const { storeName, items } = parseOrder(text);
    console.log("[whatsapp-webhook] Parsed:", { storeName, items });

    if (!storeName || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Cannot parse order from text", text }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Lookup dealer
    const { data: dealers, error: dbError } = await supabase
      .from("dealers")
      .select("id, business_name, telegram_chat_id, whatsapp_number")
      .ilike("business_name", `%${storeName}%`)
      .eq("status", "active")
      .limit(1);

    if (dbError || !dealers || dealers.length === 0) {
      console.error("[whatsapp-webhook] Dealer not found:", storeName);
      return new Response(
        JSON.stringify({ error: "Store not found", storeName }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dealer = dealers[0] as Dealer;

    if (!dealer.telegram_chat_id) {
      return new Response(
        JSON.stringify({ error: "Dealer not configured for Telegram", dealer: dealer.business_name }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Calculate totals
    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const stripeFee = Math.round(totalAmount * 0.035 * 100) / 100; // 3.5%
    const totalWithFee = totalAmount + stripeFee;

    // 6. Create order in database
    const { data: orderData, error: orderError } = await supabase
      .from("merchant_orders")
      .insert({
        dealer_id: dealer.id,
        customer_phone: phone,
        items: items,
        total_amount: totalAmount,
        stripe_fee_amount: stripeFee,
        total_with_fee: totalWithFee,
        status: "pending",
        payment_status: "pending",
      })
      .select("id")
      .single();

    if (orderError || !orderData) {
      console.error("[whatsapp-webhook] Failed to create order:", orderError);
      return new Response(
        JSON.stringify({ error: "Failed to create order", details: orderError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderId = orderData.id;
    console.log("[whatsapp-webhook] Order created:", orderId);

    // 7. Generate Stripe Payment Link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: Math.round(totalWithFee * 100), // cents
            product_data: {
              name: `Ordine #${orderId.substring(0, 8)}`,
              description: items.map(i => `${i.quantity}x ${i.name}`).join(", "),
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        order_id: orderId,
        dealer_id: dealer.id,
        customer_phone: phone,
      },
      after_completion: {
        type: "redirect",
        redirect: {
          url: `https://dloop.app/order/${orderId}/success`, // TODO: real URL
        },
      },
    });

    console.log("[whatsapp-webhook] Payment link created:", paymentLink.url);

    // 8. Update order with payment link
    await supabase
      .from("merchant_orders")
      .update({ stripe_payment_link: paymentLink.url })
      .eq("id", orderId);

    // 9. Send Telegram notification to merchant
    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    console.log("[whatsapp-webhook] Sending Telegram to chat_id:", dealer.telegram_chat_id);
    const notificationSent = await sendTelegramNotification(
      telegramBotToken,
      Number(dealer.telegram_chat_id),
      {
        orderId: orderId,
        storeName: dealer.business_name,
        customerPhone: phone,
        items: items,
        totalAmount: totalAmount,
        stripeFee: stripeFee,
        totalWithFee: totalWithFee,
        paymentLink: paymentLink.url,
      }
    );

    if (!notificationSent) {
      console.warn("[whatsapp-webhook] Failed to send Telegram notification");
    }

    // 10. Success response
    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
        dealer: dealer.business_name,
        total: totalWithFee,
        payment_link: paymentLink.url,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[whatsapp-webhook] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// HELPER: Parse order from text (rule-based POC)
// ─────────────────────────────────────────────────────────────────────────

function parseOrder(text: string): { storeName: string | null; items: OrderItem[] } {
  // Pattern: "Ordina_Yamamay_Pizza" → store: "Yamamay", item: "Pizza"
  const pattern = /^Ordina[_\s]+([^_\s]+)(?:[_\s]+(.+))?$/i;
  const match = text.match(pattern);

  if (!match) {
    return { storeName: null, items: [] };
  }

  const storeName = match[1];
  const itemName = match[2] || "Default Item";

  // POC: prezzo fisso €10 per item
  const items: OrderItem[] = [
    {
      name: itemName,
      quantity: 1,
      price: 10.00,
    },
  ];

  return { storeName, items };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER: Send Telegram notification
// ─────────────────────────────────────────────────────────────────────────

async function sendTelegramNotification(
  botToken: string,
  chatId: number,
  data: {
    orderId: string;
    storeName: string;
    customerPhone: string;
    items: OrderItem[];
    totalAmount: number;
    stripeFee: number;
    totalWithFee: number;
    paymentLink: string;
  }
): Promise<boolean> {
  const itemsList = data.items
    .map(i => `- ${i.quantity}x ${i.name} - EUR ${i.price.toFixed(2)}`)
    .join("\n");

  const message = `NUOVO ORDINE DA WHATSAPP

Negozio: ${data.storeName}
Cliente: ${data.customerPhone}
Ordine ID: ${data.orderId.substring(0, 8)}

Items:
${itemsList}

Subtotale: EUR ${data.totalAmount.toFixed(2)}
Fee Stripe: EUR ${data.stripeFee.toFixed(2)}
TOTALE: EUR ${data.totalWithFee.toFixed(2)}

Payment Link:
${data.paymentLink}

In attesa di pagamento...`.trim();

  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  console.log("[Telegram] Sending to chat_id:", chatId, "type:", typeof chatId);

  try {
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Telegram API] Error:", result);
      return false;
    }

    console.log("[Telegram API] Message sent:", result.result?.message_id);
    return true;

  } catch (err) {
    console.error("[Telegram API] Request failed:", err);
    return false;
  }
}
