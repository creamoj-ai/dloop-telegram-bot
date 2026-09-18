// ============================================================================
// DLOOP SAAS — ESCALATION-TICK (pg_cron function, ogni 60s)
// ============================================================================
// Scala broadcast tier per ordini PENDING: tier 0→1→2→3.
// Chiamato da pg_cron job `dloop-escalation-tick`.
// ============================================================================
// v2: Fixed escalation for expired delivery slots, improved logging

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

// ─── Blocchi operativi interni (non esposti a cliente/merchant) ───────────────
const MAX_ORDERS_PER_BLOCK = 4;
const ITALY_TZ = "Europe/Rome";
const DISPATCH_BLOCKS = [
  { label: "09-11", startH: 9,  endH: 11 },
  { label: "11-13", startH: 11, endH: 13 },
  { label: "15-17", startH: 15, endH: 17 },
  { label: "17-19", startH: 17, endH: 19 },
  { label: "19-21", startH: 19, endH: 21 },
] as const;

function italyHourOf(d: Date): number {
  return parseInt(
    d.toLocaleTimeString("en-GB", { timeZone: ITALY_TZ, hour: "2-digit", hour12: false })
  );
}

function italyDateOf(d: Date): string {
  return d.toLocaleDateString("sv", { timeZone: ITALY_TZ });
}

