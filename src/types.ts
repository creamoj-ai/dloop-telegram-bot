// ============================================================================
// DLOOP TELEGRAM BOT - TYPE DEFINITIONS
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────
// CORE DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────

export interface Order {
  id: string; // UUID
  dealer_id: string; // Merchant/Dealer ID
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  items: OrderItem[];
  total_amount: number; // EUR, without Stripe fee
  stripe_fee_amount: number; // 3.5% of total_amount
  total_with_fee: number; // total_amount + stripe_fee_amount
  status: OrderStatus;
  assigned_rider_id?: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  notes?: string;
  payment_status: PaymentStatus; // "pending" | "completed" | "failed"
  payment_intent_id?: string; // Stripe payment intent ID
  stripe_payment_link?: string;
  delivery_location?: {
    latitude: number;
    longitude: number;
  };
}

export interface OrderItem {
  name: string;
  quantity: number;
  unit_price: number; // EUR
  subtotal: number; // quantity * unit_price
}

export enum OrderStatus {
  PENDING = "pending", // Created, awaiting dealer acceptance
  ACCEPTED = "accepted", // Dealer accepted via Telegram button
  ASSIGNED = "assigned", // Rider assigned (auto or manual)
  PICKED_UP = "picked_up", // Rider picked up order
  IN_DELIVERY = "in_delivery", // Rider delivering
  COMPLETED = "completed", // Delivered
  CANCELLED = "cancelled", // Cancelled by dealer or SHOSHY
  FAILED = "failed", // Payment failed or other critical issue
}

export enum PaymentStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

// ─────────────────────────────────────────────────────────────────────────
// DEALER / MERCHANT
// ─────────────────────────────────────────────────────────────────────────

export interface Dealer {
  id: string; // UUID
  name: string; // e.g., "Yamamay Napoli 1"
  phone: string; // Business phone
  whatsapp_number?: string; // Optional separate WA number
  telegram_user_id?: string; // For Telegram notifications
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  status: "active" | "inactive" | "suspended";
  created_at: string; // ISO 8601
  stripe_account_id?: string; // If using Stripe Connect (future)
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// RIDER / COURIER
// ─────────────────────────────────────────────────────────────────────────

export interface Rider {
  id: string; // UUID
  name: string;
  phone: string;
  vehicle_type: "motorcycle" | "bike" | "car" | "van";
  current_location?: {
    latitude: number;
    longitude: number;
    updated_at: string; // ISO 8601
  };
  status: RiderStatus;
  firebase_fcm_token?: string; // For push notifications
  vat_id: string; // Italian VAT number (partita IVA)
  created_at: string; // ISO 8601
  earnings_week: number; // EUR accumulated this week
  orders_completed_week: number; // Orders this week
  rating?: number; // 1-5 stars average
}

export enum RiderStatus {
  OFFLINE = "offline",
  ONLINE = "online",
  ON_DELIVERY = "on_delivery",
  IDLE = "idle", // Online but no active order
}

// ─────────────────────────────────────────────────────────────────────────
// TELEGRAM BOT CONTEXT
// ─────────────────────────────────────────────────────────────────────────

export interface TelegramContext {
  chat_id: number; // Telegram chat ID
  user_id: number; // Telegram user ID
  username?: string; // @username
  first_name?: string;
  is_admin?: boolean; // True if user is SHOSHY (hardcoded check)
}

// ─────────────────────────────────────────────────────────────────────────
// BOT STATE (In-memory session for multi-step commands)
// ─────────────────────────────────────────────────────────────────────────

export interface BotSessionState {
  chat_id: number;
  step: CommandStep;
  order_draft?: Partial<Order>;
  dealer_draft?: Partial<Dealer>;
  rider_draft?: Partial<Rider>;
  created_at: string;
  expires_at: string; // 30 min timeout
}

export enum CommandStep {
  IDLE = "idle",
  // /start_order flow
  START_ORDER_DEALER = "start_order_dealer",
  START_ORDER_CUSTOMER_NAME = "start_order_customer_name",
  START_ORDER_CUSTOMER_PHONE = "start_order_customer_phone",
  START_ORDER_CUSTOMER_ADDRESS = "start_order_customer_address",
  START_ORDER_ADD_ITEM_NAME = "start_order_add_item_name",
  START_ORDER_ADD_ITEM_PRICE = "start_order_add_item_price",
  START_ORDER_ADD_ITEM_QTY = "start_order_add_item_qty",
  START_ORDER_CONFIRM = "start_order_confirm",
}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATION EVENTS
// ─────────────────────────────────────────────────────────────────────────

export interface OrderNotification {
  order_id: string;
  dealer_id: string;
  dealer_telegram_user_id: string;
  event_type: "new_order" | "rider_assigned" | "rider_picked_up" | "completed";
  message: string;
  inline_keyboard?: InlineKeyboard[];
}

export interface InlineKeyboard {
  text: string;
  callback_data: string; // e.g., "accept_order_{order_id}"
}

// ─────────────────────────────────────────────────────────────────────────
// SHOSHY COMMAND PAYLOADS
// ─────────────────────────────────────────────────────────────────────────

export interface AssignRiderPayload {
  order_id: string;
  rider_id: string;
  auto_assigned: boolean; // True if PostGIS auto-match, false if manual SHOSHY
}

export interface ListOrdersPayload {
  status?: OrderStatus;
  dealer_id?: string;
  limit?: number;
}

export interface ManualDispatchPayload {
  order_id: string;
  reason: string; // e.g., "auto_assign_failed", "override_requested"
}

// ─────────────────────────────────────────────────────────────────────────
// API RESPONSE WRAPPERS
// ─────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface BotMessage {
  chat_id: number;
  text: string;
  parse_mode?: "HTML" | "Markdown";
  reply_markup?: {
    inline_keyboard: InlineKeyboard[][];
  };
}

// ─────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK
// ─────────────────────────────────────────────────────────────────────────

export interface StripeWebhookPayload {
  id: string; // Event ID
  type: string; // e.g., "charge.succeeded", "charge.failed"
  data: {
    object: {
      id: string; // Payment intent or charge ID
      status: string; // succeeded | failed | processing
      metadata?: {
        order_id: string;
      };
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FIREBASE FCM PUSH
// ─────────────────────────────────────────────────────────────────────────

export interface FCMPushPayload {
  rider_id: string;
  fcm_token: string;
  title: string;
  body: string;
  data: {
    order_id: string;
    order_status: OrderStatus;
    action_url?: string; // Deep link to rider app
  };
}
