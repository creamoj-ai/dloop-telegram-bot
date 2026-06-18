// ============================================================================
// DLOOP SAAS — WEEKLY BILLING (Cron Edge Function)
// ============================================================================
// Somma token consumati settimanalmente -> genera Stripe invoice.
// Schedule: ogni lunedi 00:00 UTC (cron config in supabase/config.toml)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.11.0";

serve(async (req: Request) => {
  try {
    // 1. Init clients
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 2. Calcola settimana precedente (lunedi-domenica)
    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - now.getDay() - 6); // Lunedi scorso
    lastMonday.setHours(0, 0, 0, 0);

    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    lastSunday.setHours(23, 59, 59, 999);

    console.log(`[billing] Processing week: ${lastMonday.toISOString()} - ${lastSunday.toISOString()}`);

    // 3. Query token consumati per merchant (amount < 0 = ordini)
    const { data: consumptions, error: queryError } = await supabase
      .from("token_ledger")
      .select("merchant_id, amount")
      .lt("amount", 0) // Solo deduzioni (no onboarding/refund)
      .gte("created_at", lastMonday.toISOString())
      .lte("created_at", lastSunday.toISOString());

    if (queryError) throw queryError;

    if (!consumptions || consumptions.length === 0) {
      console.log("[billing] No consumptions this week");
      return new Response(JSON.stringify({ message: "No invoices to generate" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Aggrega per merchant_id
    const merchantConsumptions = new Map<string, number>();
    for (const row of consumptions) {
      const current = merchantConsumptions.get(row.merchant_id) || 0;
      merchantConsumptions.set(row.merchant_id, current + Math.abs(row.amount));
    }

    // 5. Genera invoice Stripe per ogni merchant
    const invoices: string[] = [];
    for (const [merchantId, tokensUsed] of merchantConsumptions) {
      // Fetch merchant per Stripe customer
      const { data: merchant } = await supabase
        .from("dealers")
        .select("id, name, stripe_customer_id")
        .eq("id", merchantId)
        .single();

      if (!merchant || !merchant.stripe_customer_id) {
        console.warn(`[billing] Merchant ${merchantId} senza stripe_customer_id, skip`);
        continue;
      }

      // Prezzo: 1 token = 1 EUR + 3.5% Stripe fee passata al cliente
      const subtotal = tokensUsed * 1.0; // EUR
      const stripeFee = subtotal * 0.035;
      const total = subtotal + stripeFee;

      // Crea invoice
      const invoice = await stripe.invoices.create({
        customer: merchant.stripe_customer_id,
        auto_advance: true, // Auto-finalize + auto-charge
        collection_method: "charge_automatically",
        description: `Dloop SaaS - Settimana ${lastMonday.toISOString().slice(0, 10)}`,
        metadata: {
          merchant_id: merchantId,
          week_start: lastMonday.toISOString(),
          tokens_used: tokensUsed.toString(),
        },
      });

      // Aggiungi line items
      await stripe.invoiceItems.create({
        customer: merchant.stripe_customer_id,
        invoice: invoice.id,
        amount: Math.round(subtotal * 100), // cents
        currency: "eur",
        description: `${tokensUsed} consegne Dloop`,
      });

      await stripe.invoiceItems.create({
        customer: merchant.stripe_customer_id,
        invoice: invoice.id,
        amount: Math.round(stripeFee * 100), // cents
        currency: "eur",
        description: "Fee processamento pagamento (3.5%)",
      });

      // Finalize invoice (trigger payment)
      await stripe.invoices.finalizeInvoice(invoice.id);

      invoices.push(invoice.id);
      console.log(`[billing] Invoice ${invoice.id} created for merchant ${merchantId}: €${total.toFixed(2)}`);
    }

    return new Response(
      JSON.stringify({
        message: `${invoices.length} invoices generated`,
        invoices,
        week: `${lastMonday.toISOString().slice(0, 10)} - ${lastSunday.toISOString().slice(0, 10)}`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[billing] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
