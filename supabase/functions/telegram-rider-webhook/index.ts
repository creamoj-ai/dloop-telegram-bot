// ============================================================================
// DLOOP SAAS — TELEGRAM RIDER BOT WEBHOOK
// ============================================================================
// Bot Telegram SEPARATO per rider: @dloop_rider_bot
// Gestisce: /start registrazione, accept/decline ordini.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Bot, webhookCallback } from "https://esm.sh/grammy@1.30.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Env config
const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!TELEGRAM_RIDER_BOT_TOKEN) {
  throw new Error("TELEGRAM_RIDER_BOT_TOKEN non configurato");
}

const bot = new Bot(TELEGRAM_RIDER_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// HANDLERS
// ============================================================================

// /start — Registrazione rider
bot.command("start", async (ctx) => {
  const telegramUserId = ctx.from?.id;
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "";

  if (!telegramUserId) {
    await ctx.reply("❌ Errore: impossibile identificare utente Telegram.");
    return;
  }

  try {
    // Verifica se rider già registrato
    const { data: existingRider } = await supabase
      .from("riders")
      .select("id, name, phone, status")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (existingRider) {
      // Rider già registrato, mostra stato
      await ctx.reply(
        `✅ **Benvenuto ${existingRider.name}!**\n\n` +
        `Stato: ${existingRider.status === 'online' ? '🟢 Online' : '⚫ Offline'}\n` +
        `Telefono: ${existingRider.phone}\n\n` +
        `Riceverai notifiche per nuovi ordini quando sei online.`
      );
      return;
    }

    // Nuovo rider: salva telegram_user_id (admin completerà)
    const { error: insertError } = await supabase
      .from("riders")
      .insert({
        telegram_user_id: telegramUserId,
        name: firstName || username || `Rider_${telegramUserId}`,
        status: "pending",
      });

    if (insertError) {
      console.error("[rider-bot] Errore insert rider:", insertError);
      await ctx.reply(
        `❌ Errore registrazione.\n\n` +
        `Contatta l'amministratore per completare la registrazione.`
      );
      return;
    }

    await ctx.reply(
      `✅ **Registrazione avviata!**\n\n` +
      `Il tuo account rider è stato creato.\n` +
      `Un amministratore completerà la configurazione (telefono, P.IVA, veicolo).\n\n` +
      `Riceverai una notifica quando il tuo account sarà attivato.`
    );

    console.log(`[rider-bot] Nuovo rider registrato: ${telegramUserId} (${firstName})`);
  } catch (err) {
    console.error("[rider-bot] Errore /start:", err);
    await ctx.reply("❌ Errore durante la registrazione. Riprova più tardi.");
  }
});

// Callback: accept_order_{orderId}
bot.callbackQuery(/^accept_order_(.+)$/, async (ctx) => {
  const orderId = (ctx.match as RegExpMatchArray)[1];
  const riderTelegramId = ctx.from?.id;

  if (!riderTelegramId) {
    await ctx.answerCallbackQuery({ text: "Errore: rider non identificato", show_alert: true });
    return;
  }

  try {
    // 1. Fetch rider ID da telegram_user_id
    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("id, name")
      .eq("telegram_user_id", riderTelegramId)
      .maybeSingle();

    if (riderError || !rider) {
      await ctx.answerCallbackQuery({ text: "Rider non trovato nel sistema", show_alert: true });
      return;
    }

    // 2. Update order: assegna rider + status ASSIGNED (guard race condition)
    // IMPORTANTE: UPDATE condizionale con .eq("status", "pending") → FCFS atomico
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        assigned_rider_id: rider.id,
        status: "assigned",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "pending") // ← RACE CONDITION GUARD
      .select("id, pickup_point, delivery_address, recipient_name, recipient_phone, delivery_fee_shown")
      .maybeSingle();

    if (updateError) {
      console.error("[rider-bot] Errore update order:", updateError);
      await ctx.answerCallbackQuery({ text: "Errore accettazione ordine", show_alert: true });
      return;
    }

    if (!updatedOrder) {
      // Ordine già assegnato ad altro rider
      await ctx.answerCallbackQuery({ text: "❌ Ordine già assegnato ad altro rider", show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      await ctx.editMessageText(
        `❌ **Ordine già assegnato**\n\n` +
        `Un altro rider ha accettato questo ordine.`
      );
      return;
    }

    // 3. Successo: ordine assegnato
    await ctx.answerCallbackQuery({ text: "✅ Ordine assegnato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });

    const orderShortId = orderId.slice(0, 8).toUpperCase();
    await ctx.reply(
      `✅ **Ordine #${orderShortId} assegnato a te!**\n\n` +
      `📍 **Ritiro:** ${updatedOrder.pickup_point}\n` +
      `📍 **Consegna:** ${updatedOrder.delivery_address}\n` +
      `👤 **Destinatario:** ${updatedOrder.recipient_name}\n` +
      `📱 **Telefono:** ${updatedOrder.recipient_phone}\n` +
      `${updatedOrder.delivery_fee_shown ? `💰 **Compenso:** €${updatedOrder.delivery_fee_shown.toFixed(2)}` : ''}\n\n` +
      `**Premi quando hai ritirato il pacco:**`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "📦 Ho ritirato", callback_data: `pickup_confirmed_${orderId}` },
          ]],
        },
      }
    );

    console.log(`[rider-bot] Rider ${rider.id} (${rider.name}) accepted order ${orderId}`);
  } catch (err) {
    console.error("[rider-bot] Errore handleAcceptOrder:", err);
    await ctx.answerCallbackQuery({ text: "Errore accettazione ordine", show_alert: true });
  }
});

