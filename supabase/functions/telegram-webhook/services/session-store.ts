// ============================================================================
// DLOOP SAAS — SESSION STORE (sostituisce Map in-memory)
// ============================================================================
// CRUD per telegram_sessions table. Ogni operazione async verso Supabase.
// ============================================================================

import { getSupabaseClient } from "../shared/supabase.ts";
import { CONSTANTS } from "../shared/config.ts";
import { TelegramSessionRow, CommandStep, Order } from "../shared/types.ts";

/**
 * Recupera sessione attiva (non scaduta) per chat_id.
 * Ritorna null se non esiste o e' scaduta.
 */
export async function getSession(
  chatId: number
): Promise<TelegramSessionRow | null> {
  const { data, error } = await getSupabaseClient()
    .from(CONSTANTS.TABLE_TELEGRAM_SESSIONS)
    .select("*")
    .eq("chat_id", chatId)
    .gt("expires_at", new Date().toISOString()) // Solo non scadute
    .maybeSingle();

  if (error || !data) return null;
  return data as TelegramSessionRow;
}

/**
 * Crea o aggiorna sessione. expires_at si rinnova automaticamente via trigger.
 */
export async function upsertSession(
  chatId: number,
  userId: number,
  step: CommandStep,
  orderDraft: Partial<Order>,
  tempData?: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(CONSTANTS.TABLE_TELEGRAM_SESSIONS)
    .upsert(
      {
        chat_id: chatId,
        user_id: userId,
        step,
        order_draft: orderDraft,
        temp_data: tempData || {},
      },
      { onConflict: "chat_id" }
    );

  if (error) {
    console.error("[session-store] upsertSession error:", error.message);
    throw error;
  }
}

/**
 * Cancella sessione (es. su annullamento o completamento).
 */
export async function deleteSession(chatId: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(CONSTANTS.TABLE_TELEGRAM_SESSIONS)
    .delete()
    .eq("chat_id", chatId);

  if (error) {
    console.error("[session-store] deleteSession error:", error.message);
  }
}

/**
 * Cleanup manuale sessioni scadute (opzionale, pg_cron puo' chiamare function SQL).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc(
    "cleanup_expired_telegram_sessions"
  );

  if (error) {
    console.error("[session-store] cleanup error:", error.message);
    return 0;
  }
  return (data as number) || 0;
}
