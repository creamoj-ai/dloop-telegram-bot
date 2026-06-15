// ============================================================================
// DLOOP TELEGRAM BOT - CORE ENGINE
// ============================================================================
// Listener (webhook/polling) + Order receiver + Dealer notifications
// + Inline button handler + SHOSHY command panel
// ============================================================================

import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as fs from "fs";
import * as admin from "firebase-admin";

import {
  Order,
  OrderStatus,
  PaymentStatus,
  Rider,
  RiderStatus,
  Dealer,
  TelegramContext,
  BotSessionState,
  CommandStep,
  OrderNotification,
  AssignRiderPayload,
} from "./types";

import { CONFIG, CONSTANTS, validateConfig, logConfig } from "./config";
import { getAIResponse } from "./claude-integration.js";

// ─────────────────────────────────────────────────────────────────────────
// INITIALIZE CLIENTS
// ─────────────────────────────────────────────────────────────────────────

let telegramBot: TelegramBot;
let supabaseClient: any;
let stripeClient: Stripe;
let firebaseApp: any;

const botSessions = new Map<number, BotSessionState>(); // In-memory session store

// ─────────────────────────────────────────────────────────────────────────
// INITIALIZATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────

export async function initializeBot(): Promise<void> {
  console.log("🚀 Initializing Dloop Telegram Bot...");

  // 1. Validate config
  validateConfig();
  logConfig();

  // 2. Initialize Telegram Bot
  const useWebhook = !!CONFIG.telegram.webhookUrl;

  if (useWebhook) {
    console.log("📡 Using webhook mode");
    telegramBot = new TelegramBot(CONFIG.telegram.token, {
      webHook: {
        port: CONFIG.telegram.webhookPort,
        host: "0.0.0.0",
      },
    });
  } else {
    console.log("⏱️ Using polling mode");
    telegramBot = new TelegramBot(CONFIG.telegram.token, {
      polling: {
        interval: 300,
        autoStart: true,
      },
    });
  }

  // 3. Initialize Supabase
  supabaseClient = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  console.log("✅ Supabase client initialized");

  // 4. Initialize Stripe
  stripeClient = new Stripe(CONFIG.stripe.secretKey, {
    apiVersion: "2023-08-16",
  });
  console.log("✅ Stripe client initialized");

  // 5. Initialize Firebase
  if (CONFIG.firebase.serviceAccountKey) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(CONFIG.firebase.serviceAccountKey),
      projectId: CONFIG.firebase.projectId,
    });
    console.log("✅ Firebase Admin SDK initialized");
  }

  // 6. Register handlers
  registerHandlers();

  console.log("✅ Bot fully initialized!");
}

// ─────────────────────────────────────────────────────────────────────────
// HANDLER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

function registerHandlers(): void {
  // Text messages (commands and free-form input)
  telegramBot.on("message", handleMessage);

  // Callback queries (inline button clicks)
  telegramBot.on("callback_query", handleCallbackQuery);

  // Webhook route setup (if using webhook mode)
  if (CONFIG.telegram.webhookUrl) {
    const app = require("express")();
    const path = `/webhook/${CONFIG.telegram.token}`;
    app.post(path, (req: any, res: any) => {
      telegramBot.processUpdate(req.body);
      res.sendStatus(200);
    });
    app.listen(CONFIG.telegram.webhookPort);
    console.log(
      `✅ Webhook server listening on port ${CONFIG.telegram.webhookPort}`
    );
  }

  console.log("✅ Handlers registered");
}

// ─────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER (Text messages, commands, user input)
// ─────────────────────────────────────────────────────────────────────────

