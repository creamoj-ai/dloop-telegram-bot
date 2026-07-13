// ============================================================================
// DLOOP MINI APP — CREATE ORDER EDGE FUNCTION
// ============================================================================
// Endpoint POST per creazione ordini da Telegram Mini App
// Valida initData HMAC, crea ordine, dispatch rider, notifica merchant
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { validateTelegramInitData, safeLogInitData } from "./validate-init-data.ts";

// Configurazione
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://web.telegram.org",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

/**
 * Helper: crea ordine + deduce token
 * (Semplificato da order-service.ts per evitare circular import)
 */
async function createDeliveryOrder(orderDraft: any): Promise<string> {
  const orderId = crypto.randomUUID();

  // 1. Crea ordine (usa nomi colonne corretti dello schema)
  const { error: insertError } = await supabase.from("orders").insert({
    id: orderId,
    dealer_contact_id: orderDraft.merchant_id, // merchant_id → dealer_contact_id
    pickup_address: orderDraft.pickup_point,
    customer_address: orderDraft.delivery_address, // delivery_address → customer_address
    customer_name: orderDraft.recipient_name, // recipient_name → customer_name
    customer_phone: orderDraft.recipient_phone, // recipient_phone → customer_phone
    payment_mode: orderDraft.payment_mode || "delivery_on_completion",
    source: "telegram_miniapp",
    status: "pending",
    package_size: orderDraft.package_size || null,
    package_count: orderDraft.package_count || 1,
    is_fragile: orderDraft.is_fragile || false,
    created_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error("[miniapp-create-order] Insert error:", insertError);
    throw new Error(`Errore creazione ordine: ${insertError.message}`);
  }

  // 2. Deduce token
  const { error: tokenError } = await supabase.rpc("deduct_token", {
    p_merchant_id: orderDraft.merchant_id,
    p_order_id: orderId,
  });

  if (tokenError) {
    // Rollback
    await supabase.from("orders").delete().eq("id", orderId);
    console.error("[miniapp-create-order] Token deduction error:", tokenError);
    throw new Error("Saldo token insufficiente");
  }

  console.log(`[miniapp-create-order] Ordine ${orderId} creato, 1 token dedotto`);
  return orderId;
}

/**
 * Helper: notifica merchant conferma ordine
 */
async function notifyMerchant(
  telegramUserId: number,
  orderId: string,
  recipientName: string,
  deliveryAddress: string,
  packageSize: string | null
) {
  try {
    const trackingUrl = `https://dloop.it/t/${orderId}`;
    const message = `Ordine creato. I dlooper lo stanno vedendo.

ID: #${orderId.slice(0, 8).toUpperCase()}
Destinatario: ${recipientName}
Consegna: ${deliveryAddress}
${packageSize ? `Taglia: ${packageSize}` : ""}

📍 Traccia: ${trackingUrl}`;

    // Usa fetch diretto invece di grammY per evitare dipendenze pesanti
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        text: message,
      }),
    });
  } catch (err) {
    console.error("[miniapp-create-order] Notify merchant error:", err);
    // Non bloccante: ordine già creato
  }
}

/**
 * Main handler
 */
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Solo POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    // Parse body
    const body = await req.json();
    const {
      initData,
      action, // Opzionale: 'get_merchant' per solo fetch dati
      packageSize,
      packageCount,
      isFragile,
      pickupAddress,
      deliveryAddress,
      recipientName,
      recipientPhone,
      timeWindow,
      notes,
    } = body;

    console.log("[miniapp-create-order] Request received:", {
      initData: safeLogInitData(initData || ""),
      packageSize,
      packageCount,
      recipientName,
    });

    // 1. Valida initData HMAC (CRITICO)
    if (!initData || typeof initData !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid initData" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const validation = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);

    if (!validation.valid || !validation.userId) {
      console.error("[miniapp-create-order] Validation failed:", validation.error);
      return new Response(
        JSON.stringify({
          error: "Invalid Telegram authentication",
          details: validation.error,
        }),
        { status: 401, headers: corsHeaders }
      );
    }

    console.log("[miniapp-create-order] Validation OK, userId:", validation.userId);

    // 2. Fetch merchant da telegram_user_id
    const { data: merchant, error: merchantError } = await supabase
      .from("dealers")
      .select("id, business_name, mode, default_payment_mode, address")
      .eq("telegram_user_id", validation.userId)
      .maybeSingle();

    if (merchantError || !merchant) {
      console.error("[miniapp-create-order] Merchant not found:", validation.userId);
      return new Response(
        JSON.stringify({ error: "Merchant not found" }),
        { status: 403, headers: corsHeaders }
      );
    }

    console.log("[miniapp-create-order] Merchant found:", merchant.business_name);

    // 2b. Se action=get_merchant, restituisce solo dati merchant (per prefill)
    if (action === 'get_merchant') {
      return new Response(
        JSON.stringify({
          merchant_address: merchant.address || null,
          merchant_name: merchant.business_name,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 3. Valida campi obbligatori
    if (!deliveryAddress || !recipientName || !recipientPhone) {
      return new Response(
        JSON.stringify({ error: "Campi obbligatori mancanti" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validazione telefono (basic)
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    if (!phoneRegex.test(recipientPhone)) {
      return new Response(
        JSON.stringify({ error: "Formato telefono non valido. Usa +393XXXXXXXXX" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. Crea ordine + deduce token
    const orderDraft = {
      merchant_id: merchant.id,
      pickup_point: pickupAddress || merchant.address || "Indirizzo ritiro non specificato",
      delivery_address: deliveryAddress, // Sarà mappato a customer_address
      recipient_name: recipientName, // Sarà mappato a customer_name
      recipient_phone: recipientPhone, // Sarà mappato a customer_phone
      payment_mode: merchant.default_payment_mode || "delivery_on_completion",
      package_size: packageSize || null,
      package_count: packageCount || 1,
      is_fragile: isFragile || false,
    };

    let orderId: string;
    try {
      orderId = await createDeliveryOrder(orderDraft);
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error("[miniapp-create-order] Create order error:", errMsg);

      // Errore specifico token insufficienti
      if (errMsg.includes("token")) {
        return new Response(
          JSON.stringify({ error: "Saldo token insufficiente" }),
          { status: 402, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log("[miniapp-create-order] Order created:", orderId);

    // 5. Trigger dispatch rider (non bloccante)
    // NOTA: Il dispatch usa il flusso esistente broadcast/escalation
    // Se dispatch fallisce, l'escalation-tick cron recupera l'ordine
    try {
      // Il dispatch è gestito da trigger DB o cron, non chiamato direttamente qui
      // per evitare timeout della Mini App. L'ordine con status=pending viene
      // processato automaticamente dal sistema.
      console.log("[miniapp-create-order] Order pending dispatch:", orderId);
    } catch (err) {
      console.error("[miniapp-create-order] Dispatch warning (non-blocking):", err);
    }

    // 6. Notifica merchant conferma
    notifyMerchant(
      validation.userId,
      orderId,
      recipientName,
      deliveryAddress,
      packageSize
    );

    // 7. Response al frontend
    const trackingUrl = `https://dloop.it/t/${orderId}`;

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        trackingUrl,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[miniapp-create-order] Unhandled error:", err);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: (err as Error).message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
