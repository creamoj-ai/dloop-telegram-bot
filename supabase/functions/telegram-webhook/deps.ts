// ============================================================================
// DLOOP SAAS — DEPENDENCY IMPORTS (Deno Edge Functions)
// ============================================================================
// Centralizza import esterni per consistenza versioni.
// ============================================================================

// --- grammY (Telegram Bot Framework) - ESM diretta ---
export {
  Bot,
  Context,
  webhookCallback,
  InlineKeyboard,
} from "https://esm.sh/grammy@1.30.0";
export type {
  Filter,
  FilterQuery,
} from "https://esm.sh/grammy@1.30.0";

// --- Supabase ---
export { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
export type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// --- Deno std ---
export { serve } from "https://deno.land/std@0.168.0/http/server.ts";
