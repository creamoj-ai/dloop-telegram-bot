// ============================================================================
// DLOOP SAAS — TYPE DEFINITIONS
// ============================================================================
// Tipi SaaS puro: ordine = consegna, NO articoli/prezzi prodotto.
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────
// MERCHANT MODES & PAYMENT MODES
// ─────────────────────────────────────────────────────────────────────────

export type MerchantMode = "dispatch" | "commerce";
export type PaymentMode = "prepaid" | "delivery_on_completion" | "cod";
export type OrderSource = "telegram_manual" | "wa_intake" | "api";

// ─────────────────────────────────────────────────────────────────────────
// ORDER (DELIVERY ORDER — SaaS puro)
// ─────────────────────────────────────────────────────────────────────────

export interface Order {
  id: string; // UUID
  merchant_id: string; // FK dealers
  pickup_point: string; // Store address (dispatch) o merchant address (commerce)
  delivery_address: string; // Indirizzo consegna finale
  recipient_name: string;
  recipient_phone: string;
  time_window?: string | null; // "14:00-16:00" opzionale
  notes?: string | null;
  payment_mode: PaymentMode; // Registrato, NON processato da Dloop
  source: OrderSource;
  mode: MerchantMode; // Ereditato dal merchant al momento creazione
  status: OrderStatus;
  assigned_rider_id?: string | null;
  delivery_fee_shown?: number | null; // Prezzo consegna MOSTRATO (mediana zona), NON addebitato
  delivery_paid_at?: string | null; // ISO 8601 - timestamp conferma incasso rider
  delivery_payment_confirmed?: boolean; // Rider conferma incasso
  broadcast_tier?: number; // 0=top, 1=media, 2=tutti, 3=esteso
  broadcast_started_at?: string | null; // ISO 8601 - inizio broadcast
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export enum OrderStatus {
  PENDING = "pending", // Creato, in attesa rider
  ASSIGNED = "assigned", // Rider assegnato
  PICKED_UP = "picked_up", // Rider ha ritirato
  IN_DELIVERY = "in_delivery", // Rider in consegna
  COMPLETED = "completed", // Consegnato
  CANCELLED = "cancelled", // Cancellato pre-pickup
  FAILED = "failed", // Fallito (rider rifiutato, timeout)
}

// ─────────────────────────────────────────────────────────────────────────
// MERCHANT
// ─────────────────────────────────────────────────────────────────────────

export interface Merchant {
  id: string; // UUID
  name: string; // "Yamamay Napoli 1"
  phone: string;
  telegram_user_id?: string | null; // Per notifiche Telegram
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  status: "active" | "inactive" | "suspended";
  mode: MerchantMode; // dispatch | commerce
  wa_setup_status: "pending" | "configured" | "active";
  wa_phone_number?: string | null;
  wa_intake_chat_id?: string | null; // Chat ID Telegram per intake WA
  created_at: string;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// RIDER
// ─────────────────────────────────────────────────────────────────────────

export interface Rider {
  id: string; // UUID
  name: string;
  phone: string;
  telegram_user_id?: string | null; // Per notifiche Telegram
  vehicle_type: "motorcycle" | "bike" | "car" | "van";
  current_location?: {
    latitude: number;
    longitude: number;
    updated_at: string;
  };
  status: RiderStatus;
  vat_id: string; // Partita IVA
  created_at: string;
  earnings_week: number; // EUR
  orders_completed_week: number;
  rating?: number | null; // 1-5 stelle
  location?: { lat: number; lon: number } | null; // PostGIS geography → {lat,lon}
  acceptance_rate?: number; // 0.0-1.0
  completion_rate?: number; // 0.0-1.0
  on_time_rate?: number; // 0.0-1.0
  total_deliveries?: number;
  reputation_score?: number; // 0-100 composito
}

export enum RiderStatus {
  OFFLINE = "offline",
  ONLINE = "online",
  ON_DELIVERY = "on_delivery",
}

// ─────────────────────────────────────────────────────────────────────────
// TELEGRAM SESSION (multi-step)
// ─────────────────────────────────────────────────────────────────────────

export interface TelegramSessionRow {
  chat_id: number;
  user_id: number;
  step: CommandStep;
  order_draft: Partial<Order>;
  temp_data: Record<string, unknown>; // Dati temporanei per flusso
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export enum CommandStep {
  IDLE = "idle",
  // Flusso /nuovo_ordine (6 step)
  PICKUP_POINT = "pickup_point",
  DELIVERY_ADDRESS = "delivery_address",
  RECIPIENT_NAME = "recipient_name",
  RECIPIENT_PHONE = "recipient_phone",
  TIME_WINDOW = "time_window", // Opzionale — /skip
  NOTE = "note", // Opzionale — /skip
  PAYMENT_MODE = "payment_mode", // Bottoni inline
  CONFIRM = "confirm",
}

// ─────────────────────────────────────────────────────────────────────────
// TOKEN LEDGER
// ─────────────────────────────────────────────────────────────────────────

export interface TokenLedgerEntry {
  id: string; // UUID
  merchant_id: string;
  amount: number; // +50, -1, +1
  reason: "onboarding" | "order_created" | "order_refund" | "manual_adjustment";
  order_id?: string | null;
  created_at: string;
}

export interface TokenBalance {
  merchant_id: string;
  balance: number;
  orders_count: number;
  last_movement_at: string;
}

// ─────────────────────────────────────────────────────────────────────────
// TELEGRAM CONTEXT
// ─────────────────────────────────────────────────────────────────────────

export interface TelegramContext {
  chat_id: number;
  user_id: number;
  username?: string;
  first_name?: string;
  is_admin?: boolean; // True se SHOSHY
}

// ─────────────────────────────────────────────────────────────────────────
// REPUTATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────

export interface Rating {
  id: string; // UUID
  order_id: string;
  rater_role: "merchant" | "customer" | "rider";
  ratee_role: "merchant" | "rider";
  ratee_id: string; // FK rider.id o merchant.id
  score: number; // 1-5
  note?: string | null;
  created_at: string;
}

export interface RiderReputation {
  rider_id: string;
  name: string;
  avg_rating: number; // Media voti ricevuti
  acceptance_rate: number; // 0.0-1.0
  completion_rate: number; // 0.0-1.0
  on_time_rate: number; // 0.0-1.0
  total_deliveries: number;
  reputation_score: number; // 0-100 composito
}

export interface RiderListino {
  id: string; // UUID
  rider_id: string;
  zona: string; // Es. "napoli_centro", "roma_eur"
  prezzo: number; // EUR
  updated_at: string;
}
