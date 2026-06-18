// ============================================================================
// DLOOP SAAS — CALLBACK QUERY HANDLERS (inline buttons)
// ============================================================================
// confirm_order, cancel_session, payment_mode, accept/decline rider
// ============================================================================

import { Bot, Context } from "../deps.ts";
import { getSupabaseClient } from "../shared/supabase.ts";
import { getSession, upsertSession, deleteSession } from "../services/session-store.ts";
import { createDeliveryOrder } from "../services/order-service.ts";
import { assignRider } from "../services/dispatch-service.ts";
import { recordDecline, updateReputationScore, getZoneMedianFee } from "../services/reputation-service.ts";
import { CONSTANTS } from "../shared/config.ts";
import { CommandStep, OrderStatus, PaymentMode } from "../shared/types.ts";

/**
 * Registra tutti i callback query handlers.
 */
export function registerCallbacks(bot: Bot) {
  // Session flow
  bot.callbackQuery(CONSTANTS.CALLBACK_CANCEL_SESSION, handleCancelSession);
  bot.callbackQuery(
    CONSTANTS.CALLBACK_PAYMENT_MODE_DELIVERY_ON_COMPLETION,
    handlePaymentModeDeliveryOnCompletion
  );
  bot.callbackQuery(CONSTANTS.CALLBACK_PAYMENT_MODE_COD, handlePaymentModeCOD);
  bot.callbackQuery(CONSTANTS.CALLBACK_PAYMENT_MODE_PREPAID, handlePaymentModePrepaid);
  bot.callbackQuery(CONSTANTS.CALLBACK_CONFIRM_ORDER, handleConfirmOrder);

  // Rider accept/decline (regex per catturare order_id)
  bot.callbackQuery(/^accept_order_(.+)$/, handleAcceptOrder);
  bot.callbackQuery(/^decline_order_(.+)$/, handleDeclineOrder);

  // Rider conferma incasso consegna
  bot.callbackQuery(/^confirm_delivery_payment_(.+)$/, handleConfirmDeliveryPayment);

  // Rating rider
  bot.callbackQuery(/^rate_rider_(.+)_(\d)$/, handleRateRider);
}

// ─────────────────────────────────────────────────────────────────────────
// CANCEL SESSION
// ─────────────────────────────────────────────────────────────────────────

async function handleCancelSession(ctx: Context) {
  await deleteSession(ctx.chat!.id);
  await ctx.answerCallbackQuery();
  await ctx.reply("❌ Operazione annullata.");
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
}

// ─────────────────────────────────────────────────────────────────────────
// PAYMENT MODE SELECTION
// ─────────────────────────────────────────────────────────────────────────

async function handlePaymentModeDeliveryOnCompletion(ctx: Context) {
  await setPaymentModeAndShowConfirm(ctx, "delivery_on_completion");
}

async function handlePaymentModeCOD(ctx: Context) {
  await setPaymentModeAndShowConfirm(ctx, "cod");
}

async function handlePaymentModePrepaid(ctx: Context) {
  await setPaymentModeAndShowConfirm(ctx, "prepaid");
}

async function setPaymentModeAndShowConfirm(ctx: Context, paymentMode: PaymentMode) {
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;

  const session = await getSession(chatId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: "Sessione scaduta", show_alert: true });
    return;
  }

  const orderDraft = session.order_draft || {};
  orderDraft.payment_mode = paymentMode;

  // Se delivery_on_completion, calcola delivery_fee_shown (mediana zona)
  if (paymentMode === "delivery_on_completion") {
    // TODO: determinare zona da delivery_address (geocoding o DB zone mapping)
    // Per MVP: usa zona default "napoli_centro"
    const zona = "napoli_centro";
    const deliveryFee = await getZoneMedianFee(zona);
    orderDraft.delivery_fee_shown = deliveryFee;
  }

  await upsertSession(chatId, userId, CommandStep.CONFIRM, orderDraft);
  await ctx.answerCallbackQuery();

  // Mostra riepilogo ordine
  const paymentLabels: Record<PaymentMode, string> = {
    delivery_on_completion: "Cliente paga consegna al rider",
    cod: "Contrassegno (rider raccoglie prodotto+consegna)",
    prepaid: "Prepagato (tutto gia' regolato)",
  };

  const summary = `
📋 **RIEPILOGO ORDINE**

📍 Ritiro: ${orderDraft.pickup_point}
📍 Consegna: ${orderDraft.delivery_address}
👤 Destinatario: ${orderDraft.recipient_name}
📱 Telefono: ${orderDraft.recipient_phone}
${orderDraft.time_window ? `⏰ Finestra: ${orderDraft.time_window}` : ""}
${orderDraft.notes ? `📝 Note: ${orderDraft.notes}` : ""}
💳 Pagamento: ${paymentLabels[paymentMode]}
${orderDraft.delivery_fee_shown ? `💰 Costo consegna: €${orderDraft.delivery_fee_shown.toFixed(2)}` : ""}

**Confermi creazione ordine?**
  `.trim();

  await ctx.editMessageText(summary, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Conferma", callback_data: CONSTANTS.CALLBACK_CONFIRM_ORDER },
          { text: "❌ Annulla", callback_data: CONSTANTS.CALLBACK_CANCEL_SESSION },
        ],
      ],
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRM ORDER
// ─────────────────────────────────────────────────────────────────────────

