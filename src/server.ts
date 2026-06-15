// ============================================================================
// DLOOP TELEGRAM BOT - SERVER ENTRY POINT
// ============================================================================

import express from "express";
import dotenv from "dotenv";
import { initializeBot, getTelegramBot } from "./telegram-bot-core";
import { CONFIG, logConfig } from "./config";

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    // Register webhook route AFTER bot initialization
    const telegramBot = getTelegramBot();
    const WEBHOOK_PATH = `/telegram/${CONFIG.telegram.token}`;

    if (CONFIG.telegram.webhookUrl) {
      app.post(WEBHOOK_PATH, (req, res) => {
        try {
          telegramBot.processUpdate(req.body);
          res.sendStatus(200);
        } catch (err) {
          console.error("❌ Error processing Telegram update:", err);
          res.sendStatus(500);
        }
      });
    }

    // Start Express server
    app.listen(PORT, () => {
      console.log(`
✅ Server listening on port ${PORT}
📡 Environment: ${CONFIG.runtime.environment}
🤖 Bot: ${CONFIG.telegram.botUsername}
    `);

      if (CONFIG.telegram.webhookUrl) {
        console.log(`🔗 Webhook URL: ${CONFIG.telegram.webhookUrl}`);
      } else {
        console.log(`⏱️ Using polling mode (check every 300ms)`);
      }

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