function italyHourToUtc(dateStr: string, h: number): Date {
  // Italia è UTC+2 (CEST). Convertire ora italiana a UTC sottraendo 2 ore.
  // Esempio: 19:00 Italia → 17:00 UTC (19 - 2 = 17)
  const utcHour = h - 2;
  return new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00Z`);
}

function getCurrentDispatchBlock(
  now: Date
): { label: string; startUtc: Date; endUtc: Date } | null {
  const h = italyHourOf(now);
  const block = DISPATCH_BLOCKS.find(b => h >= b.startH && h < b.endH);
  if (!block) return null;
  const ds = italyDateOf(now);
  return {
    label: block.label,
    startUtc: italyHourToUtc(ds, block.startH),
    endUtc:   italyHourToUtc(ds, block.endH),
  };
}

/**
 * Parse delivery_slot string (e.g. "19-21" or "19:00-21:00")
 * Returns { startH, endH } or null if invalid format
 */
function parseDeliverySlot(slot: string): { startH: number; endH: number } | null {
  if (!slot) return null;
  const parts = slot.split('-');
  if (parts.length !== 2) return null;

  const startPart = parts[0].trim();
  const endPart = parts[1].trim();

  const startMatch = startPart.match(/(\d{1,2})/);
  const endMatch = endPart.match(/(\d{1,2})/);

  if (!startMatch || !endMatch) return null;

  const startH = parseInt(startMatch[1], 10);
  const endH = parseInt(endMatch[1], 10);

  if (startH < 0 || startH > 23 || endH < 0 || endH > 23) return null;

  return { startH, endH };
}

/**
 * Calculate timing thresholds for delivery slot
 * Returns timestamps for: escalation (T-30min), cancellation (T+5min)
 * Times are calculated in Europe/Rome timezone
 *
 * Handles 3 cases:
 * 1. now è DOPO la fine fascia → usa fascia di domani
 * 2. now è DENTRO la fascia → escalation 15min da ora, cancellation a fine fascia
 * 3. now è PRIMA della fascia → escalation T-30min, cancellation T+5min
 */
function calculateSlotTimestamps(
  slotStr: string,
  now: Date
): { escalationTime: Date; cancellationTime: Date } | null {
  const slot = parseDeliverySlot(slotStr);
  if (!slot) return null;

  const dateStr = italyDateOf(now);

  // Start and end times of delivery slot (in UTC, adjusted for Rome tz)
  const slotStartUtc = italyHourToUtc(dateStr, slot.startH);
  const slotEndUtc = italyHourToUtc(dateStr, slot.endH);

  // CASO 1: now è DOPO la fine fascia → usa fascia di domani
  if (slotEndUtc <= now) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = italyDateOf(tomorrow);
    return {
      escalationTime: new Date(italyHourToUtc(tomorrowStr, slot.startH).getTime() - 30 * 60_000),
      cancellationTime: new Date(italyHourToUtc(tomorrowStr, slot.endH).getTime() + 5 * 60_000),
    };
  }

  // CASO 2: now è DENTRO la fascia (slotStart <= now < slotEnd)
  if (now >= slotStartUtc && now < slotEndUtc) {
    return {
      escalationTime: new Date(now.getTime() + 15 * 60_000),
      cancellationTime: slotEndUtc,
    };
  }

  // CASO 3: now è PRIMA della fascia
  return {
    escalationTime: new Date(slotStartUtc.getTime() - 30 * 60_000),
    cancellationTime: new Date(slotStartUtc.getTime() + 5 * 60_000),
  };
}

async function filterRidersByCapacity(riders: any[]): Promise<any[]> {
  if (riders.length === 0) return [];
  const block = getCurrentDispatchBlock(new Date());
  if (!block) return riders;

  const riderIds = riders.map((r: any) => r.id);
  const { data, error } = await supabase
    .from("orders")
    .select("assigned_rider_id")
    .in("assigned_rider_id", riderIds)
    .in("status", ["assigned", "picked_up", "in_delivery", "waiting_pin", "completed"])
    .gte("created_at", block.startUtc.toISOString())
    .lt("created_at",  block.endUtc.toISOString());

  if (error) {
    console.error("[escalation-tick] filterRidersByCapacity:", error);
    return riders;
  }

  const count = new Map<string, number>();
  for (const o of data ?? []) {
    count.set(o.assigned_rider_id, (count.get(o.assigned_rider_id) ?? 0) + 1);
  }

  const available = riders.filter((r: any) => (count.get(r.id) ?? 0) < MAX_ORDERS_PER_BLOCK);
  const skipped = riders.length - available.length;
  if (skipped > 0) {
    console.log(
      `[escalation-tick] Blocco ${block.label}: esclusi ${skipped} rider (limite ${MAX_ORDERS_PER_BLOCK} consegne/blocco)`
    );
  }
  return available;
}
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
    });
  }

  try {
    console.log("[escalation-tick] Running escalation check...");

    // Cancel timed-out orders first
    await cancelTimedOutOrders();

    // Trigger scheduled broadcasts (when scheduled_broadcast_at <= now)
    await triggerScheduledBroadcasts();

    // Send T-1h confirmation reminders to reserved riders
    await sendRiderConfirmationReminders();

    // Handle timed-out confirmations (15min timeout)
    await handleTimedOutConfirmations();

    // Send T-30min reminders to confirmed riders
    await sendThirtyMinuteReminders();

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
 * Triggera broadcast schedulato per ordini con scheduled_broadcast_at <= now().
 * Setta broadcast_started_at e chiama dispatch-order Edge Function.
 */
async function triggerScheduledBroadcasts() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking scheduled broadcasts at ${nowISO}...`);

  // Query ordini con scheduled_broadcast_at <= now e broadcast_started_at non iniziato
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id")
    .lte("scheduled_broadcast_at", nowISO)
    .is("broadcast_started_at", null)
    .eq("status", "pending");

  if (error) {
    console.error("[escalation-tick] Error fetching scheduled broadcasts:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No scheduled broadcasts to trigger");
    return;
  }

  console.log(`[escalation-tick] Found ${orders.length} scheduled broadcasts to trigger`);

  for (const order of orders) {
    try {
      // Mark broadcast start time
      await supabase
        .from("orders")
        .update({ broadcast_started_at: new Date().toISOString() })
        .eq("id", order.id);

      // Call dispatch-order Edge Function
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const dispatchUrl = `${supabaseUrl}/functions/v1/dispatch-order`;
      const response = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": Deno.env.get("WOZ_ADMIN_KEY") || "",
        },
        body: JSON.stringify({ order_id: order.id }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[escalation-tick] Error dispatching scheduled order ${order.id}:`, errorText);
      } else {
        console.log(`[escalation-tick] Scheduled broadcast triggered for order ${order.id}`);
      }
    } catch (err) {
      console.error(`[escalation-tick] Error processing scheduled order ${order.id}:`, err);
    }
  }
}

/**
 * Annulla ordini scaduti senza rider accettato.
 * - Con delivery_slot: annulla a T+5min dalla fascia oraria
 * - Senza delivery_slot (fallback): annulla dopo 30min da broadcast_started_at
 */
async function cancelTimedOutOrders() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking orders for cancellation at ${nowISO}...`);

  // Query ordini con broadcast_started_at (non ancora annullati/completati)
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, dealer_contact_id, broadcast_started_at, dispatch_status, status, delivery_slot")
    .eq("dispatch_status", "pending")
    .neq("status", "cancelled")
    .neq("status", "completed")
    .neq("status", "accepted")
    .not("broadcast_started_at", "is", null);

  if (error) {
    console.error("[escalation-tick] Error fetching orders for cancellation:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No orders to check for cancellation");
    return;
  }

  const ordersToCancel = [];

  for (const order of orders) {
    let shouldCancel = false;
    let cancelReason = "";

    if (order.delivery_slot) {
      // Cancella a T+5min dalla fascia oraria
      const slotTimes = calculateSlotTimestamps(order.delivery_slot, now);
      if (slotTimes) {
        const cancellationTime = slotTimes.cancellationTime;
        console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: delivery_slot="${order.delivery_slot}", cancellationTime="${cancellationTime.toISOString()}", now="${nowISO}", shouldCancel=${now >= cancellationTime}`);
        if (now >= cancellationTime) {
          shouldCancel = true;
          cancelReason = `fascia ${order.delivery_slot}: scaduto a ${cancellationTime.toISOString()}`;
        }
      } else {
        console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: delivery_slot="${order.delivery_slot}", calculateSlotTimestamps returned null`);
      }
    } else {
      // Fallback: cancella dopo 30min da broadcast_started_at
      const broadcastStart = new Date(order.broadcast_started_at!);
      const thirtyMinutesLater = new Date(broadcastStart.getTime() + 30 * 60_000);
      console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: no delivery_slot, broadcast_started_at="${order.broadcast_started_at}", thirtyMinutesLater="${thirtyMinutesLater.toISOString()}", now="${nowISO}", shouldCancel=${now >= thirtyMinutesLater}`);
      if (now >= thirtyMinutesLater) {
        shouldCancel = true;
        cancelReason = `fallback: 30min da broadcast (${thirtyMinutesLater.toISOString()})`;
      }
    }

    if (shouldCancel) {
      ordersToCancel.push({ ...order, cancelReason });
    }
  }

  if (ordersToCancel.length === 0) {
    console.log("[escalation-tick] No orders to cancel");
    return;
  }

  console.log(`[escalation-tick] Found ${ordersToCancel.length} orders to cancel`);

  // Cancella ordini uno per uno e notifica merchant
  for (const order of ordersToCancel) {
    try {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "cancelled", dispatch_status: "dispatching" })
        .eq("id", order.id);

      if (updateError) {
        console.error(`[escalation-tick] Error cancelling order ${order.id}:`, updateError);
        continue;
      }

      console.log(`[escalation-tick] Ordine ${order.id} annullato (${order.cancelReason})`);

      // Notifica merchant
      if (!order.dealer_contact_id) continue;

      const { data: dealer } = await supabase
        .from("dealers")
        .select("telegram_user_id")
        .eq("id", order.dealer_contact_id)
        .maybeSingle();

      const orderShortId = order.id.slice(0, 8).toUpperCase();
      if (dealer?.telegram_user_id && CONFIG.telegram.token) {
        await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: dealer.telegram_user_id,
            text: `❌ Ordine #${orderShortId} annullato — nessun rider disponibile.`,
          }),
        });
        console.log(`[escalation-tick] Merchant notificato per ordine ${order.id}`);
      }
    } catch (err) {
      console.error(`[escalation-tick] Error processing cancellation for ${order.id}:`, err);
    }
  }
}

