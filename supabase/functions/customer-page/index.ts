// ============================================================================
// DLOOP SAAS — CUSTOMER PAGE (form completamento ordine)
// ============================================================================
// GET  /c/{token} → form HTML mobile-first per cliente
// POST /c/{token} → salva dati, genera PIN, invia WA, dispatch rider
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Configurazione
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

// CORS headers (chiamate da https://dloop.it)
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://dloop.it",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

interface OrderData {
  id: string;
  dealer_contact_id: string; // FK to dealers (schema uses dealer_contact_id)
  pickup_address: string; // Text address (schema uses pickup_address)
  payment_mode: string;
  package_size: string;
  package_count: number;
  is_fragile: boolean;
  customer_token: string;
  token_expires_at: string;
  status: string;
  dropoff_address?: string; // Schema uses dropoff_address for delivery
  customer_name?: string; // Schema uses customer_name
  customer_phone?: string; // Schema uses customer_phone
  notes?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Supabase Edge Functions include function name in pathname
  // Remove "/customer-page" prefix to get relative path
  const relativePath = url.pathname.replace(/^\/customer-page/, '');

  const pathMatch = relativePath.match(/^\/c\/([a-z0-9]+)$/);

  if (!pathMatch) {
    return new Response("Not Found", { status: 404 });
  }

  const token = pathMatch[1];

