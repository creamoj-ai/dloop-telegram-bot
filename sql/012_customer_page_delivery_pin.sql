-- ============================================================================
-- DLOOP SAAS — CUSTOMER PAGE DELIVERY PIN
-- ============================================================================
-- Aggiunge colonna delivery_pin per conferma consegna cliente
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- Aggiungi colonna delivery_pin (4 cifre, generato da customer-page)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_pin TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_pin ON orders(delivery_pin) WHERE delivery_pin IS NOT NULL;

COMMENT ON COLUMN orders.delivery_pin IS 'PIN 4 cifre per conferma consegna (generato da customer-page, mostrato a cliente)';

-- ============================================================================
-- VERIFICA
-- ============================================================================
SELECT
  COUNT(*) as total_orders,
  COUNT(delivery_pin) as orders_with_pin
FROM orders;