/**
 * Escalazione ordini PENDING basata su delivery_slot:
 * - Con delivery_slot: escalation a T-30min dalla fascia oraria (tier 0→1)
 * - Senza delivery_slot: escalation a 60s da broadcast_started_at (tier 0→1, fallback)
 * Una sola escalation a tier 1, poi cancellazione attende il timeout.
 */
async function escalatePendingOrders() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking orders for escalation at ${nowISO}...`);

  // Query ordini PENDING con broadcast_started_at e tier < 1 (non ancora escalati)
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, dealers(pickup_lat, pickup_lng)")
    .eq("status", "pending")
    .not("broadcast_started_at", "is", null)
    .lt("broadcast_tier", 1);

  if (error) {
    console.error("[escalation-tick] Error fetching orders:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No orders to escalate");
    return;
  }

  console.log(`[escalation-tick] Found ${orders.length} orders, checking for escalation...`);

  const ordersToEscalate = [];

  for (const order of orders) {
    console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: dealers=${JSON.stringify(order.dealers)}, delivery_slot="${order.delivery_slot}", broadcast_tier=${order.broadcast_tier}`);

    let shouldEscalate = false;
    let escalationReason = "";

    if (order.delivery_slot) {
      // Escalation a T-30min dalla fascia oraria
      const slot = parseDeliverySlot(order.delivery_slot);
      if (slot) {
        const dateStr = italyDateOf(now);
        const slotEndUtc = italyHourToUtc(dateStr, slot.endH);

        console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: slotEndUtc="${slotEndUtc.toISOString()}", now="${now.toISOString()}", slotEndUtc<=now=${slotEndUtc <= now}`);

        // Se fascia già scaduta → escalate immediatamente
        if (slotEndUtc <= now) {
          shouldEscalate = true;
          escalationReason = `fascia ${order.delivery_slot}: scaduta, escalation immediata`;
          console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: shouldEscalate=true (slot scaduto)`);
        } else {
          // Altrimenti usa T-30min
          const slotTimes = calculateSlotTimestamps(order.delivery_slot, now);
          if (slotTimes) {
            const escalationTime = slotTimes.escalationTime;
            if (now >= escalationTime) {
              shouldEscalate = true;
              escalationReason = `fascia ${order.delivery_slot}: T-30min (${escalationTime.toISOString()})`;
              console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: shouldEscalate=true (T-30min)`);
            } else {
              console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: shouldEscalate=false, escalationTime="${escalationTime.toISOString()}", now="${now.toISOString()}"`);
            }
          }
        }
      }
    } else {
      // Fallback: escalation dopo 60s da broadcast_started_at
      const broadcastStart = new Date(order.broadcast_started_at!);
      const sixtySecondsLater = new Date(broadcastStart.getTime() + 60_000);
      if (now >= sixtySecondsLater) {
        shouldEscalate = true;
        escalationReason = `fallback: 60s da broadcast (${sixtySecondsLater.toISOString()})`;
        console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: shouldEscalate=true (fallback 60s)`);
      } else {
        console.log(`[escalation-tick] Order ${order.id.slice(0, 8)}: shouldEscalate=false (fallback), sixtySecondsLater="${sixtySecondsLater.toISOString()}", now="${now.toISOString()}"`);
      }
    }

    if (shouldEscalate) {
      ordersToEscalate.push({ ...order, escalationReason });
    }
  }

  if (ordersToEscalate.length === 0) {
    console.log("[escalation-tick] No orders ready for escalation");
    return;
  }

  console.log(`[escalation-tick] Found ${ordersToEscalate.length} orders to escalate`);

  for (const order of ordersToEscalate) {
    try {
      const currentTier = order.broadcast_tier || 0;
      const newTier = 1; // Sempre scala a tier 1

      console.log(`[escalation-tick] Escalation ordine ${order.id}: tier ${currentTier} → ${newTier} (${order.escalationReason})`);

      // Update tier
      await supabase.from("orders").update({ broadcast_tier: newTier }).eq("id", order.id);

      // Notifica nuovi rider
      const merchantLat = order.dealers.pickup_lat;
      const merchantLon = order.dealers.pickup_lng;

      if (!merchantLat || !merchantLon) {
        console.warn(`[escalation-tick] Merchant location mancante per ordine ${order.id}`);
        continue;
      }

      const radius = CONFIG.broadcast.radiusKm; // Tier 1: usa raggio standard
      const allRiders = await getRidersByTier(newTier, merchantLat, merchantLon, radius);
      const riders = await filterRidersByCapacity(allRiders);

      if (riders.length === 0) {
        console.warn(`[escalation-tick] Tier ${newTier} nessun rider disponibile per ${order.id}`);
        continue;
      }

      // Notifica riders
      await notifyRiders(order.id, order, riders);
      console.log(`[escalation-tick] Tier ${newTier}: ${riders.length} rider notificati per ${order.id}`);
    } catch (err) {
      console.error(`[escalation-tick] Error escalating order ${order.id}:`, err);
    }
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
${order.delivery_slot ? `⏰ Fascia: ${order.delivery_slot}` : ""}
${order.delivery_notes ? `📝 Note: ${order.delivery_notes}` : ""}
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
 * Reminder T-1h per rider prenotati (status = 'accepted').
 * Invia prompt di conferma al rider: [✅ Confermo] [❌ Non posso]
 * Se no response dopo 15min o [❌] → re-broadcast emergenza.
 */
async function sendRiderConfirmationReminders() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking rider confirmation reminders at ${nowISO}...`);

  // Query ordini con status='accepted' + rider_reserved_at NOT NULL + rider_reminder_sent_at IS NULL
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, assigned_rider_id, delivery_slot, rider_reserved_at, customer_name, restaurant_name, dropoff_address")
    .eq("status", "accepted")
    .not("rider_reserved_at", "is", null)
    .is("rider_reminder_sent_at", null);

  if (error) {
    console.error("[escalation-tick] Error fetching rider reminders:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No rider reminders to send");
    return;
  }

  console.log(`[escalation-tick] Found ${orders.length} orders for confirmation reminders`);

  for (const order of orders) {
    try {
      // Calcola T-1h dalla delivery_slot
      let shouldSendReminder = false;
      let reminderReason = "";

      if (order.delivery_slot) {
        const slot = parseDeliverySlot(order.delivery_slot);
        if (slot) {
          const dateStr = italyDateOf(now);
          const slotStartUtc = italyHourToUtc(dateStr, slot.startH);

          // Se fascia è nel passato, usa domani
          let reminderTime = slotStartUtc;
          if (slotStartUtc <= now) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = italyDateOf(tomorrow);
            reminderTime = italyHourToUtc(tomorrowStr, slot.startH);
          }

          // T-1h prima della fascia
          const oneHourBefore = new Date(reminderTime.getTime() - 60 * 60_000);

          if (now >= oneHourBefore) {
            shouldSendReminder = true;
            reminderReason = `fascia ${order.delivery_slot}: T-1h (${oneHourBefore.toISOString()})`;
          }
        }
      }

      if (!shouldSendReminder) continue;

      // Fetch rider per telegram_user_id
      const { data: rider, error: riderError } = await supabase
        .from("riders")
        .select("id, name, telegram_user_id")
        .eq("id", order.assigned_rider_id)
        .maybeSingle();

      if (riderError || !rider) {
        console.warn(`[escalation-tick] Rider non trovato per ordine ${order.id}`);
        continue;
      }

      if (!rider.telegram_user_id) {
        console.warn(`[escalation-tick] Rider ${rider.id} senza telegram_user_id`);
        continue;
      }

      const orderShortId = order.id.slice(0, 8).toUpperCase();
      const deliverySlot = order.delivery_slot || "N/D";

      const message = `
⏰ **Confermi il ritiro per le ${deliverySlot}?**

Ordine: #${orderShortId}
🏪 ${order.restaurant_name || "Esercente"}
📍 Consegna: ${order.dropoff_address || "N/D"}
👤 Cliente: ${order.customer_name || "N/D"}

Rispondi entro 15 minuti, altrimenti verrà offerto ad altri rider.
      `.trim();

      const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";

      if (!TELEGRAM_RIDER_BOT_TOKEN) {
        console.error("[escalation-tick] TELEGRAM_RIDER_BOT_TOKEN non configurato");
        continue;
      }

      try {
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
                  { text: "✅ Confermo", callback_data: `confirm_rider_${order.id}` },
                  { text: "❌ Non posso", callback_data: `cancel_rider_${order.id}` },
                ],
              ],
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[escalation-tick] Error sending reminder to rider ${rider.id}:`, errorText);
          continue;
        }

        // Aggiorna ordine: setta rider_reminder_sent_at e confirmation_prompt_sent_at
        const { error: updateError } = await supabase
          .from("orders")
          .update({
            rider_reminder_sent_at: nowISO,
            confirmation_prompt_sent_at: nowISO,
          })
          .eq("id", order.id);

        if (updateError) {
          console.error(`[escalation-tick] Error updating order ${order.id}:`, updateError);
          continue;
        }

        console.log(`[escalation-tick] Reminder sent to rider ${rider.id} for order ${order.id} (${reminderReason})`);

      } catch (err) {
        console.error(`[escalation-tick] Error notifying rider ${rider.id}:`, err);
      }

    } catch (err) {
      console.error(`[escalation-tick] Error processing reminder for order ${order.id}:`, err);
    }
  }
}

/**
 * Gestisce timeout 15min per confirmation prompt del rider.
 * Se rider non conferma entro 15min, re-broadcast emergenza.
 */
async function handleTimedOutConfirmations() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking timed-out confirmations at ${nowISO}...`);

  // Query ordini con status='accepted' + confirmation_prompt_sent_at NOT NULL + rider_confirmed_at IS NULL
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, assigned_rider_id, dealer_contact_id, confirmation_prompt_sent_at, restaurant_name, delivery_slot")
    .eq("status", "accepted")
    .not("confirmation_prompt_sent_at", "is", null)
    .is("rider_confirmed_at", null);

  if (error) {
    console.error("[escalation-tick] Error fetching timed-out confirmations:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No timed-out confirmations");
    return;
  }

  const ordersToRebroadcast = [];

  for (const order of orders) {
    const promptSentAt = new Date(order.confirmation_prompt_sent_at!);
    const fifteenMinutesLater = new Date(promptSentAt.getTime() + 15 * 60_000);

    if (now >= fifteenMinutesLater) {
      ordersToRebroadcast.push(order);
    }
  }

  if (ordersToRebroadcast.length === 0) {
    console.log("[escalation-tick] No confirmations timed out");
    return;
  }

  console.log(`[escalation-tick] Found ${ordersToRebroadcast.length} timed-out confirmations`);

  for (const order of ordersToRebroadcast) {
    try {
      const orderShortId = order.id.slice(0, 8).toUpperCase();

      // 1. Reset ordine: torna a pending + svuota rider prenotato
      const { error: resetError } = await supabase
        .from("orders")
        .update({
          status: "pending",
          assigned_rider_id: null,
          rider_reserved_at: null,
          rider_reminder_sent_at: null,
          confirmation_prompt_sent_at: null,
          broadcast_tier: 0,
          broadcast_started_at: nowISO,
        })
        .eq("id", order.id);

      if (resetError) {
        console.error(`[escalation-tick] Error resetting order ${order.id}:`, resetError);
        continue;
      }

      console.log(`[escalation-tick] Ordine ${order.id} resetted per re-broadcast emergenza (confirmation timeout)`);

      // 2. Chiama dispatch-order Edge Function per rilanciare broadcast
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const dispatchUrl = `${supabaseUrl}/functions/v1/dispatch-order`;
        const dispatchResponse = await fetch(dispatchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Key": Deno.env.get("WOZ_ADMIN_KEY") || "",
          },
          body: JSON.stringify({ order_id: order.id }),
        });

        if (!dispatchResponse.ok) {
          const errorText = await dispatchResponse.text();
          console.error(`[escalation-tick] Error rebroadcasting order ${order.id}:`, errorText);
        } else {
          console.log(`[escalation-tick] Re-broadcast triggered for order ${order.id}`);
        }
      } catch (err) {
        console.error(`[escalation-tick] Error calling dispatch-order for ${order.id}:`, err);
      }

      // 3. Notifica merchant
      if (!order.dealer_contact_id) continue;

      const { data: dealer } = await supabase
        .from("dealers")
        .select("telegram_user_id")
        .eq("id", order.dealer_contact_id)
        .maybeSingle();

      if (dealer?.telegram_user_id && CONFIG.telegram.token) {
        const message = `
⚠️ **Ordine #${orderShortId}** — il rider non ha confermato.

Stiamo cercando un nuovo rider per le ${order.delivery_slot || "N/D"}.

📍 ${order.restaurant_name || "Esercente"}

Ti avvertiremo quando un nuovo rider accetterà.
        `.trim();

        try {
          await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: dealer.telegram_user_id,
              text: message,
              parse_mode: "Markdown",
            }),
          });

          console.log(`[escalation-tick] Merchant notificato per timeout confirmation ordine ${order.id}`);
        } catch (err) {
          console.error(`[escalation-tick] Error notifying merchant for ${order.id}:`, err);
        }
      }

    } catch (err) {
      console.error(`[escalation-tick] Error processing timed-out confirmation for ${order.id}:`, err);
    }
  }
}

