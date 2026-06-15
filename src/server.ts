// ============================================================================
// DLOOP TELEGRAM BOT - SERVER ENTRY POINT
// ============================================================================

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

// Load environment variables FIRST
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");
console.log("📂 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.warn("⚠️ Warning loading .env:", result.error.message);
} else {
  console.log("✅ .env loaded successfully");
}

// NOW we can dynamically import config
const { CONFIG, logConfig } = await import("./config.js");
const { initializeBot, setupWebhook, telegramBot } = await import("./telegram-bot-core.js");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram webhook route
const WEBHOOK_PATH = `/telegram/${process.env.TELEGRAM_BOT_TOKEN}`;
app.post(WEBHOOK_PATH, (req, res) => {
  telegramBot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({
    status: "running",
    bot: "Dloop Telegram Bot v1.0",
    environment: CONFIG.runtime.environment,
    telegram: {
      botUsername: CONFIG.telegram.botUsername,
      webhookUrl: CONFIG.telegram.webhookUrl ? "configured" : "polling",
    },
    timestamp: new Date().toISOString(),
  });
});

// Webhook endpoint (if using webhook mode)
if (CONFIG.telegram.webhookUrl) {
  app.post(`/webhook/${CONFIG.telegram.token}`, (req, res) => {
    // Handled by telegram-bot-core.ts
    res.sendStatus(200);
  });
}

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: CONFIG.runtime.debug ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─────────────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────────────

const PORT = CONFIG.telegram.webhookPort;

async function startServer() {
  try {
    console.log(`
╔════════════════════════════════════════════╗
║   DLOOP TELEGRAM BOT v1.0 - STARTING       ║
╚════════════════════════════════════════════╝
    `);

    // Initialize bot
    await initializeBot();

    // Start Express server
    app.listen(PORT, async () => {
      console.log(`
✅ Server listening on port ${PORT}
📡 Environment: ${CONFIG.runtime.environment}
🤖 Bot: ${CONFIG.telegram.botUsername}
    `);

      // Setup webhook now that server is listening
      await setupWebhook();

      console.log(`
Ready to receive orders! 🚀
      `);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n⏹️ Shutting down gracefully...");
  process.exit(0);
});

startServer();
