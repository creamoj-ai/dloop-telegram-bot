// ============================================================================
// DLOOP SAAS — ESCALATION-TICK (pg_cron function, ogni 60s)
// ============================================================================
// Scala broadcast tier per ordini PENDING: tier 0→1→2→3.
// Chiamato da pg_cron job `dloop-escalation-tick`.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Shared config
const CONFIG = {
  telegram: {
    token: Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  },
  supabase: {
    url: Deno.env.get("SUPABASE_URL") || "",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  },
  broadcast: {
    radiusKm: 5,
    extendedRadiusKm: 10,
    maxRidersPerTier: 5,
    tierThresholds: {
      0: 70,
      1: 40,
      2: 0,
      3: 0,
    },
  },
};

const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey);

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
    });
  }

  try {
    console.log("[escalation-tick] Running escalation check...");

    await escalatePendingOrders();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[escalation-tick] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/**
 * Scala tier per ordini PENDING con broadcast_started_at:
 * - tier 0 + elapsed >= 60s → tier 1
 * - tier 1 + elapsed >= 120s → tier 2
 * - tier 2 + elapsed >= 180s → tier 3
 */
async function escalatePendingOrders() {
  const now = new Date();

  // Query ordini PENDING con broadcast_started_at e tier < 3
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, dealers!inner(location)")
    .eq("status", "pending")
    .not("broadcast_started_at", "is", null)
    .lt("broadcast_tier", 3);

  if (error) {
    console.error("[escalation-tick] Error fetching orders:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No orders to escalate");
    return;
  }

  for (const order of orders) {
    const startedAt = new Date(order.broadcast_started_at!);
    const elapsedSec = (now.getTime() - startedAt.getTime()) / 1000;

    const currentTier = order.broadcast_tier || 0;
    let newTier = currentTier;

    // Escalation thresholds
    if (currentTier === 0 && elapsedSec >= 60) newTier = 1;
    else if (currentTier === 1 && elapsedSec >= 120) newTier = 2;
    else if (currentTier === 2 && elapsedSec >= 180) newTier = 3;

    if (newTier === currentTier) continue; // Nessuna escalation

    console.log(`[escalation-tick] Escalation ordine ${order.id}: tier ${currentTier} → ${newTier}`);

    // Update tier
    await supabase.from("orders").update({ broadcast_tier: newTier }).eq("id", order.id);

    // Notifica nuovi rider
    const merchantLat = order.dealers.location?.latitude;
    const merchantLon = order.dealers.location?.longitude;

    if (!merchantLat || !merchantLon) {
      console.warn(`[escalation-tick] Merchant location mancante per ordine ${order.id}`);
      continue;
    }

    const radius = newTier === 3 ? CONFIG.broadcast.extendedRadiusKm : CONFIG.broadcast.radiusKm;
    const riders = await getRidersByTier(newTier, merchantLat, merchantLon, radius);

    if (riders.length === 0) {
      console.warn(`[escalation-tick] Tier ${newTier} nessun rider disponibile per ${order.id}`);

      // Tier 3: alert admin
      if (newTier === 3) {
        await alertAdmin(order.id);
      }
      continue;
    }

    // Notifica riders
    await notifyRiders(order.id, order, riders);
    console.log(`[escalation-tick] Tier ${newTier}: ${riders.length} rider notificati per ${order.id}`);
  }
}

/**
 * Recupera rider per tier (PostGIS nearest + reputation threshold).
 */
async function getRidersByTier(
  tier: number,
  lat: number,
  lon: number,
  radiusKm: number
): Promise<any[]> {
  const minReputation = CONFIG.broadcast.tierThresholds[tier as 0 | 1 | 2 | 3] || 0;
  const maxRiders = CONFIG.broadcast.maxRidersPerTier;

  const { data: riders, error } = await supabase.rpc("get_riders_by_tier", {
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radiusKm * 1000,
    p_min_reputation: minReputation,
    p_max_riders: maxRiders,
  });

  if (error) {
    console.error("[escalation-tick] Error getting riders by tier:", error);
    return [];
  }

  return riders || [];
}

/**
 * Notifica rider via Telegram (bottoni accept/decline).
 * USA BOT RIDER separato (via HTTP API diretta, no Bot instance).
 */
async function notifyRiders(orderId: string, order: any, riders: any[]) {
  const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";

  if (!TELEGRAM_RIDER_BOT_TOKEN) {
    console.error("[escalation-tick] TELEGRAM_RIDER_BOT_TOKEN non configurato");
    return;
  }

  for (const rider of riders) {
    if (!rider.telegram_user_id) continue;

    // Build info pacco (taglia, colli, fragile)
    const packageInfo = [];
    if (order.package_size) packageInfo.push(`📦 ${order.package_size}`);
    if (order.package_count && order.package_count > 1) packageInfo.push(`${order.package_count} colli`);
    if (order.is_fragile) packageInfo.push(`⚠️ Fragile`);

    const message = `
🚚 **NUOVO ORDINE** (tier ${order.broadcast_tier})

Ordine: #${orderId.slice(0, 8).toUpperCase()}
📍 Ritiro: ${order.pickup_point}
📍 Consegna: ${order.delivery_address}
👤 Destinatario: ${order.recipient_name}
📱 Telefono: ${order.recipient_phone}
${packageInfo.length > 0 ? `📦 Pacco: ${packageInfo.join(' • ')}` : ""}
${order.time_window ? `⏰ Finestra: ${order.time_window}` : ""}
${order.notes ? `📝 Note: ${order.notes}` : ""}
${order.delivery_fee_shown ? `💰 Compenso: €${order.delivery_fee_shown.toFixed(2)}` : ""}

**Accetti questo ordine?**
    `.trim();

    try {
      // Invia via HTTP API diretta (bot rider separato)
      const url = `https://api.telegram.org/bot${TELEGRAM_RIDER_BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: rider.telegram_user_id,
          text: message,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Accetto", callback_data: `accept_order_${orderId}` },
                { text: "❌ Rifiuto", callback_data: `decline_order_${orderId}` },
              ],
            ],
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[escalation-tick] Error notifying rider ${rider.id}:`, errorText);
      } else {
        console.log(`[escalation-tick] Rider ${rider.id} notificato (tier ${order.broadcast_tier})`);
      }
    } catch (err) {
      console.error(`[escalation-tick] Error notifying rider ${rider.id}:`, err);
    }
  }
}

/**
 * Alert admin su tier 3 (nessun rider disponibile).
 */
async function alertAdmin(orderId: string) {
  const shoshyUserId = parseInt(Deno.env.get("SHOSHY_TELEGRAM_USER_ID") || "0");

  if (!shoshyUserId) {
    console.warn("[escalation-tick] SHOSHY_TELEGRAM_USER_ID non configurato, skip alert admin");
    return;
  }

  const message = `
🚨 **ALERT ADMIN: Ordine tier 3**

Ordine #${orderId.slice(0, 8).toUpperCase()} ha raggiunto tier 3 (raggio esteso), nessun rider trovato.

Usa /assign_rider <order_id> <rider_id> per assegnazione manuale.
  `.trim();

  try {
    await bot.api.sendMessage(shoshyUserId, message, { parse_mode: "Markdown" });
    console.log(`[escalation-tick] Admin alert sent for order ${orderId}`);
  } catch (err) {
    console.error("[escalation-tick] Error sending admin alert:", err);
  }
}