/**
 * Reminder T-30min per ordini confermati dal rider (status='accepted' + rider_confirmed_at NOT NULL).
 * Invia notifiche a rider e merchant.
 */
async function sendThirtyMinuteReminders() {
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[escalation-tick] Checking 30-minute reminders at ${nowISO}...`);

  // Query ordini con status='accepted' + rider_confirmed_at NOT NULL + thirty_min_reminder_sent_at IS NULL
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, assigned_rider_id, dealer_contact_id, delivery_slot, rider_confirmed_at, customer_name, restaurant_name, dropoff_address")
    .eq("status", "accepted")
    .not("rider_confirmed_at", "is", null)
    .is("thirty_min_reminder_sent_at", null);

  if (error) {
    console.error("[escalation-tick] Error fetching 30-min reminders:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("[escalation-tick] No 30-minute reminders to send");
    return;
  }

  console.log(`[escalation-tick] Found ${orders.length} orders for 30-minute reminders`);

  for (const order of orders) {
    try {
      // Calcola T-30min dalla delivery_slot
      let shouldSendReminder = false;
      let reminderReason = "";

      if (order.delivery_slot) {
        const slot = parseDeliverySlot(order.delivery_slot);
        if (slot) {
          const dateStr = italyDateOf(now);
          const slotStartUtc = italyHourToUtc(dateStr, slot.startH);

          // Se fascia è nel passato, usa domani
          let reminderTime = slotStartUtc;
          if (slotStartUtc <= now) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = italyDateOf(tomorrow);
            reminderTime = italyHourToUtc(tomorrowStr, slot.startH);
          }

          // T-30min prima della fascia
          const thirtyMinBefore = new Date(reminderTime.getTime() - 30 * 60_000);

          if (now >= thirtyMinBefore) {
            shouldSendReminder = true;
            reminderReason = `fascia ${order.delivery_slot}: T-30min (${thirtyMinBefore.toISOString()})`;
          }
        }
      }

      if (!shouldSendReminder) continue;

      // Fetch rider per telegram_user_id
      const { data: rider, error: riderError } = await supabase
        .from("riders")
        .select("id, name, telegram_user_id")
        .eq("id", order.assigned_rider_id)
        .maybeSingle();

      if (riderError || !rider) {
        console.warn(`[escalation-tick] Rider non trovato per ordine ${order.id}`);
        continue;
      }

      if (!rider.telegram_user_id) {
        console.warn(`[escalation-tick] Rider ${rider.id} senza telegram_user_id`);
        continue;
      }

      const orderShortId = order.id.slice(0, 8).toUpperCase();
      const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";

      // 1. Notifica RIDER
      if (TELEGRAM_RIDER_BOT_TOKEN) {
        const riderMessage = `
🔔 **Tra 30 minuti devi ritirare l'ordine!**

Ordine: #${orderShortId}
🏪 ${order.restaurant_name || "Esercente"}
📍 Consegna: ${order.dropoff_address || "N/D"}
👤 Cliente: ${order.customer_name || "N/D"}

Preparati! ⏱️
        `.trim();

        try {
          const riderUrl = `https://api.telegram.org/bot${TELEGRAM_RIDER_BOT_TOKEN}/sendMessage`;
          const riderResponse = await fetch(riderUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: rider.telegram_user_id,
              text: riderMessage,
              parse_mode: "Markdown",
            }),
          });

          if (!riderResponse.ok) {
            const errorText = await riderResponse.text();
            console.error(`[escalation-tick] Error sending 30min reminder to rider ${rider.id}:`, errorText);
          }
        } catch (err) {
          console.error(`[escalation-tick] Error notifying rider ${rider.id}:`, err);
        }
      }

      // 2. Notifica MERCHANT
      const { data: dealer } = await supabase
        .from("dealers")
        .select("telegram_user_id")
        .eq("id", order.dealer_contact_id)
        .maybeSingle();

      if (dealer?.telegram_user_id && CONFIG.telegram.token) {
        const merchantMessage = `
⚠️ **${rider.name}** arriva tra **30 minuti**.

Ordine: #${orderShortId}
📍 ${order.restaurant_name || "Esercente"}

L'ordine è pronto?
        `.trim();

        try {
          await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: dealer.telegram_user_id,
              text: merchantMessage,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Sì, sono pronto", callback_data: `merchant_ready_${order.id}` },
                  ],
                ],
              },
            }),
          });

          console.log(`[escalation-tick] Merchant notificato (30min reminder) per ordine ${order.id}`);
        } catch (err) {
          console.error(`[escalation-tick] Error notifying merchant for ${order.id}:`, err);
        }
      }

      // 3. Aggiorna ordine: setta thirty_min_reminder_sent_at
      const { error: updateError } = await supabase
        .from("orders")
        .update({ thirty_min_reminder_sent_at: nowISO })
        .eq("id", order.id);

      if (updateError) {
        console.error(`[escalation-tick] Error updating order ${order.id}:`, updateError);
        continue;
      }

      console.log(`[escalation-tick] 30-min reminder sent for order ${order.id} (${reminderReason})`);

    } catch (err) {
      console.error(`[escalation-tick] Error processing 30-min reminder for order ${order.id}:`, err);
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
