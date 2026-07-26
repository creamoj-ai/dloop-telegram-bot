-- ============================================================================
-- DLOOP SAAS — GEOAPIFY DROPOFF COORDINATES
-- ============================================================================
-- Aggiunge SOLO coordinate dropoff + delivery_notes
-- dropoff_address e dropoff_point esistono già nello schema
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- Aggiungi SOLO coordinate e note consegna
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- Indici per query geografiche
CREATE INDEX IF NOT EXISTS idx_orders_dropoff_coords ON orders(dropoff_lat, dropoff_lng)
  WHERE dropoff_lat IS NOT NULL AND dropoff_lng IS NOT NULL;

COMMENT ON COLUMN orders.dropoff_lat IS 'Latitudine punto consegna (da Geoapify properties.lat)';
COMMENT ON COLUMN orders.dropoff_lng IS 'Longitudine punto consegna (da Geoapify properties.lon)';
COMMENT ON COLUMN orders.delivery_notes IS 'Dettagli consegna: scala, interno, citofono, note specifiche';

-- ============================================================================
-- VERIFICA
-- ============================================================================
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('dropoff_address', 'dropoff_lat', 'dropoff_lng', 'delivery_notes', 'dropoff_point')
ORDER BY column_name;
