// ============================================================================
// DLOOP TELEGRAM BOT - CONFIGURATION
// ============================================================================

/**
 * Load and validate all environment variables at startup.
 * Fails fast if any required secret is missing.
 */

export const CONFIG = {
  // ─────────────────────────────────────────────────────────────────────
  // TELEGRAM BOT
  // ─────────────────────────────────────────────────────────────────────
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    botUsername: process.env.TELEGRAM_BOT_USERNAME || "",
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || "", // e.g., https://dloop-bot.render.com/webhook
    webhookPort: parseInt(process.env.WEBHOOK_PORT || "3000"),
    // SHOSHY's Telegram user ID for admin commands
    shoshy_user_id: parseInt(process.env.SHOSHY_TELEGRAM_USER_ID || "0"),
  },

  // ─────────────────────────────────────────────────────────────────────
  // SUPABASE
  // ─────────────────────────────────────────────────────────────────────
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    projectId: process.env.SUPABASE_PROJECT_ID || "",
  },

  // ─────────────────────────────────────────────────────────────────────
  // STRIPE (TEST MODE)
  // ─────────────────────────────────────────────────────────────────────
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "", // Set after creating webhook
  },

  // ─────────────────────────────────────────────────────────────────────
  // FIREBASE (FCM PUSH NOTIFICATIONS)
  // ─────────────────────────────────────────────────────────────────────
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    serviceAccountKeyPath: process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || "",
    // Will be loaded as JSON from serviceAccountKeyPath
    serviceAccountKey: null as any, // Loaded at startup
  },

  // ─────────────────────────────────────────────────────────────────────
  // ANTHROPIC (CLAUDE AI FOR ORDER PARSING)
  // ─────────────────────────────────────────────────────────────────────
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  },

  // ─────────────────────────────────────────────────────────────────────
  // RUNTIME SETTINGS
  // ─────────────────────────────────────────────────────────────────────
  runtime: {
    environment: process.env.NODE_ENV || "development",
    debug: process.env.DEBUG === "true",
    sessionTimeoutMinutes: 30,
    maxOrderItemsPerOrder: 50,
  },

  // ─────────────────────────────────────────────────────────────────────
  // PRICING & FEES
  // ─────────────────────────────────────────────────────────────────────
  pricing: {
    stripeFeePercentage: 3.5, // 3.5% Stripe processing fee
    minOrderAmount: 5, // EUR
    maxOrderAmount: 500, // EUR
  },
};

// ─────────────────────────────────────────────────────────────────────
// VALIDATION & INITIALIZATION
// ─────────────────────────────────────────────────────────────────────

export function validateConfig(): void {
  const requiredVars = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "FIREBASE_PROJECT_ID",
    "ANTHROPIC_API_KEY",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(
      "❌ MISSING REQUIRED ENVIRONMENT VARIABLES:",
      missing.join(", ")
    );
    process.exit(1);
  }

  // Load Firebase service account key from file
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
    try {
      const fs = require("fs");
      const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
      const keyData = fs.readFileSync(keyPath, "utf-8");
      CONFIG.firebase.serviceAccountKey = JSON.parse(keyData);
      console.log("✅ Firebase service account key loaded");
    } catch (err) {
      console.error("❌ Failed to load Firebase service account key:", err);
      process.exit(1);
    }
  }

  console.log("✅ All environment variables validated");
}

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────

export const CONSTANTS = {
  // Telegram command prefixes
  COMMAND_START_ORDER: "/start_order",
  COMMAND_ASSIGN_RIDER: "/assign_rider",
  COMMAND_LIST_ORDERS: "/list_orders",
  COMMAND_RIDER_STATUS: "/rider_status",
  COMMAND_MANUAL_DISPATCH: "/manual_dispatch",
  COMMAND_CANCEL_ORDER: "/cancel_order",

  // Callback data prefixes (for inline buttons)
  CALLBACK_ACCEPT_ORDER: "accept_order",
  CALLBACK_DECLINE_ORDER: "decline_order",
  CALLBACK_CONFIRM_ITEMS: "confirm_items",
  CALLBACK_CANCEL_SESSION: "cancel_session",

  // Session timeout
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes

  // Database table names
  TABLE_ORDERS: "orders",
  TABLE_DEALERS: "dealers",
  TABLE_RIDERS: "riders",
  TABLE_DELIVERY_HISTORY: "delivery_history",
  TABLE_TRAINING_EXAMPLES: "training_examples",
  TABLE_MARKET_PRODUCTS: "market_products",
  TABLE_DEALER_CATEGORIES: "dealer_categories",

  // Few-shot learning settings
  FEW_SHOT_MAX_EXAMPLES: 5,
  FEW_SHOT_MIN_QUALITY_SCORE: 3,

  // Market products context settings
  CATALOG_MAX_PRODUCTS: 50,       // Max products to include in AI context
  CATALOG_CONTEXT_ENABLED: true,  // Toggle catalog injection on/off

  // Multi-category settings
  CATEGORY_DETECTION_ENABLED: true,   // Enable text-based category detection as fallback
  DEFAULT_CATEGORY: "food",           // Default category when none is detected
  CATEGORY_SEED_EXAMPLES_ENABLED: true, // Use seed examples from category definitions on cold start
};

// ─────────────────────────────────────────────────────────────────────
// UTILITY: Format config for logging (hide secrets)
// ─────────────────────────────────────────────────────────────────────

export function logConfig(): void {
  const safe = {
    telegram: {
      botUsername: CONFIG.telegram.botUsername,
      webhookUrl: CONFIG.telegram.webhookUrl ? "SET" : "NOT_SET",
      shoshy_user_id: CONFIG.telegram.shoshy_user_id,
    },
    supabase: {
      url: CONFIG.supabase.url ? "SET" : "NOT_SET",
      projectId: CONFIG.supabase.projectId,
    },
    stripe: {
      secretKey: CONFIG.stripe.secretKey ? "SET" : "NOT_SET",
      publishableKey: CONFIG.stripe.publishableKey,
    },
    firebase: {
      projectId: CONFIG.firebase.projectId,
      serviceAccountKey: CONFIG.firebase.serviceAccountKey ? "SET" : "NOT_SET",
    },
    runtime: CONFIG.runtime,
  };
  console.log("📋 Configuration loaded:", JSON.stringify(safe, null, 2));
}
