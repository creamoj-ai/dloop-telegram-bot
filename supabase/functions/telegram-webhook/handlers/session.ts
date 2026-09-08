// ============================================================================
// DLOOP SAAS — SESSION HANDLER (multi-step /nuovo_ordine)
// ============================================================================
// Flusso: PICKUP_POINT -> DELIVERY_ADDRESS -> RECIPIENT_NAME -> RECIPIENT_PHONE
//         -> TIME_WINDOW (/skip) -> NOTE (/skip) -> PAYMENT_MODE -> CONFIRM
// ============================================================================

import { Bot, Context } from "../deps.ts";
import { getSession, upsertSession, deleteSession } from "../services/session-store.ts";
import { getZoneMedianFee } from "../services/reputation-service.ts";
import { CommandStep, OrderStatus } from "../shared/types.ts";
import { CONSTANTS } from "../shared/config.ts";
import { getSupabaseClient } from "../shared/supabase.ts";
import { notifyMerchant } from "../services/notification-service.ts";

/**
 * Registra handler per testo libero (session input).
 */
export function registerSessionHandler(bot: Bot) {
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const text = ctx.message.text;

    if (!userId) return;

    // Ignora comandi (gestiti da commands.ts)
    if (text.startsWith("/")) return;

    // Recupera sessione
    const session = await getSession(chatId);

    if (!session) {
      // Nessuna sessione attiva: ignora o mostra help
      await ctx.reply("Usa /nuovo_ordine per creare un ordine.");
      return;
    }

    // Processa step corrente
    await processSessionStep(ctx, session, text);
  });
}

/**
 * Processa input utente in base allo step corrente.
 */
async function processSessionStep(
  ctx: Context,
  session: any, // TelegramSessionRow
  input: string
) {
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;
  const orderDraft = session.order_draft || {};

  switch (session.step) {
    case CommandStep.PICKUP_POINT:
      orderDraft.pickup_point = input.trim();
      await upsertSession(chatId, userId, CommandStep.DELIVERY_ADDRESS, orderDraft);
      await ctx.reply("📍 **Indirizzo consegna**\n\nInserisci indirizzo completo:", {
        parse_mode: "Markdown",
      });
      break;

    case CommandStep.DELIVERY_ADDRESS:
      orderDraft.delivery_address = input.trim();
      await upsertSession(chatId, userId, CommandStep.RECIPIENT_NAME, orderDraft);
      await ctx.reply("👤 **Nome destinatario**\n\nInserisci nome:", {
        parse_mode: "Markdown",
      });
      break;

    case CommandStep.RECIPIENT_NAME:
      orderDraft.recipient_name = input.trim();
      await upsertSession(chatId, userId, CommandStep.RECIPIENT_PHONE, orderDraft);
      await ctx.reply("📱 **Telefono destinatario**\n\nInserisci numero (es. +39 320 1234567):", {
        parse_mode: "Markdown",
      });
      break;

    case CommandStep.RECIPIENT_PHONE:
      orderDraft.recipient_phone = input.trim();
      await upsertSession(chatId, userId, CommandStep.TIME_WINDOW, orderDraft);
      await ctx.reply(
        "⏰ **Finestra temporale** (opzionale)\n\nInserisci orario (es. 14:00-16:00) o /skip:",
        { parse_mode: "Markdown" }
      );
      break;

    case CommandStep.TIME_WINDOW:
      if (input.trim() === "/skip") {
        orderDraft.time_window = null;
      } else {
        orderDraft.time_window = input.trim();
      }
      await upsertSession(chatId, userId, CommandStep.NOTE, orderDraft);
      await ctx.reply("📝 **Note** (opzionale)\n\nInserisci note aggiuntive o /skip:", {
        parse_mode: "Markdown",
      });
      break;

    case CommandStep.NOTE:
      if (input.trim() === "/skip") {
        orderDraft.notes = null;
      } else {
        orderDraft.notes = input.trim();
      }
      await upsertSession(chatId, userId, CommandStep.PAYMENT_MODE, orderDraft);
      await ctx.reply("💳 **Modalita pagamento consegna** (registrazione, NON gestito da Dloop):", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Cliente paga consegna al rider",
                callback_data: CONSTANTS.CALLBACK_PAYMENT_MODE_DELIVERY_ON_COMPLETION,
              },
            ],
            [
              { text: "Contrassegno (rider raccoglie)", callback_data: CONSTANTS.CALLBACK_PAYMENT_MODE_COD },
              { text: "Prepagato (già regolato)", callback_data: CONSTANTS.CALLBACK_PAYMENT_MODE_PREPAID },
            ],
          ],
        },
      });
      break;

    case CommandStep.WAITING_DELIVERY_PIN: {
      const orderId = session.temp_data?.order_id as string | undefined;
      if (!orderId) {
        await ctx.reply("Errore: ordine non trovato. Contatta admin.");
        await deleteSession(chatId);
        break;
      }

      const pin = input.trim();
      if (!/^\d{4}$/.test(pin)) {
        await ctx.reply("⚠️ PIN non valido. Inserisci il PIN a 4 cifre:");
        break; // Keep session alive
      }

      const supabase = getSupabaseClient();
      const { data: order } = await supabase
        .from("orders")
        .select("id, delivery_pin, status")
        .eq("id", orderId)
        .maybeSingle();

      if (!order) {
        await ctx.reply("Errore: ordine non trovato nel sistema.");
        await deleteSession(chatId);
        break;
      }

      if (order.delivery_pin !== pin) {
        await ctx.reply("❌ PIN errato. Chiedi al cliente di mostrare il PIN corretto e riprova:");
        break; // Keep session alive for retry
      }

      // PIN corretto: chiude ordine
      await supabase
        .from("orders")
        .update({
          status: OrderStatus.COMPLETED,
          delivery_payment_confirmed: true,
          delivery_paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      await notifyMerchant(ctx.api as unknown as Bot, "completed", orderId);
      await deleteSession(chatId);
      await ctx.reply(
        `✅ PIN corretto! Ordine #${orderId.slice(0, 8).toUpperCase()} consegnato e chiuso. Ottimo lavoro! 🎉`
      );
      console.log(`[session] Ordine ${orderId} completato con PIN validato`);
      break;
    }

    default:
      await ctx.reply("❌ Stato sessione non riconosciuto. Usa /nuovo_ordine per ricominciare.");
      await deleteSession(chatId);
      break;
  }
}