async function handleMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text || "";

  if (!userId) return;

  try {
    // Check if /confirm is used inside an active session
    const session = botSessions.get(chatId);
    if (text === "/confirm" && session) {
      // Treat /confirm as session input when in an active order creation
      await handleSessionInput(chatId, userId, text);
    } else if (text.startsWith("/")) {
      // Other commands
      await handleCommand(chatId, userId, text);
    } else {
      // Free-form input: check if session exists
      if (session) {
        // Existing behavior: process form input
        await handleSessionInput(chatId, userId, text);
      } else {
        // NEW: Intelligent AI response for general inquiries
        try {
          const aiReply = await getAIResponse({
            userMessage: text,
            chatId,
            userId,
          });
          await telegramBot.sendMessage(chatId, aiReply);
        } catch (error) {
          console.error(`❌ AI response failed for chat ${chatId}:`, error);
          await telegramBot.sendMessage(
            chatId,
            "Mi dispiace, non riesco a rispondere ora. Usa /start_order per creare un ordine."
          );
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error handling message from chat ${chatId}:`, err);
    await telegramBot.sendMessage(
      chatId,
      "❌ Errore interno. Contatta SHOSHY se persiste."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// COMMAND HANDLER
// ─────────────────────────────────────────────────────────────────────────

async function handleCommand(
  chatId: number,
  userId: number,
  command: string
): Promise<void> {
  // Normalize command: convert /startorder to /start_order, etc.
  const normalizedCommand = command
    .replace(/startorder/i, "start_order")
    .replace(/listorders/i, "list_orders")
    .replace(/assignrider/i, "assign_rider")
    .replace(/riderstatus/i, "rider_status")
    .replace(/cancelorder/i, "cancel_order")
    .replace(/manualdispatch/i, "manual_dispatch");

  const isAdmin = userId === CONFIG.telegram.shoshy_user_id;

  if (normalizedCommand.startsWith(CONSTANTS.COMMAND_START_ORDER)) {
    // /start_order — Multi-step order creation (Yamamay POC)
    await startOrderCommand(chatId, userId);
  } else if (normalizedCommand.startsWith(CONSTANTS.COMMAND_ASSIGN_RIDER) && isAdmin) {
    // /assign_rider {order_id} {rider_id} — Manual rider assignment (SHOSHY only)
    await assignRiderCommand(chatId, normalizedCommand);
  } else if (normalizedCommand.startsWith(CONSTANTS.COMMAND_LIST_ORDERS) && isAdmin) {
    // /list_orders [status] — Show pending orders (SHOSHY only)
    await listOrdersCommand(chatId, normalizedCommand);
  } else if (normalizedCommand.startsWith(CONSTANTS.COMMAND_RIDER_STATUS) && isAdmin) {
    // /rider_status — Show online riders (SHOSHY only)
    await riderStatusCommand(chatId);
  } else if (normalizedCommand.startsWith(CONSTANTS.COMMAND_MANUAL_DISPATCH) && isAdmin) {
    // /manual_dispatch {order_id} — Force assign with no rider selected
    await manualDispatchCommand(chatId, normalizedCommand);
  } else if (normalizedCommand.startsWith(CONSTANTS.COMMAND_CANCEL_ORDER) && isAdmin) {
    // /cancel_order {order_id} — Cancel an order
    await cancelOrderCommand(chatId, normalizedCommand);
  } else if (normalizedCommand === "/start") {
    // /start — Help menu
    await telegramBot.sendMessage(
      chatId,
      `
🤖 Dloop Bot v1.0

**SHOSHY Commands:**
/start_order - Crea nuovo ordine
/list_orders - Vedi ordini pendenti
/assign_rider {order_id} {rider_id} - Assegna rider manualmente
/rider_status - Vedi rider online
/cancel_order {order_id} - Cancella ordine

**Dealer Commands:**
/start_order - Crea nuovo ordine

Inserisci /start_order per iniziare.
    `,
      { parse_mode: "Markdown" }
    );
  } else {
    await telegramBot.sendMessage(
      chatId,
      "❌ Comando non riconosciuto. Usa /start per help."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// /START_ORDER — Multi-step order creation
// ─────────────────────────────────────────────────────────────────────────

async function startOrderCommand(
  chatId: number,
  userId: number
): Promise<void> {
  // Create a new session
  const session: BotSessionState = {
    chat_id: chatId,
    step: CommandStep.START_ORDER_DEALER,
    order_draft: {
      items: [],
      status: OrderStatus.PENDING,
      payment_status: PaymentStatus.PENDING,
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CONSTANTS.SESSION_TIMEOUT_MS).toISOString(),
  };

  botSessions.set(chatId, session);

  await telegramBot.sendMessage(
    chatId,
    "📋 Creazione nuovo ordine\n\n🏪 Quale dealer? (es: Yamamay_Napoli_1)",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Annulla", callback_data: CONSTANTS.CALLBACK_CANCEL_SESSION }],
        ],
      },
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION INPUT HANDLER (Multi-step form responses)
// ─────────────────────────────────────────────────────────────────────────

async function handleSessionInput(
  chatId: number,
  userId: number,
  input: string
): Promise<void> {
  const session = botSessions.get(chatId);

  if (!session) {
    await telegramBot.sendMessage(
      chatId,
      "❌ Nessuna sessione attiva. Usa /start_order per iniziare."
    );
    return;
  }

  // Check session timeout
  if (new Date(session.expires_at) < new Date()) {
    botSessions.delete(chatId);
    await telegramBot.sendMessage(
      chatId,
      "⏰ Sessione scaduta (30 min). Usa /start_order per ricominciare."
    );
    return;
  }

  // Process based on current step
  switch (session.step) {
    case CommandStep.START_ORDER_DEALER:
      session.order_draft!.dealer_id = input.trim();
      session.step = CommandStep.START_ORDER_CUSTOMER_NAME;
      await telegramBot.sendMessage(
        chatId,
        "👤 Nome cliente? (es: Marco Rossi)"
      );
      break;

    case CommandStep.START_ORDER_CUSTOMER_NAME:
      session.order_draft!.customer_name = input.trim();
      session.step = CommandStep.START_ORDER_CUSTOMER_PHONE;
      await telegramBot.sendMessage(
        chatId,
        "📱 Numero telefono cliente? (es: +39 320 1234567)"
      );
      break;

    case CommandStep.START_ORDER_CUSTOMER_PHONE:
      session.order_draft!.customer_phone = input.trim();
      session.step = CommandStep.START_ORDER_CUSTOMER_ADDRESS;
      await telegramBot.sendMessage(
        chatId,
        "📍 Indirizzo consegna? (es: Via Roma 10, Napoli)"
      );
      break;

    case CommandStep.START_ORDER_CUSTOMER_ADDRESS:
      session.order_draft!.customer_address = input.trim();
      session.step = CommandStep.START_ORDER_ADD_ITEM_NAME;
      await telegramBot.sendMessage(
        chatId,
        "📦 Nome primo articolo? (o /confirm per saltare)"
      );
      break;

    case CommandStep.START_ORDER_ADD_ITEM_NAME:
      if (input === "/confirm") {
        session.step = CommandStep.START_ORDER_CONFIRM;
        await confirmOrderStep(chatId, session);
      } else {
        session.order_draft!.items = session.order_draft!.items || [];
        // Store item name temporarily
        (session as any).current_item_name = input.trim();
        session.step = CommandStep.START_ORDER_ADD_ITEM_PRICE;
        await telegramBot.sendMessage(chatId, "💰 Prezzo unitario? (EUR)");
      }
      break;

    case CommandStep.START_ORDER_ADD_ITEM_PRICE:
      const price = parseFloat(input);
      if (isNaN(price) || price <= 0) {
        await telegramBot.sendMessage(chatId, "❌ Prezzo non valido. Riprova.");
        return;
      }
      (session as any).current_item_price = price;
      session.step = CommandStep.START_ORDER_ADD_ITEM_QTY;
      await telegramBot.sendMessage(chatId, "📊 Quantità?");
      break;

    case CommandStep.START_ORDER_ADD_ITEM_QTY:
      const qty = parseInt(input);
      if (isNaN(qty) || qty <= 0) {
        await telegramBot.sendMessage(chatId, "❌ Quantità non valida. Riprova.");
        return;
      }
      // Add item to order
      const itemName = (session as any).current_item_name;
      const itemPrice = (session as any).current_item_price;
      session.order_draft!.items!.push({
        name: itemName,
        quantity: qty,
        unit_price: itemPrice,
        subtotal: qty * itemPrice,
      });

      // Calculate total
      const total = session.order_draft!.items!.reduce(
        (sum, item) => sum + item.subtotal,
        0
      );
      session.order_draft!.total_amount = total;

      session.step = CommandStep.START_ORDER_ADD_ITEM_NAME;
      await telegramBot.sendMessage(
        chatId,
        `✅ Articolo aggiunto!\n\n📦 Totale attuale: €${total.toFixed(2)}\n\nNome prossimo articolo? (o /confirm per terminare)`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Conferma ordine", callback_data: CONSTANTS.CALLBACK_CONFIRM_ITEMS },
              ],
            ],
          },
        }
      );
      break;

    default:
      await telegramBot.sendMessage(
        chatId,
        "❌ Stato sessione non riconosciuto."
      );
  }

  // Update session
  botSessions.set(chatId, session);
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIRM ORDER STEP
// ─────────────────────────────────────────────────────────────────────────

async function confirmOrderStep(
  chatId: number,
  session: BotSessionState
): Promise<void> {
  const order = session.order_draft;

  if (!order || !order.items || order.items.length === 0) {
    await telegramBot.sendMessage(chatId, "❌ Nessun articolo aggiunto.");
    return;
  }

  // Display order summary
  let summary = `📋 **Riepilogo Ordine**\n\n`;
  summary += `🏪 Dealer: ${order.dealer_id}\n`;
  summary += `👤 Cliente: ${order.customer_name}\n`;
  summary += `📱 Tel: ${order.customer_phone}\n`;
  summary += `📍 Indirizzo: ${order.customer_address}\n\n`;
  summary += `**Articoli:**\n`;

  order.items.forEach((item) => {
    summary += `• ${item.name} x${item.quantity} = €${item.subtotal.toFixed(2)}\n`;
  });

  const stripeFee = order.total_amount! * (CONFIG.pricing.stripeFeePercentage / 100);
  const totalWithFee = order.total_amount! + stripeFee;

  summary += `\n💰 Subtotale: €${order.total_amount?.toFixed(2)}\n`;
  summary += `📊 Fee Stripe (3.5%): €${stripeFee.toFixed(2)}\n`;
  summary += `💳 Totale: €${totalWithFee.toFixed(2)}\n`;

  summary += `\n✅ Confermi? (Inline button sotto)`;

  await telegramBot.sendMessage(chatId, summary, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Conferma", callback_data: CONSTANTS.CALLBACK_CONFIRM_ITEMS },
          { text: "❌ Annulla", callback_data: CONSTANTS.CALLBACK_CANCEL_SESSION },
        ],
      ],
    },
  });

  session.step = CommandStep.START_ORDER_CONFIRM;
  botSessions.set(chatId, session);
}

// ─────────────────────────────────────────────────────────────────────────
// CALLBACK QUERY HANDLER (Inline button clicks)
// ─────────────────────────────────────────────────────────────────────────

async function handleCallbackQuery(
  query: TelegramBot.CallbackQuery
): Promise<void> {
  const chatId = query.message!.chat.id;
  const userId = query.from.id;
  const data = query.data || "";

  try {
    if (data === CONSTANTS.CALLBACK_CONFIRM_ITEMS) {
      await confirmOrderCallback(chatId, userId);
    } else if (data === CONSTANTS.CALLBACK_CANCEL_SESSION) {
      botSessions.delete(chatId);
      await telegramBot.sendMessage(chatId, "❌ Operazione annullata.");
    } else if (data.startsWith(CONSTANTS.CALLBACK_ACCEPT_ORDER)) {
      const orderId = data.split("_")[2];
      await acceptOrderCallback(chatId, orderId);
    } else if (data.startsWith(CONSTANTS.CALLBACK_DECLINE_ORDER)) {
      const orderId = data.split("_")[2];
      await declineOrderCallback(chatId, orderId);
    }

    // Acknowledge callback
    await telegramBot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error(`❌ Error handling callback from user ${userId}:`, err);
    await telegramBot.answerCallbackQuery(query.id, {
      text: "❌ Errore interno",
      show_alert: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CALLBACK: CONFIRM ORDER (Save to Supabase, create Stripe payment link)
// ─────────────────────────────────────────────────────────────────────────

async function confirmOrderCallback(
  chatId: number,
  userId: number
): Promise<void> {
  const session = botSessions.get(chatId);

  if (!session || !session.order_draft) {
    await telegramBot.sendMessage(chatId, "❌ Nessun ordine da confermare.");
    return;
  }

  const order = session.order_draft as Order;
  order.id = crypto.randomUUID();
  order.created_at = new Date().toISOString();
  order.updated_at = new Date().toISOString();

  // Calculate fees
  const stripeFee = order.total_amount! * (CONFIG.pricing.stripeFeePercentage / 100);
  order.stripe_fee_amount = stripeFee;
  order.total_with_fee = order.total_amount! + stripeFee;

  try {
    // 1. Save order to Supabase
    const { data: savedOrder, error: dbError } = await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .insert([order]);

    if (dbError) {
      throw new Error(`Supabase error: ${dbError.message}`);
    }

    console.log(`✅ Order ${order.id} saved to Supabase`);

    // 2. Create Stripe payment link (Price first: paymentLinks API requires a Price ID)
    const price = await stripeClient.prices.create({
      currency: "eur",
      unit_amount: Math.round(order.total_with_fee * 100), // in cents
      product_data: {
        name: `Ordine ${order.id.slice(0, 8)} - ${order.customer_name}`,
        metadata: {
          items: (order.items
            ?.map((i) => `${i.name} x${i.quantity}`)
            .join(", ") ?? "").slice(0, 480),
        },
      },
    });

    const paymentLink = await stripeClient.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      metadata: {
        order_id: order.id,
      },
    });

    order.stripe_payment_link = paymentLink.url;

    // 3. Update order with payment link
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ stripe_payment_link: paymentLink.url })
      .eq("id", order.id);

    // 4. Send payment link to customer via Telegram (to be sent to WA)
    const paymentMessage = `
💳 **Link Pagamento**

Cliente: ${order.customer_name}
Ordine: #${order.id.slice(0, 8).toUpperCase()}
Totale: €${order.total_with_fee.toFixed(2)}

🔗 Clicca qui per pagare:
${paymentLink.url}

(Valido per 24 ore)
    `;

    await telegramBot.sendMessage(
      chatId,
      `✅ Ordine creato!\n\n${paymentMessage}`,
      { parse_mode: "Markdown" }
    );

    // 5. Notify dealer via Telegram with accept button
    const dealer = await getDealer(order.dealer_id);
    if (dealer?.telegram_user_id) {
      await notifyDealerNewOrder(order, dealer.telegram_user_id);
    }

    // Clear session
    botSessions.delete(chatId);
  } catch (err) {
    console.error("❌ Error confirming order:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore salvataggio ordine: ${(err as any).message}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFY DEALER OF NEW ORDER (Inline accept button)
// ─────────────────────────────────────────────────────────────────────────

async function notifyDealerNewOrder(
  order: Order,
  dealerTelegramUserId: string
): Promise<void> {
  const message = `
🎉 **NUOVO ORDINE**

📦 Ordine: #${order.id.slice(0, 8).toUpperCase()}
👤 Cliente: ${order.customer_name}
📱 Tel: ${order.customer_phone}
📍 Indirizzo: ${order.customer_address}

**Articoli:**
${order.items?.map((i) => `• ${i.name} x${i.quantity} = €${i.subtotal.toFixed(2)}`).join("\n")}

💰 Totale: €${order.total_with_fee?.toFixed(2)}

🔗 Pagamento: [Link Inviato al Cliente]

Accetti questo ordine?
  `;

  await telegramBot.sendMessage(dealerTelegramUserId, message, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Accetto",
            callback_data: `${CONSTANTS.CALLBACK_ACCEPT_ORDER}_${order.id}`,
          },
          {
            text: "❌ Rifiuto",
            callback_data: `${CONSTANTS.CALLBACK_DECLINE_ORDER}_${order.id}`,
          },
        ],
      ],
    },
  });

  console.log(`📤 Dealer notification sent for order ${order.id}`);
}

// ─────────────────────────────────────────────────────────────────────────
// CALLBACK: DEALER ACCEPTS ORDER
// ─────────────────────────────────────────────────────────────────────────

async function acceptOrderCallback(
  dealerChatId: number,
  orderId: string
): Promise<void> {
  try {
    // 1. Update order status
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ status: OrderStatus.ACCEPTED })
      .eq("id", orderId);

    // 2. Notify SHOSHY
    const message = `✅ Ordine #${orderId.slice(0, 8).toUpperCase()} accettato dal dealer!\n\nProssimo: assegna rider manualmente con /assign_rider`;
    await telegramBot.sendMessage(CONFIG.telegram.shoshy_user_id, message);

    // 3. Confirm to dealer
    await telegramBot.sendMessage(
      dealerChatId,
      "✅ Ordine accettato! Aspetta la conferma del pagamento e l'assegnazione del rider."
    );

    console.log(`✅ Order ${orderId} accepted by dealer`);
  } catch (err) {
    console.error("❌ Error accepting order:", err);
    await telegramBot.sendMessage(
      dealerChatId,
      "❌ Errore durante l'accettazione dell'ordine."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CALLBACK: DEALER DECLINES ORDER
// ─────────────────────────────────────────────────────────────────────────

async function declineOrderCallback(
  dealerChatId: number,
  orderId: string
): Promise<void> {
  try {
    // 1. Update order status
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ status: OrderStatus.CANCELLED })
      .eq("id", orderId);

    // 2. Notify SHOSHY
    const message = `❌ Ordine #${orderId.slice(0, 8).toUpperCase()} rifiutato dal dealer.`;
    await telegramBot.sendMessage(CONFIG.telegram.shoshy_user_id, message);

    // 3. Confirm to dealer
    await telegramBot.sendMessage(dealerChatId, "❌ Ordine rifiutato.");

    console.log(`❌ Order ${orderId} declined by dealer`);
  } catch (err) {
    console.error("❌ Error declining order:", err);
    await telegramBot.sendMessage(
      dealerChatId,
      "❌ Errore durante il rifiuto dell'ordine."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SHOSHY COMMANDS
// ─────────────────────────────────────────────────────────────────────────

async function assignRiderCommand(
  chatId: number,
  command: string
): Promise<void> {
  const parts = command.split(" ");
  if (parts.length < 3) {
    await telegramBot.sendMessage(
      chatId,
      "❌ Formato: /assign_rider {order_id} {rider_id}"
    );
    return;
  }

  const orderId = parts[1];
  const riderId = parts[2];

  try {
    // Update order
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({
        status: OrderStatus.ASSIGNED,
        assigned_rider_id: riderId,
      })
      .eq("id", orderId);

    // Get rider and send FCM push
    const rider = await getRider(riderId);
    if (rider?.firebase_fcm_token) {
      await sendFCMPush(rider.firebase_fcm_token, {
        title: "🎉 Nuovo Ordine",
        body: `Ordine #${orderId.slice(0, 8).toUpperCase()} assegnato`,
        order_id: orderId,
        order_status: OrderStatus.ASSIGNED,
      });
    }

    await telegramBot.sendMessage(
      chatId,
      `✅ Ordine ${orderId.slice(0, 8)} assegnato a ${riderId}`
    );

    console.log(`✅ Order ${orderId} assigned to rider ${riderId}`);
  } catch (err) {
    console.error("❌ Error assigning rider:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore: ${(err as any).message}`
    );
  }
}

async function listOrdersCommand(
  chatId: number,
  command: string
): Promise<void> {
  try {
    const status = command.split(" ")[1] || OrderStatus.PENDING;

    const { data: orders, error } = await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .select()
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!orders || orders.length === 0) {
      await telegramBot.sendMessage(
        chatId,
        `❌ Nessun ordine con status: ${status}`
      );
      return;
    }

    let message = `📋 Ordini (${status}):\n\n`;
    orders.forEach((order: Order) => {
      message += `• #${order.id.slice(0, 8)} - ${order.customer_name} - €${order.total_with_fee} - ${order.dealer_id}\n`;
    });

    await telegramBot.sendMessage(chatId, message);
  } catch (err) {
    console.error("❌ Error listing orders:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore: ${(err as any).message}`
    );
  }
}

async function riderStatusCommand(chatId: number): Promise<void> {
  try {
    const { data: riders, error } = await supabaseClient
      .from(CONSTANTS.TABLE_RIDERS)
      .select()
      .eq("status", RiderStatus.ONLINE)
      .limit(20);

    if (error) throw error;

    if (!riders || riders.length === 0) {
      await telegramBot.sendMessage(chatId, "❌ Nessun rider online");
      return;
    }

    let message = `🏍️ Rider Online (${riders.length}):\n\n`;
    riders.forEach((rider: Rider) => {
      message += `• ${rider.name} - ${rider.vehicle_type} - €${rider.earnings_week} (${rider.orders_completed_week} ordini)\n`;
    });

    await telegramBot.sendMessage(chatId, message);
  } catch (err) {
    console.error("❌ Error fetching rider status:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore: ${(err as any).message}`
    );
  }
}

async function manualDispatchCommand(
  chatId: number,
  command: string
): Promise<void> {
  const orderId = command.split(" ")[1];
  if (!orderId) {
    await telegramBot.sendMessage(
      chatId,
      "❌ Formato: /manual_dispatch {order_id}"
    );
    return;
  }

  try {
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ status: OrderStatus.PENDING })
      .eq("id", orderId);

    await telegramBot.sendMessage(
      chatId,
      `✅ Ordine ${orderId.slice(0, 8)} riportato a PENDING per reassegnazione`
    );
  } catch (err) {
    console.error("❌ Error in manual dispatch:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore: ${(err as any).message}`
    );
  }
}

async function cancelOrderCommand(
  chatId: number,
  command: string
): Promise<void> {
  const orderId = command.split(" ")[1];
  if (!orderId) {
    await telegramBot.sendMessage(
      chatId,
      "❌ Formato: /cancel_order {order_id}"
    );
    return;
  }

  try {
    await supabaseClient
      .from(CONSTANTS.TABLE_ORDERS)
      .update({ status: OrderStatus.CANCELLED })
      .eq("id", orderId);

    await telegramBot.sendMessage(
      chatId,
      `✅ Ordine ${orderId.slice(0, 8)} cancellato`
    );
  } catch (err) {
    console.error("❌ Error cancelling order:", err);
    await telegramBot.sendMessage(
      chatId,
      `❌ Errore: ${(err as any).message}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────

async function getDealer(dealerId: string): Promise<Dealer | null> {
  const { data, error } = await supabaseClient
    .from(CONSTANTS.TABLE_DEALERS)
    .select()
    .eq("id", dealerId)
    .single();

  return error ? null : data;
}

async function getRider(riderId: string): Promise<Rider | null> {
  const { data, error } = await supabaseClient
    .from(CONSTANTS.TABLE_RIDERS)
    .select()
    .eq("id", riderId)
    .single();

  return error ? null : data;
}

async function sendFCMPush(
  fcmToken: string,
  payload: {
    title: string;
    body: string;
    order_id: string;
    order_status: OrderStatus;
  }
): Promise<void> {
  try {
    if (!firebaseApp) {
      console.warn("⚠️ Firebase not initialized, skipping FCM push");
      return;
    }

    const messaging = admin.messaging(firebaseApp);
    await messaging.send({
      token: fcmToken,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        order_id: payload.order_id,
        order_status: payload.order_status,
      },
    });

    console.log(`✅ FCM push sent to token ${fcmToken.slice(0, 20)}...`);
  } catch (err) {
    console.error("❌ Error sending FCM push:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT FOR SERVER
// ─────────────────────────────────────────────────────────────────────────

export { telegramBot };