// Callback: decline_order_{orderId}
bot.callbackQuery(/^decline_order_(.+)$/, async (ctx) => {
  const orderId = (ctx.match as RegExpMatchArray)[1];
  const riderTelegramId = ctx.from?.id;

  if (!riderTelegramId) {
    await ctx.answerCallbackQuery({ text: "Errore: rider non identificato", show_alert: true });
    return;
  }

  try {
    const { data: rider } = await supabase
      .from("riders")
      .select("id")
      .eq("telegram_user_id", riderTelegramId)
      .maybeSingle();

    if (!rider) {
      await ctx.answerCallbackQuery({ text: "Rider non trovato nel sistema", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Ordine rifiutato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.editMessageText(
      `❌ **Ordine rifiutato**\n\n` +
      `L'ordine verrà offerto ad altri rider.`
    );

    console.log(`[rider-bot] Rider ${rider.id} declined order ${orderId}`);
  } catch (err) {
    console.error("[rider-bot] Errore handleDeclineOrder:", err);
    await ctx.answerCallbackQuery({ text: "Errore rifiuto ordine", show_alert: true });
  }
});

// Callback: pickup_confirmed_{orderId}
bot.callbackQuery(/^pickup_confirmed_(.+)$/, async (ctx) => {
  const orderId = (ctx.match as RegExpMatchArray)[1];

  try {
    const { error } = await supabase
      .from("orders")
      .update({
        status: "in_delivery",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "assigned");

    if (error) {
      console.error("[rider-bot] Errore pickup_confirmed:", error);
      await ctx.answerCallbackQuery({ text: "Errore conferma ritiro", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: "📦 Ritiro confermato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });

    const orderShortId = orderId.slice(0, 8).toUpperCase();
    await ctx.reply(
      `📦 **Ritiro confermato!**\n\n` +
      `Ordine #${orderShortId} in consegna.\n\n` +
      `**Premi quando hai consegnato:**`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Ho consegnato", callback_data: `delivery_confirmed_${orderId}` },
          ]],
        },
      }
    );

    console.log(`[rider-bot] Ordine ${orderId} in consegna`);
  } catch (err) {
    console.error("[rider-bot] Errore pickup_confirmed:", err);
    await ctx.answerCallbackQuery({ text: "Errore conferma ritiro", show_alert: true });
  }
});

// Callback: delivery_confirmed_{orderId}
bot.callbackQuery(/^delivery_confirmed_(.+)$/, async (ctx) => {
  const orderId = (ctx.match as RegExpMatchArray)[1];

  try {
    const { error } = await supabase
      .from("orders")
      .update({
        status: "completed",
        delivery_paid_at: new Date().toISOString(),
        delivery_payment_confirmed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "in_delivery");

    if (error) {
      console.error("[rider-bot] Errore delivery_confirmed:", error);
      await ctx.answerCallbackQuery({ text: "Errore conferma consegna", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: "✅ Consegna completata" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });

    const orderShortId = orderId.slice(0, 8).toUpperCase();
    await ctx.reply(
      `✅ **Consegna completata!**\n\n` +
      `Ordine #${orderShortId} consegnato e chiuso.\n\n` +
      `Ottimo lavoro! 🎉`
    );

    console.log(`[rider-bot] Ordine ${orderId} completato`);
  } catch (err) {
    console.error("[rider-bot] Errore delivery_confirmed:", err);
    await ctx.answerCallbackQuery({ text: "Errore conferma consegna", show_alert: true });
  }
});

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

const handleUpdate = webhookCallback(bot, "std/http");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
    });
  }

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== Deno.env.get("TELEGRAM_RIDER_WEBHOOK_SECRET")) {
      return new Response("Unauthorized", { status: 401 });
    }

    return await handleUpdate(req);
  } catch (err) {
    console.error("[rider-bot] Error:", err);
    return new Response("ok", { status: 200 });
  }
});
