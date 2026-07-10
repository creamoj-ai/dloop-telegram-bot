// ============================================================================
// DLOOP SAAS — WHATSAPP INTAKE (Stub isolato)
// ============================================================================
// Punto di ingresso per ordini dal WABA (WhatsApp Business Account) del merchant.
// Webhook registrato ma non attivo finché WHATSAPP_INTAKE_ENABLED !== "true".
//
// Attivare quando Cloud API è pronta:
//   supabase secrets set WHATSAPP_INTAKE_ENABLED=true
//
// Flusso previsto (da implementare):
//   1. Verifica firma HMAC (x-hub-signature-256)
//   2. Parse payload → InboundOrder
//   3. createDeliveryOrder(order) — logica da condividere con telegram-webhook
//   4. assignRider(bot, orderId)
//   5. notifyMerchant(bot, "new_order", orderId)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Struttura ordine atteso in ingresso
interface InboundOrder {
  merchant_id: string;       // UUID merchant in Dloop
  pickup_point: string;      // Indirizzo ritiro
  delivery_address: string;  // Indirizzo consegna
  recipient_name: string;
  recipient_phone: string;   // Formato E.164 (+39...)
  time_window?: string;      // "14:00-16:00" — opzionale
  notes?: string;
  payment_mode?: "delivery_on_completion" | "cod" | "prepaid";
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (Deno.env.get("WHATSAPP_INTAKE_ENABLED") !== "true") {
    return new Response(
      JSON.stringify({ error: "WhatsApp intake non ancora attivo", code: "NOT_IMPLEMENTED" }),
      { status: 501, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // Verifica firma HMAC — obbligatoria quando attivo
  // TODO: implementare con WHATSAPP_WEBHOOK_SECRET
  // const sig = req.headers.get("x-hub-signature-256");
  // if (!verifyHmac(await req.clone().text(), sig)) return 401;

  try {
    const body: InboundOrder = await req.json();

    if (
      !body.merchant_id || !body.pickup_point || !body.delivery_address ||
      !body.recipient_name || !body.recipient_phone
    ) {
      return new Response(
        JSON.stringify({ error: "Campi obbligatori mancanti" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    console.log("[wa-intake] Ordine ricevuto:", JSON.stringify(body));
    // TODO: createDeliveryOrder(body) + assignRider + notifyMerchant

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Payload non valido" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
