// ============================================================================
// DLOOP SAAS — NOTIFICATION SERVICE
// ============================================================================
// Unico punto di invio notifiche. Due canali completamente separati:
//   Merchant → Telegram  (MERCHANT_NOTIFY_ENABLED, default: true)
//   Cliente  → WhatsApp  (CUSTOMER_WA_ENABLED,     default: false — stub)
// Attivazione indipendente per canale via env.
// ============================================================================

import { Bot } from "../deps.ts";
import { getSupabaseClient } from "../shared/supabase.ts";
import { CONSTANTS } from "../shared/config.ts";

export type NotificationEvent =
  | "new_order"
  | "rider_assigned"
  | "in_delivery"
  | "completed";

// ─── MERCHANT — TELEGRAM ──────────────────────────────────────────────────

/**
 * Notifica merchant su Telegram a ogni cambio stato ordine.
 *
 * @param bot       Grammy Bot (o ctx.api as unknown as Bot)
 * @param event     Evento lifecycle ordine
 * @param orderId   UUID ordine
 * @param riderName Nome rider — richiesto per "rider_assigned"
 */
export async function notifyMerchant(
  bot: Bot,
  event: NotificationEvent,
  orderId: string,
  riderName?: string
): Promise<void> {
  if (Deno.env.get("MERCHANT_NOTIFY_ENABLED") === "false") return;

  const supabase = getSupabaseClient();

  // Join singolo: ordine + telegram_user_id del merchant
  const { data, error } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("delivery_address, dealers!inner(telegram_user_id)")
    .eq("id", orderId)
    .single();

  if (error || !data) {
    console.warn(`[notification] Ordine ${orderId} non trovato per notifica merchant`);
    return;
  }

  const dealers = data.dealers as { telegram_user_id: string | null } | null;
  const telegramId = dealers?.telegram_user_id;

  if (!telegramId) {
    console.warn(`[notification] Merchant senza telegram_user_id per ordine ${orderId}`);
    return;
  }

  const text = formatMerchantMessage(event, orderId, data.delivery_address, riderName);

  try {
    await bot.api.sendMessage(telegramId, text);
    console.log(`[notification] Merchant notificato: ${event} ordine ${orderId}`);
  } catch (err) {
    console.error(`[notification] Errore invio merchant (${event}):`, err);
  }
}

function formatMerchantMessage(
  event: NotificationEvent,
  orderId: string,
  deliveryAddress: string,
  riderName?: string
): string {
  const id = orderId.slice(0, 8).toUpperCase();
  switch (event) {
    case "new_order":
      return `🟢 Nuovo ordine #${id} — ${deliveryAddress}`;
    case "rider_assigned":
      return `🛵 Rider ${riderName ?? "assegnato"} — ordine #${id}`;
    case "in_delivery":
      return `📦 Ordine #${id} ritirato, in consegna`;
    case "completed":
      return `✅ Ordine #${id} consegnato`;
  }
}

// ─── CLIENTE — WHATSAPP CLOUD API (stub) ──────────────────────────────────

/**
 * Notifica cliente su WhatsApp a ogni cambio stato + PIN su "completed".
 * STUB — non attivo finché CUSTOMER_WA_ENABLED !== "true".
 *
 * Quando attivare: supabase secrets set CUSTOMER_WA_ENABLED=true
 *
 * TODO (quando Cloud API è attiva):
 * 1. Fetch ordine per recipient_phone + recipient_name
 * 2. Costruire template WA approvato per ogni evento
 * 3. POST https://graph.facebook.com/v19.0/{phone_number_id}/messages
 * 4. Su "completed": inviare PIN e salvarlo sull'ordine per match rider
 */
export async function notifyCustomer(
  _event: NotificationEvent,
  orderId: string,
  _pin?: string
): Promise<void> {
  if (Deno.env.get("CUSTOMER_WA_ENABLED") !== "true") return;

  console.warn(`[notification] notifyCustomer ${orderId} — CUSTOMER_WA_ENABLED=false, stub`);
}
