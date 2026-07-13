// ============================================================================
// DLOOP SAAS — COMMAND HANDLERS
// ============================================================================
// /start, /nuovo_ordine, admin commands (assign_rider, list_orders, etc.)
// ============================================================================

import { Bot, Context } from "../deps.ts";
import { getSupabaseClient } from "../shared/supabase.ts";
import { CONFIG, CONSTANTS } from "../shared/config.ts";
import { CommandStep, OrderStatus, RiderStatus } from "../shared/types.ts";
import { upsertSession, deleteSession } from "../services/session-store.ts";
import { cancelOrder } from "../services/order-service.ts";
import { assignRider } from "../services/dispatch-service.ts";

/**
 * Registra tutti i comandi bot.
 */
export function registerCommands(bot: Bot) {
  bot.command("start", handleStart);
  bot.command("ordine", handleOrdine); // Mini App entry point
  bot.command("nuovo_ordine", handleNuovoOrdine);
  bot.command("mia_reputazione", handleMiaReputazione); // Rider visibility

  // Admin commands (middleware check SHOSHY)
  bot.command("assign_rider", adminOnly, handleAssignRider);
  bot.command("list_orders", adminOnly, handleListOrders);
  bot.command("rider_status", adminOnly, handleRiderStatus);
  bot.command("cancel_order", adminOnly, handleCancelOrder);
}

/**
 * Middleware: solo SHOSHY puo' usare comandi admin.
 */
async function adminOnly(ctx: Context, next: () => Promise<void>) {
  if (ctx.from?.id !== CONFIG.telegram.shoshyUserId) {
    await ctx.reply("⛔ Comando riservato agli admin.");
    return;
  }
  return next();
}

// ─────────────────────────────────────────────────────────────────────────
// /start — Help menu
// ─────────────────────────────────────────────────────────────────────────

