// ============================================================================
// DLOOP SAAS — TELEGRAM WEBHOOK (Edge Function entry point)
// ============================================================================
// serve() + grammY webhookCallback + secret verification
// ============================================================================

import { serve, Bot, webhookCallback } from "./deps.ts";
import { CONFIG } from "./shared/config.ts";
import { registerCommands } from "./handlers/commands.ts";
import { registerCallbacks } from "./handlers/callbacks.ts";
import { registerSessionHandler } from "./handlers/session.ts";

// Initialize bot
const bot = new Bot(CONFIG.telegram.token);

// Register handlers (ordine importante: comandi, callbacks, session)
registerCommands(bot);
registerCallbacks(bot);
registerSessionHandler(bot);

// grammY webhook callback (con secret token verification)
const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: CONFIG.telegram.webhookSecret,
});

// Serve Edge Function
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "content-type, x-telegram-bot-api-secret-token",
      },
    });
  }

  // grammY gestisce automaticamente la verifica del secret token
  // (configurato in webhookCallback con secretToken option)

  try {
    // Processa update Telegram
    return await handleUpdate(req);
  } catch (err) {
    console.error("[telegram-webhook] Error processing update:", err);
    // CRITICAL: Telegram re-invia update se non riceve 200
    // Ritorna sempre 200 per evitare loop
    return new Response("OK", { status: 200 });
  }
});
