// ============================================================================
// DLOOP SAAS — DISPATCH SERVICE (reputation-driven broadcast tiered)
// ============================================================================
// assignRider → broadcastToRiders (tier 0 iniziale, escalation via cron).
// PostGIS nearest + ORDER BY reputation_score DESC.
// ============================================================================

import { getSupabaseClient } from "../shared/supabase.ts";
import { CONSTANTS } from "../shared/config.ts";
import { Order, Rider, RiderStatus, OrderStatus } from "../shared/types.ts";
import { Bot } from "../deps.ts";
import { notifyMerchant } from "./notification-service.ts";

/**
 * Broadcast ordine a rider in zona (tier 0 = top reputation).
 * NON assegna direttamente: il primo rider che accetta vince (callback).
 * Setta broadcast_tier=0 e broadcast_started_at sull'ordine.
 */
export async function assignRider(
  bot: Bot,
  orderId: string,
  manualRiderId?: string
): Promise<string | null> {
  const supabase = getSupabaseClient();

  // Se riderId manuale, assegna direttamente (bypass broadcast)
  if (manualRiderId) {
    return await directAssignRider(bot, orderId, manualRiderId);
  }

  // 1. Recupera ordine per pickup_point location (PostGIS)
  const { data: order, error: orderError } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("*, dealers!inner(location)")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    console.error("[dispatch-service] Ordine non trovato:", orderId);
    return null;
  }

  const merchantLat = order.dealers.location?.latitude;
  const merchantLon = order.dealers.location?.longitude;

  if (!merchantLat || !merchantLon) {
    console.warn("[dispatch-service] Merchant location mancante, broadcast saltato");
    return null;
  }

  // 2. Broadcast tier 0: rider online, top reputation (>= 70), nearest in radius
  const riders = await getRidersByTier(0, merchantLat, merchantLon, CONSTANTS.BROADCAST.radius_km);

  if (riders.length === 0) {
    console.warn("[dispatch-service] Nessun rider tier 0 disponibile, escalation via cron");
    // Setta broadcast_tier=0, broadcast_started_at → escalation-tick se ne occupa
    await supabase
      .from(CONSTANTS.TABLE_ORDERS)
      .update({
        broadcast_tier: 0,
        broadcast_started_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    return null;
  }

  // 3. Notifica riders tier 0
  await notifyRiders(bot, orderId, order as Order, riders);

  // 4. Setta broadcast_tier=0
  await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .update({
      broadcast_tier: 0,
      broadcast_started_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  console.log(
    `[dispatch-service] Ordine ${orderId} broadcast tier 0: ${riders.length} rider notificati`
  );
  return null; // Non assegnato ancora, aspetta accept callback
}

/**
 * Assegnazione diretta (manuale admin).
 */
async function directAssignRider(
  bot: Bot,
  orderId: string,
  riderId: string
): Promise<string | null> {
  const supabase = getSupabaseClient();

  const { data: rider, error: riderError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .select("*")
    .eq("id", riderId)
    .single();

  if (riderError || !rider) {
    console.error("[dispatch-service] Rider non trovato:", riderId);
    return null;
  }

  // Update ordine
  const { error: updateError } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .update({
      assigned_rider_id: riderId,
      status: OrderStatus.ASSIGNED,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error("[dispatch-service] Errore assegnazione diretta:", updateError);
    return null;
  }

  // Notifica rider
  const { data: order } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("*")
    .eq("id", orderId)
    .single();

  if (order && rider.telegram_user_id) {
    await notifyRiders(bot, orderId, order as Order, [rider as Rider]);
  }
  await notifyMerchant(bot, "rider_assigned", orderId, rider.name);

  console.log(`[dispatch-service] Ordine ${orderId} assegnato direttamente a rider ${riderId}`);
  return riderId;
}

/**
 * Recupera rider per tier (reputation_score threshold + PostGIS nearest).
 */
async function getRidersByTier(
  tier: number,
  lat: number,
  lon: number,
  radiusKm: number
): Promise<Rider[]> {
  const supabase = getSupabaseClient();

  const minReputation = CONSTANTS.BROADCAST.tier_thresholds[tier as 0 | 1 | 2 | 3] || 0;
  const maxRiders = CONSTANTS.BROADCAST.max_riders_per_tier;

  // PostGIS query: rider online, reputation >= threshold, nearest in radius
  // ST_DWithin usa metri, quindi radiusKm * 1000
  const { data: riders, error } = await supabase.rpc("get_riders_by_tier", {
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radiusKm * 1000,
    p_min_reputation: minReputation,
    p_max_riders: maxRiders,
  });

  if (error) {
    console.error("[dispatch-service] Error getting riders by tier:", error);
    // Fallback: query semplice senza PostGIS
    const { data: fallbackRiders } = await supabase
      .from(CONSTANTS.TABLE_RIDERS)
      .select("*")
      .eq("status", RiderStatus.ONLINE)
      .gte("reputation_score", minReputation)
      .order("reputation_score", { ascending: false })
      .limit(maxRiders);

    return (fallbackRiders as Rider[]) || [];
  }

  return (riders as Rider[]) || [];
}

/**
 * Notifica rider via Telegram con bottoni accept/decline.
 */
async function notifyRiders(bot: Bot, orderId: string, order: Order, riders: Rider[]): Promise<void> {
  for (const rider of riders) {
    if (!rider.telegram_user_id) continue;

    const message = `
🚚 **NUOVO ORDINE**

Ordine: #${orderId.slice(0, 8).toUpperCase()}
Ritiro: ${order.pickup_point}
Consegna: ${order.delivery_address}
Destinatario: ${order.recipient_name} (${order.recipient_phone})
${order.time_window ? `Finestra: ${order.time_window}` : ""}
${order.notes ? `Note: ${order.notes}` : ""}
${order.delivery_fee_shown ? `💰 Consegna: €${order.delivery_fee_shown.toFixed(2)}` : ""}

**Accetti questo ordine?**
    `.trim();

    try {
      await bot.api.sendMessage(rider.telegram_user_id, message, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Accetto",
                callback_data: `${CONSTANTS.CALLBACK_ACCEPT_ORDER}_${orderId}`,
              },
              {
                text: "❌ Rifiuto",
                callback_data: `${CONSTANTS.CALLBACK_DECLINE_ORDER}_${orderId}`,
              },
            ],
          ],
        },
      });

      console.log(`[dispatch-service] Rider ${rider.id} notificato per ordine ${orderId}`);
    } catch (err) {
      console.error("[dispatch-service] Errore notifica rider Telegram:", err);
    }
  }
}

