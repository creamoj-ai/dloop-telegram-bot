-- ============================================================================
-- DLOOP SAAS — MERCHANT MODES & WHATSAPP SETUP
-- ============================================================================
-- Aggiunge campi per SaaS puro: mode (dispatch/commerce), payment_mode,
-- WhatsApp intake, e campi consegna su orders.
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- DEALERS → MERCHANTS
-- ────────────────────────────────────────────────────────────────────────────

-- Aggiungi campi mode merchant e WhatsApp setup
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'dispatch' CHECK (mode IN ('dispatch', 'commerce')),
  ADD COLUMN IF NOT EXISTS wa_setup_status TEXT DEFAULT 'pending' CHECK (wa_setup_status IN ('pending', 'configured', 'active')),
  ADD COLUMN IF NOT EXISTS wa_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS wa_intake_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dealers_mode ON dealers(mode);
CREATE INDEX IF NOT EXISTS idx_dealers_wa_status ON dealers(wa_setup_status);

COMMENT ON COLUMN dealers.mode IS 'Tipo merchant: dispatch (ship-from-store Yamamay) | commerce (piccolo merchant WA)';
COMMENT ON COLUMN dealers.wa_setup_status IS 'Stato configurazione WhatsApp intake: pending | configured | active';
COMMENT ON COLUMN dealers.wa_phone_number IS 'Numero WhatsApp Business del merchant per ordini';
COMMENT ON COLUMN dealers.wa_intake_chat_id IS 'Chat ID Telegram per notifiche intake WA';

-- ────────────────────────────────────────────────────────────────────────────
-- ORDERS → DELIVERY ORDERS (SaaS puro)
-- ────────────────────────────────────────────────────────────────────────────

-- Aggiungi campi consegna (SaaS puro — NO articoli/prezzi)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_point TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS time_window TEXT,
  ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'merchant_external' CHECK (payment_mode IN ('merchant_external', 'cod', 'prepaid')),
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'telegram_manual' CHECK (source IN ('telegram_manual', 'wa_intake', 'api')),
  ADD COLUMN IF NOT EXISTS mode TEXT;

-- Rendi nullable le colonne marketplace (dati storici)
-- Se non esistono gia' come nullable, non errore
ALTER TABLE orders
  ALTER COLUMN items DROP NOT NULL,
  ALTER COLUMN total_amount DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_mode ON orders(mode);
CREATE INDEX IF NOT EXISTS idx_orders_payment_mode ON orders(payment_mode);

COMMENT ON COLUMN orders.pickup_point IS 'Punto ritiro (indirizzo store per dispatch, merchant per commerce)';
COMMENT ON COLUMN orders.delivery_address IS 'Indirizzo consegna finale';
COMMENT ON COLUMN orders.recipient_name IS 'Nome destinatario';
COMMENT ON COLUMN orders.recipient_phone IS 'Telefono destinatario';
COMMENT ON COLUMN orders.time_window IS 'Finestra temporale consegna richiesta (opzionale)';
COMMENT ON COLUMN orders.payment_mode IS 'Modalita pagamento prodotto: merchant_external (Dloop NON gestisce) | cod | prepaid';
COMMENT ON COLUMN orders.source IS 'Fonte ordine: telegram_manual | wa_intake | api';
COMMENT ON COLUMN orders.mode IS 'Mode merchant al momento creazione ordine';

-- ============================================================================
-- VERIFICA
-- ============================================================================
SELECT
  COUNT(*) as dealer_count,
  COUNT(CASE WHEN mode = 'dispatch' THEN 1 END) as dispatch_count,
  COUNT(CASE WHEN mode = 'commerce' THEN 1 END) as commerce_count
FROM dealers;
