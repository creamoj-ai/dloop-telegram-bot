// ============================================================================
// DLOOP SUPABASE EDGE FUNCTION - WHATSAPP WEBHOOK
// ============================================================================
// Riceve ordini da WhatsApp → routing merchant → notifica Telegram
// Deploy: supabase functions deploy whatsapp-webhook
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

interface Dealer {
  id: string;
  business_name: string;
  telegram_chat_id: bigint | null;
  whatsapp_number: string | null;
}

interface WebhookPayload {
  text?: string; // es: "Ordina_Yamamay" o testo libero
  phone?: string; // numero cliente WhatsApp
  message_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Parse request
    const url = new URL(req.url);
    const text = url.searchParams.get("text") || "";
    const phone = url.searchParams.get("phone") || "";

    console.log("[whatsapp-webhook] Received:", { text, phone });

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Missing 'text' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Parse store name from text (rule-based)
    const storeName = extractStoreName(text);
    console.log("[whatsapp-webhook] Extracted store name:", storeName);

    if (!storeName) {
      return new Response(
        JSON.stringify({ error: "Cannot extract store name from text", text }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Lookup dealer in database
    const { data: dealers, error: dbError } = await supabase
      .from("dealers")
      .select("id, business_name, telegram_chat_id, whatsapp_number")
      .ilike("business_name", `%${storeName}%`)
      .eq("status", "active")
      .limit(2); // Limit 2 per detectare ambiguità

    if (dbError) {
      console.error("[whatsapp-webhook] DB error:", dbError);
      return new Response(
        JSON.stringify({ error: "Database error", details: dbError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!dealers || dealers.length === 0) {
      console.warn("[whatsapp-webhook] No dealer found for:", storeName);
      // TODO: Fallback Haiku per disambiguazione
      return new Response(
        JSON.stringify({ error: "Store not found", storeName }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (dealers.length > 1) {
      console.warn("[whatsapp-webhook] Multiple dealers found:", dealers.map(d => d.business_name));
      // TODO: Fallback Haiku per selezione
      return new Response(
        JSON.stringify({ error: "Ambiguous store name", matches: dealers.map(d => d.business_name) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dealer = dealers[0] as Dealer;

    if (!dealer.telegram_chat_id) {
      console.error("[whatsapp-webhook] Dealer has no telegram_chat_id:", dealer.id);
      return new Response(
        JSON.stringify({ error: "Dealer not configured for Telegram", dealer: dealer.business_name }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Send Telegram notification
    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const notificationSent = await sendTelegramNotification(
      telegramBotToken,
      dealer.telegram_chat_id,
      {
        storeName: dealer.business_name,
        customerPhone: phone,
        orderText: text,
      }
    );

    if (!notificationSent) {
      return new Response(
        JSON.stringify({ error: "Failed to send Telegram notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Success response
    return new Response(
      JSON.stringify({
        success: true,
        dealer: dealer.business_name,
        notified: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[whatsapp-webhook] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// HELPER: Extract store name from text
// ─────────────────────────────────────────────────────────────────────────

function extractStoreName(text: string): string | null {
  // Pattern 1: "Ordina_NegozioX" → extract "NegozioX"
  const pattern1 = /^Ordina[_\s]+(.+)$/i;
  const match1 = text.match(pattern1);
  if (match1) return match1[1].trim();

  // Pattern 2: "Ordine per: NegozioX" → extract "NegozioX"
  const pattern2 = /ordine\s+per[:\s]+(.+)$/i;
  const match2 = text.match(pattern2);
  if (match2) return match2[1].trim();

  // Pattern 3: Direct store name (fallback)
  // Se il testo non ha prefissi, assumiamo sia il nome del negozio
  if (text.length > 3 && !text.includes("http")) {
    return text.trim();
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER: Send Telegram notification
// ─────────────────────────────────────────────────────────────────────────

async function sendTelegramNotification(
  botToken: string,
  chatId: bigint,
  data: {
    storeName: string;
    customerPhone: string;
    orderText: string;
  }
): Promise<boolean> {
  const message = `
🆕 *NUOVO ORDINE DA WHATSAPP*

🏪 Negozio: *${data.storeName}*
📱 Cliente: ${data.customerPhone || "N/A"}
📝 Messaggio:
\`\`\`
${data.orderText}
\`\`\`

💡 Usa il bot Telegram per gestire l'ordine.
  `.trim();

  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text: message,
        parse_mode: "Markdown",
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

// ============================================================================
// DEPLOY INSTRUCTIONS:
//
// 1. Install Supabase CLI: npm install -g supabase
// 2. Login: supabase login
// 3. Link project: supabase link --project-ref aqpwfurradxbnqvycvkm
// 4. Deploy: supabase functions deploy whatsapp-webhook
// 5. Set secrets:
//    supabase secrets set TELEGRAM_BOT_TOKEN=<token>
//
// 6. Test:
//    curl -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/whatsapp-webhook?text=Ordina_Yamamay&phone=+393201234567"
// ============================================================================