/**
 * Escalation broadcast tier (chiamata da escalation-tick cron).
 * Query ordini PENDING con broadcast_started_at e tier corrente,
 * scala tier e notifica nuovi rider.
 */
export async function escalateBroadcastTier(): Promise<void> {
  const supabase = getSupabaseClient();

  const now = new Date();

  // Query ordini PENDING con broadcast_started_at
  const { data: orders, error } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("*, dealers!inner(location)")
    .eq("status", OrderStatus.PENDING)
    .not("broadcast_started_at", "is", null)
    .lt("broadcast_tier", 3); // tier < 3 (0,1,2 escalation possibili)

  if (error || !orders || orders.length === 0) {
    return; // Nessun ordine da escalare
  }

  for (const order of orders) {
    const startedAt = new Date(order.broadcast_started_at!);
    const elapsedSec = (now.getTime() - startedAt.getTime()) / 1000;

    const currentTier = order.broadcast_tier || 0;
    let newTier = currentTier;

    // Escalation thresholds: tier 0→1 dopo 60s, 1→2 dopo 120s, 2→3 dopo 180s
    if (currentTier === 0 && elapsedSec >= 60) newTier = 1;
    else if (currentTier === 1 && elapsedSec >= 120) newTier = 2;
    else if (currentTier === 2 && elapsedSec >= 180) newTier = 3;

    if (newTier === currentTier) continue; // Nessuna escalation

    console.log(
      `[dispatch-service] Escalation ordine ${order.id}: tier ${currentTier} → ${newTier}`
    );

    // Update tier
    await supabase
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ broadcast_tier: newTier })
      .eq("id", order.id);

    // Notifica nuovi rider (tier 3 usa raggio esteso)
    const merchantLat = order.dealers.location?.latitude;
    const merchantLon = order.dealers.location?.longitude;

    if (!merchantLat || !merchantLon) continue;

    const radius =
      newTier === 3 ? CONSTANTS.BROADCAST.extended_radius_km : CONSTANTS.BROADCAST.radius_km;
    const riders = await getRidersByTier(newTier, merchantLat, merchantLon, radius);

    if (riders.length === 0) {
      console.warn(`[dispatch-service] Tier ${newTier} nessun rider disponibile per ${order.id}`);
      // Tier 3: alert admin (implementare notifica admin Telegram)
      if (newTier === 3) {
        console.error(
          `[dispatch-service] ALERT ADMIN: ordine ${order.id} tier 3, nessun rider trovato`
        );
        // TODO: invia messaggio a SHOSHY con /manual_dispatch
      }
      continue;
    }

    // Notifica riders (serve bot instance → delegato a escalation-tick)
    console.log(`[dispatch-service] Tier ${newTier}: ${riders.length} rider da notificare`);
    // NOTA: escalation-tick deve chiamare notifyRiders con bot instance
  }
}
