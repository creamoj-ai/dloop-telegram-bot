// ============================================================================
// DLOOP SAAS — CONFIGURATION (Deno Edge Functions)
// ============================================================================

export const CONFIG = {
  telegram: {
    token: Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
    botUsername: Deno.env.get("TELEGRAM_BOT_USERNAME") || "",
    shoshyUserId: parseInt(Deno.env.get("SHOSHY_TELEGRAM_USER_ID") || "0"),
    webhookSecret: Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "",
  },
};

export const CONSTANTS = {
  // Tabelle DB
  TABLE_ORDERS: "orders",
  TABLE_MERCHANTS: "dealers", // Nome tabella ancora "dealers" in DB
  TABLE_RIDERS: "riders",
  TABLE_TELEGRAM_SESSIONS: "telegram_sessions",
  TABLE_TOKEN_LEDGER: "token_ledger",
  TABLE_RATINGS: "ratings",
  TABLE_RIDER_LISTINO: "rider_listino",

  // Session
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minuti

  // Callback data prefixes (inline buttons)
  CALLBACK_CONFIRM_ORDER: "confirm_order",
  CALLBACK_CANCEL_SESSION: "cancel_session",
  CALLBACK_ACCEPT_ORDER: "accept_order", // accept_order_{uuid}
  CALLBACK_DECLINE_ORDER: "decline_order", // decline_order_{uuid}
  CALLBACK_PAYMENT_MODE_DELIVERY_ON_COMPLETION: "pm_delivery_on_completion",
  CALLBACK_PAYMENT_MODE_COD: "pm_cod",
  CALLBACK_PAYMENT_MODE_PREPAID: "pm_prepaid",
  CALLBACK_CONFIRM_DELIVERY_PAYMENT: "confirm_delivery_payment", // confirm_delivery_payment_{uuid}
  CALLBACK_PICKUP_CONFIRMED: "pickup_confirmed",                 // pickup_confirmed_{uuid}
  CALLBACK_RATE_RIDER: "rate_rider", // rate_rider_{orderId}_{score}

  // Reputation system
  REPUTATION: {
    weights: {
      avg_rating: 0.35,
      acceptance_rate: 0.20,
      completion_rate: 0.25,
      on_time_rate: 0.20,
    },
    default_score: 50, // Score iniziale rider
  },

  // Delivery fee (mediana zona)
  DELIVERY_FEE: {
    cold_start_default: 3.50, // EUR — tariffa default se < 5 listini in zona
    min_listini_for_median: 5,
  },

  // Broadcast tiered (escalation-tick cron)
  BROADCAST: {
    radius_km: 5, // Raggio zona broadcast base
    extended_radius_km: 10, // Raggio esteso tier 3
    max_riders_per_tier: 5, // Max rider notificati per tier
    tier_thresholds: {
      // reputation_score minimo per tier
      0: 70, // Top reputation
      1: 40, // Media
      2: 0, // Tutti
      3: 0, // Raggio esteso + alert admin
    },
  },
};
