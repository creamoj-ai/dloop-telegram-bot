-- ============================================================================
-- DLOOP SAAS — RIDER EARLY RESERVATION FLOW
-- ============================================================================
-- Aggiunge colonne per tracking prenotazione anticipata rider con T-1h confirm
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- Aggiungi colonne per rider early reservation flow
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rider_reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rider_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rider_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_prompt_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thirty_min_reminder_sent_at TIMESTAMPTZ;

-- Indici per query efficienti sul flow
CREATE INDEX IF NOT EXISTS idx_orders_rider_reserved ON orders(status, rider_reserved_at)
  WHERE status = 'accepted' AND rider_reserved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_rider_confirmed ON orders(status, rider_confirmed_at)
  WHERE status = 'accepted' AND rider_confirmed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_confirmation_prompt ON orders(status, confirmation_prompt_sent_at)
  WHERE status = 'accepted' AND confirmation_prompt_sent_at IS NOT NULL;

-- Commenti per documentazione
COMMENT ON COLUMN orders.rider_reserved_at IS 'Timestamp quando rider accetta ordine (status = accepted)';
COMMENT ON COLUMN orders.rider_confirmed_at IS 'Timestamp quando rider conferma la prenotazione (T-1h reminder response)';
COMMENT ON COLUMN orders.rider_reminder_sent_at IS 'Timestamp invio reminder T-1h al rider';
COMMENT ON COLUMN orders.confirmation_prompt_sent_at IS 'Timestamp invio prompt di conferma al rider (T-1h)';
COMMENT ON COLUMN orders.thirty_min_reminder_sent_at IS 'Timestamp invio reminder T-30min a rider e merchant';

-- ============================================================================
-- VERIFICA
-- ============================================================================

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN (
    'rider_reserved_at',
    'rider_confirmed_at',
    'rider_reminder_sent_at',
    'confirmation_prompt_sent_at',
    'thirty_min_reminder_sent_at'
  )
ORDER BY column_name;

-- ============================================================================
-- SUCCESS: Colonne rider early reservation aggiunte
-- ============================================================================
