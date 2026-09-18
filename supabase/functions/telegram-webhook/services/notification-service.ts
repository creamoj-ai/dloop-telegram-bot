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

// Costanti fee
const BASE_FEE = 3.00;
const RATE_PER_KM = 0.65;
const ZONA_AVG_KM = 3.5;

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

  // Two-query approach to avoid FK ambiguity (orders use dealer_contact_id, not dealer_id)
  const { data: orderData, error: orderError } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("dropoff_address, dealer_contact_id, delivery_fee_shown")
    .eq("id", orderId)
    .single();

  if (orderError || !orderData) {
    console.warn(`[notification] Ordine ${orderId} non trovato per notifica merchant`);
    return;
  }

  const { data: dealerData } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .select("telegram_user_id")
    .eq("id", orderData.dealer_contact_id)
    .maybeSingle();

  const telegramId = dealerData?.telegram_user_id;

  if (!telegramId) {
    console.warn(`[notification] Merchant senza telegram_user_id per ordine ${orderId}`);
    return;
  }

  const deliveryAddress = (orderData as any).dropoff_address || "N/D";
  const deliveryFee = (orderData as any).delivery_fee_shown ?? null;
  const text = formatMerchantMessage(event, orderId, deliveryAddress, riderName, deliveryFee);

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
  riderName?: string,
  deliveryFee?: number | null
): string {
  const id = orderId.slice(0, 8).toUpperCase();
  switch (event) {
    case "new_order":
      if (deliveryFee) {
        const feeKmPart = parseFloat((deliveryFee - BASE_FEE).toFixed(2));
        const realKm = parseFloat((feeKmPart / RATE_PER_KM).toFixed(1));
        return `🟢 Nuovo ordine #${id} — ${deliveryAddress}\n💰 Consegna: €${BASE_FEE.toFixed(2)} fisso + €${feeKmPart.toFixed(2)} (${realKm} km × €${RATE_PER_KM}) = €${deliveryFee.toFixed(2)}`;
      }
      return `🟢 Nuovo ordine #${id} — ${deliveryAddress}`;
    case "rider_assigned":
      return `🛵 Rider ${riderName ?? "assegnato"} — ordine #${id}`;
    case "in_delivery":
      return `📦 Ordine #${id} ritirato, in consegna`;
    case "completed":
      return `✅ Ordine #${id} consegnato`;
  }
}

/**
 * Notifica merchant quando cliente completa l'ordine via customer-page.
 * Messaggio dettagliato con nome, telefono, dettagli e bottone conferma.
 *
 * @param bot         Grammy Bot instance
 * @param orderId     UUID ordine
 * @param orderDetails Dettagli ordine da mostrare
 */
export async function notifyMerchantOrderReceived(
  bot: Bot,
  orderId: string,
  orderDetails: {
    recipientName: string;
    recipientPhone: string;
    dropoffAddress: string;
    deliveryNotes?: string;
    deliverySlot?: string;
    packageSize?: string;
    packageCount?: number;
    isFragile?: boolean;
    deliveryFeeShown: number;
    dealerContactId: string;
  }
): Promise<void> {
  if (Deno.env.get("MERCHANT_NOTIFY_ENABLED") === "false") return;

  const supabase = getSupabaseClient();

  // Recupera telegram_user_id del merchant
  const { data: dealer } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .select("telegram_user_id")
    .eq("id", orderDetails.dealerContactId)
    .maybeSingle();

  if (!dealer?.telegram_user_id) {
    console.warn(`[notification] Merchant senza telegram_user_id per ordine ${orderId}`);
    return;
  }

  const orderShortId = orderId.slice(0, 8).toUpperCase();
  const packageInfo: string[] = [];
  if (orderDetails.packageSize) packageInfo.push(orderDetails.packageSize);
  if (orderDetails.packageCount && orderDetails.packageCount > 1) {
    packageInfo.push(`${orderDetails.packageCount} colli`);
  }
  if (orderDetails.isFragile) packageInfo.push("fragile");

  const feeKmPart = parseFloat((orderDetails.deliveryFeeShown - BASE_FEE).toFixed(2));
  const realKm = parseFloat((feeKmPart / RATE_PER_KM).toFixed(1));

  // Calcola T-2h della fascia oraria (Europe/Rome timezone)
  let broadcastTimeInfo = "";
  if (orderDetails.deliverySlot) {
    const slotMatch = orderDetails.deliverySlot.match(/^(\d{1,2})-(\d{1,2})$/);
    if (slotMatch) {
      const startHour = parseInt(slotMatch[1], 10);
      const broadcastHour = Math.max(0, startHour - 2);
      broadcastTimeInfo = `\n📡 Il broadcast ai rider partirà automaticamente alle **${String(broadcastHour).padStart(2, "0")}:00** (T-2h dalla fascia).`;
    }
  }

  const message =
    `🟢 **NUOVO ORDINE DA CLIENTE**\n\n` +
    `Ordine: #${orderShortId}\n` +
    `Cliente: ${orderDetails.recipientName}\n` +
    `Telefono: ${orderDetails.recipientPhone}\n` +
    `Consegna: ${orderDetails.dropoffAddress}\n` +
    (orderDetails.deliveryNotes ? `Dettagli: ${orderDetails.deliveryNotes}\n` : '') +
    (orderDetails.deliverySlot ? `⏰ Fascia oraria: ${orderDetails.deliverySlot}\n` : '') +
    (packageInfo.length > 0 ? `Pacco: ${packageInfo.join(', ')}\n` : '') +
    `💰 Consegna: €${BASE_FEE.toFixed(2)} fisso + €${feeKmPart.toFixed(2)} (${realKm} km × €${RATE_PER_KM}) = €${orderDetails.deliveryFeeShown.toFixed(2)}` +
    broadcastTimeInfo;

  try {
    await bot.api.sendMessage(
      dealer.telegram_user_id,
      message,
      {
        parse_mode: "Markdown"
      }
    );
    console.log(`[notification] Merchant notificato per ordine ricevuto ${orderId}`);
  } catch (err) {
    console.error(`[notification] Errore notifica merchant order received:`, err);
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
