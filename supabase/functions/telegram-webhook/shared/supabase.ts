// ============================================================================
// DLOOP SAAS — SUPABASE CLIENT FACTORY
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

let client: ReturnType<typeof createClient> | null = null;

/**
 * Singleton Supabase client con SERVICE_ROLE_KEY per bypass RLS.
 * Edge Functions iniettano automaticamente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 */
export function getSupabaseClient() {
  if (!client) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check Edge Function env."
      );
    }

    client = createClient(url, key);
  }
  return client;
}