  // Create Supabase client for this request (uses service role to allow anonymous access)
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  try {
    if (req.method === "GET") {
      return await handleGet(token, supabaseClient);
    } else if (req.method === "POST") {
      return await handlePost(token, req, supabaseClient);
    } else {
      return new Response("Method Not Allowed", { status: 405 });
    }
  } catch (error) {
    console.error("[customer-page] Error:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }
});

/**
 * GET /c/{token} → ritorna JSON con info ordine o errore
 */
async function handleGet(token: string, supabase: any): Promise<Response> {
  const order = await getOrderByToken(token, supabase);

  if (!order) {
    return new Response(
      JSON.stringify({ valid: false, reason: "not_found" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Verifica scadenza token
  const now = new Date();
  const expiresAt = new Date(order.token_expires_at);
  if (now > expiresAt) {
    return new Response(
      JSON.stringify({ valid: false, reason: "expired" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Verifica stato (ordine già compilato = customer_name valorizzato)
  if (order.status !== "pending" || order.customer_name) {
    return new Response(
      JSON.stringify({
        valid: false,
        reason: "already_sent",
        pin: order.delivery_pin || undefined  // Includi PIN se esiste
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Ritorna dati ordine (solo campi necessari per il form, no dati sensibili)
  return new Response(
    JSON.stringify({
      valid: true,
      order: {
        package_size: order.package_size,
        package_count: order.package_count,
        is_fragile: order.is_fragile,
        pickup_address: order.pickup_address,
        payment_mode: order.payment_mode,
      },
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * POST /c/{token} → salva dati JSON, genera PIN, dispatch, ritorna JSON
 */
async function handlePost(token: string, req: Request, supabase: any): Promise<Response> {
  const order = await getOrderByToken(token, supabase);

  if (!order) {
    return new Response(
      JSON.stringify({ success: false, error: "Link non valido o scaduto" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Verifica scadenza e stato
  const now = new Date();
  const expiresAt = new Date(order.token_expires_at);
  if (now > expiresAt) {
    return new Response(
      JSON.stringify({ success: false, error: "Link scaduto. Contatta il merchant." }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (order.status !== "pending" || order.customer_name) {
    return new Response(
      JSON.stringify({ success: false, error: "Ordine già inviato" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Parse JSON body
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: "Body JSON non valido" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const recipientName = body.recipient_name?.toString().trim() || "";
  const recipientPhone = body.recipient_phone?.toString().trim() || "";
  const deliveryAddress = body.delivery_address?.toString().trim() || "";
  const notes = body.notes?.toString().trim() || "";

  // Validazione (stessa logica di prima)
  const errors: string[] = [];

  if (!recipientName) {
    errors.push("Nome destinatario obbligatorio");
  }

  if (!recipientPhone) {
    errors.push("Telefono obbligatorio");
  } else if (!isValidItalianPhone(recipientPhone)) {
    errors.push("Telefono non valido (inserisci numero italiano valido)");
  }

  if (!deliveryAddress) {
    errors.push("Indirizzo di consegna obbligatorio");
  } else if (!isValidAddress(deliveryAddress)) {
    errors.push("Inserisci indirizzo completo: via, civico, città o CAP");
  }

  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ success: false, error: errors.join(", ") }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Genera PIN 4 cifre
  const deliveryPin = generatePin();

  // Update ordine: compila dati cliente + trigger broadcast
  // Setta broadcast_tier=0 e broadcast_started_at per triggerare escalation-tick
  const updateData: Record<string, unknown> = {
    dropoff_address: deliveryAddress, // Schema uses dropoff_address
    customer_name: recipientName, // Schema uses customer_name
    customer_phone: recipientPhone, // Schema uses customer_phone
    status: "pending", // Rimane pending, escalation-tick gestirà il broadcast
    delivery_pin: deliveryPin,
    broadcast_tier: 0, // Tier iniziale (top reputation)
    broadcast_started_at: new Date().toISOString(), // Trigger broadcast
  };

  // Add notes only if column exists (might not be in schema)
  if (notes) {
    updateData.customer_address = deliveryAddress; // Use customer_address for full details if notes doesn't exist
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", order.id);

  if (updateError) {
    console.error("[customer-page] Update error:", updateError);
    return new Response(
      JSON.stringify({ success: false, error: "Errore durante il salvataggio. Riprova." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  console.log(
    `[customer-page] Ordine ${order.id} completato, broadcast tier 0 attivato`
  );

  // Invia PIN al cliente via WhatsApp (stub per ora)
  await sendPinToCustomer(recipientPhone, deliveryPin, order.id);

  // Ritorna success con PIN (WhatsApp è stub, frontend lo mostrerà)
  return new Response(
    JSON.stringify({ success: true, pin: deliveryPin }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Recupera ordine da customer_token
 */
async function getOrderByToken(token: string, supabase: any): Promise<OrderData | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_token", token)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as OrderData;
}

/**
 * Validazione telefono italiano
 * Accetta formati: +39..., 39..., 3...
 */
function isValidItalianPhone(phone: string): boolean {
  // Rimuovi spazi e trattini
  const clean = phone.replace(/[\s\-]/g, "");

  // Pattern: +393xxxxxxxx, 393xxxxxxxx, 3xxxxxxxx (9-10 cifre)
  const pattern = /^(\+39|39)?3\d{8,9}$/;
  return pattern.test(clean);
}

/**
 * Validazione indirizzo completo
 * Deve contenere almeno un numero E (una città O un CAP 5 cifre)
 */
function isValidAddress(address: string): boolean {
  // Deve contenere almeno un numero (civico)
  const hasNumber = /\d/.test(address);
  if (!hasNumber) return false;

  // Deve contenere una città (parola di almeno 3 lettere) O un CAP (5 cifre)
  const hasCity = /[a-zA-ZÀ-ÿ]{3,}/.test(address);
  const hasCAP = /\b\d{5}\b/.test(address);

  return hasCity || hasCAP;
}

/**
 * Genera PIN 4 cifre random
 */
function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Invia PIN al cliente via WhatsApp (riusa logica esistente)
 * NOTA: Per ora stub, sarà attivo quando CUSTOMER_WA_ENABLED=true
 */
async function sendPinToCustomer(
  phone: string,
  pin: string,
  orderId: string
): Promise<void> {
  if (Deno.env.get("CUSTOMER_WA_ENABLED") !== "true") {
    console.log(
      `[customer-page] WA stub: PIN ${pin} per ${phone} (ordine ${orderId})`
    );
    return;
  }

  // TODO: Implementare invio via WhatsApp Cloud API
  // const WA_PHONE_ID = Deno.env.get("WA_PHONE_ID");
  // const WA_ACCESS_TOKEN = Deno.env.get("WA_ACCESS_TOKEN");
  //
  // await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `Bearer ${WA_ACCESS_TOKEN}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     messaging_product: "whatsapp",
  //     to: phone,
  //     type: "text",
  //     text: { body: `Il tuo codice PIN per la consegna è: ${pin}` }
  //   })
  // });

  console.log(`[customer-page] PIN ${pin} inviato a ${phone}`);
}
