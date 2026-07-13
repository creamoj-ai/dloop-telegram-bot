// ============================================================================
// DLOOP SAAS — ORDER SERVICE (SaaS puro)
// ============================================================================
// Crea ordini consegna + token deduction. NO Stripe link, NO articoli/prezzi.
// ============================================================================

import { getSupabaseClient } from "../shared/supabase.ts";
import { CONSTANTS } from "../shared/config.ts";
import { Order, OrderStatus } from "../shared/types.ts";

/**
 * Crea ordine consegna + deduce 1 token dal merchant.
 * Lancia eccezione se saldo token insufficiente.
 *
 * @returns order_id creato
 */
export async function createDeliveryOrder(
  orderDraft: Partial<Order>
): Promise<string> {
  const supabase = getSupabaseClient();

  // Valida campi obbligatori
  if (
    !orderDraft.merchant_id ||
    !orderDraft.pickup_point ||
    !orderDraft.delivery_address ||
    !orderDraft.recipient_name ||
    !orderDraft.recipient_phone
  ) {
    throw new Error("Campi obbligatori mancanti per creare ordine");
  }

  const orderId = crypto.randomUUID();

  // 1. Crea ordine
  const { error: insertError } = await supabase.from(CONSTANTS.TABLE_ORDERS).insert({
    id: orderId,
    merchant_id: orderDraft.merchant_id,
    pickup_point: orderDraft.pickup_point,
    delivery_address: orderDraft.delivery_address,
    recipient_name: orderDraft.recipient_name,
    recipient_phone: orderDraft.recipient_phone,
    time_window: orderDraft.time_window || null,
    notes: orderDraft.notes || null,
    payment_mode: orderDraft.payment_mode || "delivery_on_completion",
    source: orderDraft.source || "telegram_manual",
    mode: orderDraft.mode || "dispatch",
    status: OrderStatus.PENDING,
    package_size: orderDraft.package_size || null,
    package_count: orderDraft.package_count || 1,
    is_fragile: orderDraft.is_fragile || false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error("[order-service] createDeliveryOrder insert error:", insertError);
    throw new Error(`Errore creazione ordine: ${insertError.message}`);
  }

  // 2. Deduce token (lancia exception se saldo < 1)
  const { error: tokenError } = await supabase.rpc("deduct_token", {
    p_merchant_id: orderDraft.merchant_id,
    p_order_id: orderId,
  });

  if (tokenError) {
    // Rollback: cancella ordine appena creato
    await supabase.from(CONSTANTS.TABLE_ORDERS).delete().eq("id", orderId);

    console.error("[order-service] deduct_token error:", tokenError);
    throw new Error(`Saldo token insufficiente o errore deduzione`);
  }

  console.log(`[order-service] Ordine ${orderId} creato, 1 token dedotto`);
  return orderId;
}

/**
 * Cancella ordine e fa refund token se status < picked_up.
 */
export async function cancelOrder(orderId: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  // 1. Recupera ordine per check status
  const { data: order, error: fetchError } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .select("status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    console.error("[order-service] cancelOrder fetch error:", fetchError);
    return false;
  }

  // 2. Se gia' picked_up o completato, non puo' essere cancellato
  if (
    order.status === OrderStatus.PICKED_UP ||
    order.status === OrderStatus.IN_DELIVERY ||
    order.status === OrderStatus.COMPLETED
  ) {
    console.warn(
      `[order-service] Ordine ${orderId} non cancellabile: status=${order.status}`
    );
    return false;
  }

  // 3. Update status a cancelled
  const { error: updateError } = await supabase
    .from(CONSTANTS.TABLE_ORDERS)
    .update({ status: OrderStatus.CANCELLED, updated_at: new Date().toISOString() })
    .eq("id", orderId);

  if (updateError) {
    console.error("[order-service] cancelOrder update error:", updateError);
    return false;
  }

  // 4. Refund token
  const { data: refunded, error: refundError } = await supabase.rpc("refund_token", {
    p_order_id: orderId,
  });

  if (refundError) {
    console.error("[order-service] refund_token error:", refundError);
  } else if (refunded) {
    console.log(`[order-service] Ordine ${orderId} cancellato, token rimborsato`);
  }

  return true;
}