async function handleStart(ctx: Context) {
  const isAdmin = ctx.from?.id === CONFIG.telegram.shoshyUserId;

  let message = `
🤖 <b>dloop SaaS Bot v2.1</b>

COMANDI DISPONIBILI:
/ordine - 📱 Crea ordine (Mini App)
/impostazioni - ⚙️ Configura default
/mia_reputazione - 🏆 Vedi il tuo score (rider)

${isAdmin ? `
<b>ADMIN:</b>
/nuovo_ordine - 📝 Crea ordine manuale (fallback)
/list_orders [status] - 📋 Lista ordini
/assign_rider {order_id} {rider_id} - 🏍️ Assegna rider
/rider_status - 🌟 Rider online
/cancel_order {order_id} - ❌ Cancella ordine
` : ""}
  `.trim();

  await ctx.reply(message, { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────────────────────────────────
// /nuovo_ordine — Avvia session multi-step (6 step, NO articoli)
// ─────────────────────────────────────────────────────────────────────────

async function handleNuovoOrdine(ctx: Context) {
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;

  // Crea sessione con step iniziale
  await upsertSession(
    chatId,
    userId,
    CommandStep.PICKUP_POINT,
    {}, // order_draft vuoto
    {}
  );

  await ctx.reply(
    "📍 **Punto ritiro**\n\nInserisci indirizzo pickup point (store o merchant):",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Annulla", callback_data: CONSTANTS.CALLBACK_CANCEL_SESSION }]],
      },
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────
// /ordine — Apre Telegram Mini App per creazione ordine rapida
// ─────────────────────────────────────────────────────────────────────────

async function handleOrdine(ctx: Context) {
  const userId = ctx.from!.id;
  const supabase = getSupabaseClient();

  // Verifica merchant registrato
  const { data: merchant, error } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .select("id, business_name")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (error || !merchant) {
    await ctx.reply(
      "⚠️ Non sei registrato come merchant. Contatta admin.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Bottone Web App (apre Mini App)
  await ctx.reply(
    "📦 <b>CREA ORDINE RAPIDO</b>\n\nApri il form per creare un nuovo ordine consegna.",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          {
            text: "📱 Apri Form Ordine",
            web_app: {
              url: "https://dloop.it/miniapp",
            },
          },
        ]],
      },
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: /assign_rider <order_id> <rider_id>
// ─────────────────────────────────────────────────────────────────────────

async function handleAssignRider(ctx: Context) {
  const parts = ctx.message!.text!.split(" ");
  if (parts.length < 3) {
    await ctx.reply("❌ Formato: /assign_rider <order_id> <rider_id>");
    return;
  }

  const orderId = parts[1];
  const riderId = parts[2];

  try {
    const assignedRiderId = await assignRider(ctx.api as unknown as Bot, orderId, riderId);

    if (assignedRiderId) {
      await ctx.reply(`✅ Ordine ${orderId.slice(0, 8)} assegnato a rider ${riderId}`);
    } else {
      await ctx.reply(`❌ Errore assegnazione rider. Verifica ordine e rider ID.`);
    }
  } catch (err) {
    console.error("[commands] assign_rider error:", err);
    await ctx.reply(`❌ Errore: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: /list_orders [status]
// ─────────────────────────────────────────────────────────────────────────

async function handleListOrders(ctx: Context) {
  const parts = ctx.message!.text!.split(" ");
  const status = parts[1] || OrderStatus.PENDING;

  const supabase = getSupabaseClient();
  const { data: orders, error } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("id, pickup_point, delivery_address, recipient_name, status, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !orders || orders.length === 0) {
    await ctx.reply(`❌ Nessun ordine con status: ${status}`);
    return;
  }

  let message = `📋 **Ordini (${status}):**\n\n`;
  orders.forEach((order: any) => {
    message += `• #${order.id.slice(0, 8)} - ${order.recipient_name}\n  ${order.pickup_point} → ${order.delivery_address}\n  ${new Date(order.created_at).toLocaleString("it-IT")}\n\n`;
  });

  await ctx.reply(message, { parse_mode: "Markdown" });
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: /rider_status
// ─────────────────────────────────────────────────────────────────────────

async function handleRiderStatus(ctx: Context) {
  const supabase = getSupabaseClient();
  const { data: riders, error } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .select("id, name, status, orders_completed_week, earnings_week")
    .eq("status", RiderStatus.ONLINE)
    .limit(20);

  if (error || !riders || riders.length === 0) {
    await ctx.reply("❌ Nessun rider online");
    return;
  }

  let message = `🏍️ **Rider Online (${riders.length}):**\n\n`;
  riders.forEach((rider: any) => {
    const reputation = rider.reputation_score || 50;
    message += `• ${rider.name} - Score ${reputation}/100 - ${rider.orders_completed_week} ordini, €${rider.earnings_week}\n`;
  });

  await ctx.reply(message, { parse_mode: "Markdown" });
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN: /cancel_order <order_id>
// ─────────────────────────────────────────────────────────────────────────

async function handleCancelOrder(ctx: Context) {
  const parts = ctx.message!.text!.split(" ");
  if (parts.length < 2) {
    await ctx.reply("❌ Formato: /cancel_order <order_id>");
    return;
  }

  const orderId = parts[1];

  try {
    const success = await cancelOrder(orderId);
    if (success) {
      await ctx.reply(`✅ Ordine ${orderId.slice(0, 8)} cancellato e token rimborsato`);
    } else {
      await ctx.reply(`❌ Impossibile cancellare ordine ${orderId.slice(0, 8)} (gia' picked up o non trovato)`);
    }
  } catch (err) {
    console.error("[commands] cancel_order error:", err);
    await ctx.reply(`❌ Errore: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// /mia_reputazione — Rider vede proprio score e stats
// ─────────────────────────────────────────────────────────────────────────

async function handleMiaReputazione(ctx: Context) {
  const telegramUserId = ctx.from?.id;

  if (!telegramUserId) {
    await ctx.reply("❌ Errore identificazione utente.");
    return;
  }

  try {
    const supabase = getSupabaseClient();

    // Fetch rider da telegram_user_id
    const { data: rider, error } = await supabase
      .from(CONSTANTS.TABLE_RIDERS)
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (error || !rider) {
      await ctx.reply("❌ Non sei registrato come rider nel sistema.");
      return;
    }

    // Fetch avg_rating da vista rider_reputation
    const { data: rep } = await supabase
      .from("rider_reputation")
      .select("avg_rating")
      .eq("rider_id", rider.id)
      .single();

    const avgRating = rep?.avg_rating || 0;
    const acceptanceRate = ((rider.acceptance_rate || 1.0) * 100).toFixed(1);
    const completionRate = ((rider.completion_rate || 1.0) * 100).toFixed(1);
    const onTimeRate = ((rider.on_time_rate || 1.0) * 100).toFixed(1);
    const reputationScore = rider.reputation_score || 50;
    const totalDeliveries = rider.total_deliveries || 0;

    const message = `
🏆 **LA TUA REPUTAZIONE**

📊 **Reputation Score:** ${reputationScore}/100

**Dettaglio:**
⭐ Rating medio: ${avgRating.toFixed(1)}/5.0
✅ Acceptance rate: ${acceptanceRate}%
📦 Completion rate: ${completionRate}%
⏰ Consegne in orario: ${onTimeRate}%
🚚 Totale consegne: ${totalDeliveries}

${
  reputationScore >= 70
    ? "🔥 **Top reputation!** Ricevi ordini in priorità."
    : reputationScore >= 40
    ? "✨ **Media reputation.** Continua così!"
    : "⚠️ Migliora accettazione e puntualità per più ordini."
}
    `.trim();

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[commands] handleMiaReputazione error:", err);
    await ctx.reply(`❌ Errore: ${(err as Error).message}`);
  }
}
