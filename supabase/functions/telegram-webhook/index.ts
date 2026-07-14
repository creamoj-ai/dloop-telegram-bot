// ============================================================================
// DLOOP SAAS — TELEGRAM WEBHOOK (Edge Function entry point)
// ============================================================================
// Deno.serve() + grammY webhookCallback + secret verification
// ============================================================================

import { Bot, webhookCallback } from "./deps.ts";
import { CONFIG } from "./shared/config.ts";
import { registerCommands } from "./handlers/commands.ts";
import { registerCallbacks } from "./handlers/callbacks.ts";
import { registerSessionHandler } from "./handlers/session.ts";
import { registerCustomerLinkHandlers } from "./handlers/customer-link.ts";

// ── Boot diagnostics ────────────────────────────────────────────────────
console.log("[boot] TELEGRAM_BOT_TOKEN set:", !!CONFIG.telegram.token, "len:", CONFIG.telegram.token.length);
console.log("[boot] TELEGRAM_WEBHOOK_SECRET set:", !!CONFIG.telegram.webhookSecret, "len:", CONFIG.telegram.webhookSecret.length);

if (!CONFIG.telegram.token) {
  console.error("[boot] FATAL: TELEGRAM_BOT_TOKEN is empty! Bot cannot send replies.");
}

// Initialize bot
const bot = new Bot(CONFIG.telegram.token);

// grammY error handler — log instead of crashing
bot.catch((err) => {
  console.error("[bot.catch] grammY error:", err.message);
  console.error("[bot.catch] Update that caused error:", JSON.stringify(err.ctx?.update?.message?.text || "N/A"));
});

// Register handlers (ordine importante: comandi, callbacks, customer-link, session)
registerCommands(bot);
registerCallbacks(bot);

try {
  registerCustomerLinkHandlers(bot);
  console.log("[boot] customer-link handlers registered");
} catch (err) {
  console.error("[boot] FATAL: customer-link registration failed:", err);
}

// IMPORTANTE: registerSessionHandler ULTIMO perché cattura tutti i messaggi
registerSessionHandler(bot);

console.log("[boot] All handlers registered. Creating webhookCallback...");

// grammY webhook callback (con secret token verification)
const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: CONFIG.telegram.webhookSecret,
});

console.log("[boot] webhookCallback created. Starting Deno.serve()...");

// Serve Edge Function — use Deno.serve() (Deno 2.x native, replaces deprecated std/http serve)
Deno.serve(async (req: Request) => {
  const method = req.method;
  const url = req.url;
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");

  console.log(`[req] ${method} ${url} | secret-header: ${secretHeader ? "present" : "MISSING"}`);

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "content-type, x-telegram-bot-api-secret-token",
      },
    });
  }

  // Health check (GET)
  if (method === "GET") {
    return new Response(JSON.stringify({
      status: "ok",
      bot_token_set: !!CONFIG.telegram.token,
      webhook_secret_set: !!CONFIG.telegram.webhookSecret,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[req] Processing update via grammY...");
    const response = await handleUpdate(req);
    console.log("[req] grammY returned status:", response.status);
    return response;
  } catch (err) {
    console.error("[req] Error processing update:", (err as Error).message);
    console.error("[req] Stack:", (err as Error).stack);
    // CRITICAL: Telegram re-invia update se non riceve 200
    // Ritorna sempre 200 per evitare loop
    return new Response("OK", { status: 200 });
  }
});
