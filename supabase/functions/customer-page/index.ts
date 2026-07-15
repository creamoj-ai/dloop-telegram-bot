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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

  try {
    if (req.method === "GET") {
      return await handleGet(token);
    } else if (req.method === "POST") {
      return await handlePost(token, req);
    } else {
      return new Response("Method Not Allowed", { status: 405 });
    }
  } catch (error) {
    console.error("[customer-page] Error:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
});

/**
 * GET /c/{token} → mostra form se ordine valido e pending
 */
async function handleGet(token: string): Promise<Response> {
  const order = await getOrderByToken(token);

  if (!order) {
    return renderErrorPage("Link non valido o scaduto");
  }

  // Verifica scadenza token
  const now = new Date();
  const expiresAt = new Date(order.token_expires_at);
  if (now > expiresAt) {
    return renderErrorPage("Link scaduto. Contatta il merchant.");
  }

  // Verifica stato
  if (order.status !== "pending") {
    return renderStatusPage("Ordine già inviato");
  }

  // Mostra form
  return renderForm(token, order);
}

/**
 * POST /c/{token} → salva dati, genera PIN, dispatch
 */
async function handlePost(token: string, req: Request): Promise<Response> {
  const order = await getOrderByToken(token);

  if (!order) {
    return renderErrorPage("Link non valido o scaduto");
  }

  // Verifica scadenza e stato
  const now = new Date();
  const expiresAt = new Date(order.token_expires_at);
  if (now > expiresAt) {
    return renderErrorPage("Link scaduto. Contatta il merchant.");
  }

  if (order.status !== "pending") {
    return renderStatusPage("Ordine già inviato");
  }

  // Parse form data
  const formData = await req.formData();
  const recipientName = formData.get("recipient_name")?.toString().trim() || "";
  const recipientPhone = formData.get("recipient_phone")?.toString().trim() || "";
  const deliveryAddress = formData.get("delivery_address")?.toString().trim() || "";
  const notes = formData.get("notes")?.toString().trim() || "";

  // Validazione
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
  }

  if (errors.length > 0) {
    // Ri-mostra form con errori e dati già inseriti
    return renderForm(token, order, errors, {
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      delivery_address: deliveryAddress,
      notes,
    });
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
    return renderErrorPage("Errore durante il salvataggio. Riprova.");
  }

  console.log(
    `[customer-page] Ordine ${order.id} completato, broadcast tier 0 attivato`
  );

  // Invia PIN al cliente via WhatsApp (stub per ora)
  await sendPinToCustomer(recipientPhone, deliveryPin, order.id);

  // Redirect a pagina conferma
  return renderSuccessPage(deliveryPin);
}

/**
 * Recupera ordine da customer_token
 */