async function handleConfirmOrder(ctx: Context) {
  const chatId = ctx.chat!.id;

  const session = await getSession(chatId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: "Sessione scaduta", show_alert: true });
    return;
  }

  try {
    // 1. Determina merchant_id (da user_id se e' un merchant, o default admin)
    // TODO: logica per risolvere merchant_id da ctx.from.id
    // Per ora: usa primo merchant attivo come fallback
    const supabase = getSupabaseClient();
    const { data: merchant } = await supabase
      .from(CONSTANTS.TABLE_MERCHANTS)
      .select("id, mode")
      .eq("status", "active")
      .limit(1)
      .single();

    if (!merchant) {
      await ctx.answerCallbackQuery({ text: "Errore: nessun merchant configurato", show_alert: true });
      return;
    }

    const orderDraft = session.order_draft || {};
    orderDraft.merchant_id = merchant.id;
    orderDraft.mode = merchant.mode;
    orderDraft.source = "telegram_manual";

    // 2. Crea ordine + deduce token
    const orderId = await createDeliveryOrder(orderDraft);

    // 3. Assegna rider (auto)
    const riderId = await assignRider(ctx.api as unknown as Bot, orderId);

    // 4. Notifica successo
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `✅ **Ordine creato!**\n\nID: #${orderId.slice(0, 8).toUpperCase()}\n${riderId ? `Rider assegnato: ${riderId.slice(0, 8)}` : "In attesa assegnazione rider"}`,
      { parse_mode: "Markdown" }
    );

    // 5. Cancella sessione
    await deleteSession(chatId);

  } catch (err) {
    console.error("[callbacks] handleConfirmOrder error:", err);
    await ctx.answerCallbackQuery({ text: `Errore: ${(err as Error).message}`, show_alert: true });

    // Se errore token, mostra messaggio
    if ((err as Error).message.includes("token")) {
      await ctx.reply("❌ Saldo token insufficiente. Contatta admin per ricarica.");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RIDER ACCEPT ORDER
// ─────────────────────────────────────────────────────────────────────────

async function handleAcceptOrder(ctx: Context) {
  const orderId = (ctx.match as RegExpMatchArray)[1]; // Cattura UUID da regex
  const riderId = ctx.from?.id;

  if (!riderId) {
    await ctx.answerCallbackQuery({ text: "Errore: rider non identificato", show_alert: true });
    return;
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch rider ID da telegram_user_id
    const { data: rider, error: riderError } = await supabase
      .from(CONSTANTS.TABLE_RIDERS)
      .select("id")
      .eq("telegram_user_id", riderId)
      .maybeSingle();

    if (riderError || !rider) {
      await ctx.answerCallbackQuery({ text: "Rider non trovato nel sistema", show_alert: true });
      return;
    }

    // 2. Update order: assegna rider + status ASSIGNED
    const { error } = await supabase
      .from(CONSTANTS.TABLE_ORDERS)
      .update({
        assigned_rider_id: rider.id,
        status: OrderStatus.ASSIGNED,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", OrderStatus.PENDING); // Solo se ancora pending (race condition)

    if (error) throw error;

    await ctx.answerCallbackQuery({ text: "✅ Ordine assegnato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(`✅ Ordine #${orderId.slice(0, 8)} assegnato a te. Buona consegna! 🚚`);

    console.log(`[callbacks] Rider ${rider.id} accepted order ${orderId}`);
  } catch (err) {
    console.error("[callbacks] handleAcceptOrder error:", err);
    await ctx.answerCallbackQuery({ text: "Errore accettazione ordine", show_alert: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RIDER DECLINE ORDER
// ─────────────────────────────────────────────────────────────────────────

async function handleDeclineOrder(ctx: Context) {
  const orderId = (ctx.match as RegExpMatchArray)[1];
  const riderTelegramId = ctx.from?.id;

  if (!riderTelegramId) {
    await ctx.answerCallbackQuery({ text: "Errore: rider non identificato", show_alert: true });
    return;
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch rider ID da telegram_user_id
    const { data: rider, error: riderError } = await supabase
      .from(CONSTANTS.TABLE_RIDERS)
      .select("id")
      .eq("telegram_user_id", riderTelegramId)
      .maybeSingle();

    if (riderError || !rider) {
      await ctx.answerCallbackQuery({ text: "Rider non trovato nel sistema", show_alert: true });
      return;
    }

    // 2. Registra decline → impatta acceptance_rate
    await recordDecline(rider.id);

    // 3. Ordine resta PENDING (escalation-tick se ne occupera')
    await ctx.answerCallbackQuery({ text: "Ordine rifiutato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(`❌ Ordine #${orderId.slice(0, 8)} rifiutato. Verra' offerto ad altri rider.`);

    console.log(`[callbacks] Rider ${rider.id} declined order ${orderId}, acceptance_rate penalizzata`);
  } catch (err) {
    console.error("[callbacks] handleDeclineOrder error:", err);
    await ctx.answerCallbackQuery({ text: "Errore rifiuto ordine", show_alert: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RIDER CONFIRM DELIVERY PAYMENT
// ─────────────────────────────────────────────────────────────────────────

async function handleConfirmDeliveryPayment(ctx: Context) {
  const orderId = (ctx.match as RegExpMatchArray)[1];

  try {
    const supabase = getSupabaseClient();

    // Update delivery_payment_confirmed + delivery_paid_at
    const { error } = await supabase
      .from(CONSTANTS.TABLE_ORDERS)
      .update({
        delivery_payment_confirmed: true,
        delivery_paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (error) throw error;

    await ctx.answerCallbackQuery({ text: "✅ Incasso confermato" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(`✅ Incasso consegna confermato per ordine #${orderId.slice(0, 8)}`);

    console.log(`[callbacks] Delivery payment confirmed for order ${orderId}`);
  } catch (err) {
    console.error("[callbacks] handleConfirmDeliveryPayment error:", err);
    await ctx.answerCallbackQuery({ text: "Errore conferma incasso", show_alert: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RATE RIDER (merchant/customer vota rider 1-5)
// ─────────────────────────────────────────────────────────────────────────

async function handleRateRider(ctx: Context) {
  const orderId = (ctx.match as RegExpMatchArray)[1];
  const score = parseInt((ctx.match as RegExpMatchArray)[2], 10);

  if (score < 1 || score > 5) {
    await ctx.answerCallbackQuery({ text: "Voto invalido", show_alert: true });
    return;
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch ordine per rider_id
    const { data: order, error: orderError } = await supabase
      .from(CONSTANTS.TABLE_ORDERS)
      .select("assigned_rider_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order || !order.assigned_rider_id) {
      await ctx.answerCallbackQuery({ text: "Ordine non trovato o rider non assegnato", show_alert: true });
      return;
    }

    const riderId = order.assigned_rider_id;

    // 2. Insert rating
    const { error: insertError } = await supabase.from(CONSTANTS.TABLE_RATINGS).insert({
      order_id: orderId,
      rater_role: "merchant", // TODO: detect se merchant o customer dal ctx.from.id
      ratee_role: "rider",
      ratee_id: riderId,
      score,
      created_at: new Date().toISOString(),
    });

    if (insertError) throw insertError;

    // 3. Ricalcola reputation_score rider
    await updateReputationScore(riderId);

    await ctx.answerCallbackQuery({ text: `✅ Voto ${score}★ registrato` });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(`✅ Grazie per il feedback! Voto ${score}★ registrato per il rider.`);

    console.log(`[callbacks] Rating ${score} recorded for rider ${riderId} on order ${orderId}`);
  } catch (err) {
    console.error("[callbacks] handleRateRider error:", err);
    await ctx.answerCallbackQuery({ text: "Errore registrazione voto", show_alert: true });
  }
}
