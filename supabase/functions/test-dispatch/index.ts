// Test dispatch - richiama assignRider manualmente
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Bot } from "https://esm.sh/grammy@1.30.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

serve(async (req: Request) => {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order_id") || "93df32c3-f4e9-4eea-8d4e-9e5dd2e913d3";

  console.log(`[test-dispatch] Testing dispatch for order ${orderId}`);

  // Importa assignRider logic inline
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*, dealers!inner(location)")
    .eq("id", orderId)
    .single();

  console.log('[DEBUG] orderError:', JSON.stringify(orderError));
  console.log('[DEBUG] order:', JSON.stringify(order));

  if (orderError || !order) {
    console.error("[test-dispatch] Ordine non trovato:", orderId);
    return new Response(JSON.stringify({
      error: "Order not found",
      orderError,
      orderId
    }), {
      headers: { "Content-Type": "application/json" },
      status: 404
    });
  }

  return new Response(JSON.stringify({
    success: true,
    order: order ? "found" : "not found",
    hasDealer: !!order?.dealers
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
});
