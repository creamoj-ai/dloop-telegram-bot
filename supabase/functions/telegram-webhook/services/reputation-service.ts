// ============================================================================
// DLOOP SAAS — REPUTATION SERVICE
// ============================================================================
// Formula reputation_score, mediana zona, tracking decline/completion.
// ============================================================================

import { getSupabaseClient } from "../shared/supabase.ts";
import { CONSTANTS } from "../shared/config.ts";
import type { Rider, RiderReputation } from "../shared/types.ts";

/**
 * Calcola reputation_score composito (0-100) usando pesi configurabili.
 */
export function computeReputationScore(rider: Partial<RiderReputation>): number {
  const { avg_rating = 0, acceptance_rate = 1.0, completion_rate = 1.0, on_time_rate = 1.0 } =
    rider;
  const weights = CONSTANTS.REPUTATION.weights;

  // Normalizza avg_rating (1-5 → 0-1)
  const ratingNorm = avg_rating > 0 ? (avg_rating - 1) / 4 : 0;

  const score =
    ratingNorm * weights.avg_rating +
    acceptance_rate * weights.acceptance_rate +
    completion_rate * weights.completion_rate +
    on_time_rate * weights.on_time_rate;

  return Math.round(score * 100); // 0-100
}

/**
 * Ricalcola e persiste reputation_score per un rider.
 */
export async function updateReputationScore(riderId: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Query vista rider_reputation (aggregato con avg_rating)
  const { data: rep, error } = await supabase
    .from("rider_reputation")
    .select("*")
    .eq("rider_id", riderId)
    .single();

  if (error || !rep) {
    console.error(`[reputation-service] Rider ${riderId} not found in rider_reputation view`);
    return;
  }

  const newScore = computeReputationScore(rep as RiderReputation);

  // Update riders.reputation_score
  const { error: updateError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .update({ reputation_score: newScore })
    .eq("id", riderId);

  if (updateError) {
    console.error(`[reputation-service] Error updating reputation_score for ${riderId}:`, updateError);
  } else {
    console.log(`[reputation-service] Rider ${riderId} reputation_score updated: ${newScore}`);
  }
}

/**
 * Ottiene mediana zona da SQL function. NULL se cold start (< 5 listini).
 */
export async function getZoneMedianFee(zona: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc("get_zone_median_fee", { p_zona: zona });

  if (error) {
    console.error(`[reputation-service] Error calling get_zone_median_fee(${zona}):`, error);
    return CONSTANTS.DELIVERY_FEE.cold_start_default;
  }

  // Se NULL (cold start), usa default
  if (data === null) {
    console.log(`[reputation-service] Cold start zona ${zona} — usa default ${CONSTANTS.DELIVERY_FEE.cold_start_default}`);
    return CONSTANTS.DELIVERY_FEE.cold_start_default;
  }

  return parseFloat(data);
}

/**
 * Registra decline rider: decrementa acceptance_rate.
 * Formula: acceptance_rate = accettati / (accettati + rifiutati)
 */
export async function recordDecline(riderId: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Fetch rider corrente
  const { data: rider, error: fetchError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .select("acceptance_rate, total_deliveries")
    .eq("id", riderId)
    .single();

  if (fetchError || !rider) {
    console.error(`[reputation-service] Rider ${riderId} not found for recordDecline`);
    return;
  }

  // Stima declined count (semplificato: accettati = total_deliveries, rifiutati stimati)
  // Formula precisa richiederebbe tabella decline_log. Per MVP: decremento rate fisso.
  const currentRate = rider.acceptance_rate || 1.0;
  const newRate = Math.max(0, currentRate - 0.05); // Penale -5% per decline

  const { error: updateError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .update({ acceptance_rate: newRate })
    .eq("id", riderId);

  if (updateError) {
    console.error(`[reputation-service] Error updating acceptance_rate for ${riderId}:`, updateError);
  } else {
    console.log(`[reputation-service] Rider ${riderId} decline recorded, acceptance_rate: ${newRate.toFixed(2)}`);
    // Ricalcola reputation_score
    await updateReputationScore(riderId);
  }
}

/**
 * Registra completion rider: aggiorna completion_rate, on_time_rate, total_deliveries.
 */
export async function recordCompletion(riderId: string, onTime: boolean): Promise<void> {
  const supabase = getSupabaseClient();

  // Fetch rider corrente
  const { data: rider, error: fetchError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .select("completion_rate, on_time_rate, total_deliveries")
    .eq("id", riderId)
    .single();

  if (fetchError || !rider) {
    console.error(`[reputation-service] Rider ${riderId} not found for recordCompletion`);
    return;
  }

  const totalDeliveries = (rider.total_deliveries || 0) + 1;

  // Moving average completion_rate (assumendo completion sempre ok se chiamato)
  const completionRate = 1.0; // Semplificato: se arriva qui, completion ok

  // Moving average on_time_rate
  const currentOnTimeRate = rider.on_time_rate || 1.0;
  const newOnTimeRate =
    (currentOnTimeRate * (totalDeliveries - 1) + (onTime ? 1 : 0)) / totalDeliveries;

  const { error: updateError } = await supabase
    .from(CONSTANTS.TABLE_RIDERS)
    .update({
      completion_rate: completionRate,
      on_time_rate: newOnTimeRate,
      total_deliveries: totalDeliveries,
    })
    .eq("id", riderId);

  if (updateError) {
    console.error(`[reputation-service] Error updating completion for ${riderId}:`, updateError);
  } else {
    console.log(
      `[reputation-service] Rider ${riderId} completion recorded, total_deliveries: ${totalDeliveries}, on_time: ${onTime}`
    );
    // Ricalcola reputation_score
    await updateReputationScore(riderId);
  }
}