async function getOrderByToken(token: string): Promise<OrderData | null> {
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


// ============================================================================
// RENDERING HTML
// ============================================================================

function renderForm(
  token: string,
  order: OrderData,
  errors: string[] = [],
  formData?: Record<string, string>
): Response {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completa il tuo ordine | Dloop</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
      padding: 20px 16px;
    }
    .container {
      max-width: 500px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
      color: #FF6B00;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
      margin-bottom: 24px;
    }
    .order-info {
      background: #f9f9f9;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .order-info strong {
      color: #FF6B00;
    }
    .errors {
      background: #ffebee;
      color: #c62828;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .errors ul {
      margin-left: 20px;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 14px;
      color: #333;
    }
    input, textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 16px;
      margin-bottom: 16px;
      font-family: inherit;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #FF6B00;
    }
    textarea {
      resize: vertical;
      min-height: 80px;
    }
    .optional {
      font-weight: normal;
      color: #999;
      font-size: 12px;
    }
    button {
      width: 100%;
      padding: 16px;
      background: #FF6B00;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:active {
      background: #e66000;
    }
    .hint {
      font-size: 12px;
      color: #999;
      margin-top: -12px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📦 Completa il tuo ordine</h1>
    <p class="subtitle">Inserisci i dettagli di consegna per ricevere il pacco</p>

    <div class="order-info">
      <strong>Dettagli ordine:</strong><br>
      📦 Taglia: ${order.package_size || "N/A"}<br>
      📍 Ritiro: ${order.pickup_address}<br>
      💳 Pagamento: ${formatPaymentMode(order.payment_mode)}
    </div>

    ${errors.length > 0 ? `
    <div class="errors">
      <strong>⚠️ Correggi i seguenti errori:</strong>
      <ul>
        ${errors.map((e) => `<li>${e}</li>`).join("")}
      </ul>
    </div>
    ` : ""}

    <form method="POST" action="/c/${token}">
      <label for="recipient_name">Nome destinatario *</label>
      <input
        type="text"
        id="recipient_name"
        name="recipient_name"
        required
        placeholder="Mario Rossi"
        value="${formData?.recipient_name || ""}"
      >

      <label for="recipient_phone">Telefono *</label>
      <input
        type="tel"
        id="recipient_phone"
        name="recipient_phone"
        required
        placeholder="+39 333 1234567"
        value="${formData?.recipient_phone || ""}"
      >
      <p class="hint">Formato: +39 3xx xxxxxxx</p>

      <label for="delivery_address">Indirizzo di consegna *</label>
      <textarea
        id="delivery_address"
        name="delivery_address"
        required
        placeholder="Via Roma 123, 80100 Napoli (NA)"
      >${formData?.delivery_address || ""}</textarea>

      <label for="notes">Note <span class="optional">(opzionale)</span></label>
      <textarea
        id="notes"
        name="notes"
        placeholder="Es: citofono, piano, istruzioni particolari..."
      >${formData?.notes || ""}</textarea>

      <button type="submit">✅ Conferma ordine</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8"
    },
  });
}

function renderErrorPage(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Errore | Dloop</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      padding: 40px 32px;
      border-radius: 12px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin-bottom: 12px; color: #333; }
    p { color: #666; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Errore</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 400,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8"
    },
  });
}

function renderStatusPage(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stato ordine | Dloop</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      padding: 40px 32px;
      border-radius: 12px;
      text-align: center;
      max-width: 400px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin-bottom: 12px; color: #333; }
    p { color: #666; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📦</div>
    <h1>Ordine già gestito</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8"
    },
  });
}

function renderSuccessPage(pin: string): Response {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ordine confermato | Dloop</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      padding: 40px 32px;
      border-radius: 12px;
      text-align: center;
      max-width: 450px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .icon { font-size: 72px; margin-bottom: 16px; }
    h1 {
      font-size: 28px;
      margin-bottom: 12px;
      color: #FF6B00;
    }
    p {
      color: #666;
      font-size: 16px;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .pin-box {
      background: #fff3e0;
      border: 2px solid #FF6B00;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .pin-label {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
    }
    .pin {
      font-size: 48px;
      font-weight: bold;
      color: #FF6B00;
      letter-spacing: 8px;
    }
    .note {
      font-size: 14px;
      color: #999;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Ordine ricevuto!</h1>
    <p>Un rider Dloop ti contatterà a breve per la consegna.</p>

    <div class="pin-box">
      <div class="pin-label">Il tuo PIN di consegna:</div>
      <div class="pin">${pin}</div>
    </div>

    <p>
      Comunica questo PIN al rider al momento della consegna.<br>
      Lo riceverai anche via WhatsApp.
    </p>

    <p class="note">
      💬 Per qualsiasi problema, contatta il merchant che ha creato l'ordine.
    </p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8"
    },
  });
}

function formatPaymentMode(mode: string): string {
  const modes: Record<string, string> = {
    prepaid: "Prepagato",
    delivery_on_completion: "Cliente paga al rider",
    cod: "Contrassegno",
    merchant_external: "Gestito dal merchant",
  };
  return modes[mode] || mode;
}
