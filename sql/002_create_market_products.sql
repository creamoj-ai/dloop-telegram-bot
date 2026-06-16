-- ============================================================================
-- DLOOP TELEGRAM BOT - MARKET PRODUCTS TABLE
-- ============================================================================
-- Product catalog for each dealer. Used by the AI order parser to:
--   1. Match fuzzy product names to canonical catalog entries
--   2. Auto-fill prices (unit_price) on parsed order items
--   3. Validate that ordered products actually exist for the dealer
--
-- Run this in Supabase SQL Editor:
--   Project: aqpwfurradxbnqvycvkm
--   Dashboard: https://supabase.com/dashboard/project/aqpwfurradxbnqvycvkm/sql
-- ============================================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS market_products (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  rider_id      UUID        NULL,                       -- LEGACY: original owner field (maps to dealer/seller, NOT a courier)
  dealer_id     TEXT        NULL,                       -- CANONICAL dealer identifier (matches orders.dealer_id)
  name          TEXT        NOT NULL,                   -- product display name
  description   TEXT        NULL,                       -- optional long description
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,       -- selling price EUR
  cost_price    NUMERIC(10,2) NULL,                     -- cost price (internal, not shown to customers)
  category      TEXT        NULL,                       -- e.g., 'pizza', 'bevande', 'dolci', 'abbigliamento'
  image_url     TEXT        NULL,                       -- product image URL
  stock         INTEGER     DEFAULT 0,                  -- available stock (0 = out of stock)
  is_active     BOOLEAN     DEFAULT TRUE,               -- soft delete / seasonal toggle
  sold_count    INTEGER     DEFAULT 0,                  -- lifetime units sold
  views_count   INTEGER     DEFAULT 0,                  -- times viewed in catalog
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes for AI context loading
--    Primary query: SELECT name, price, category FROM market_products
--                   WHERE dealer_id = $1 AND is_active = true AND stock > 0
CREATE INDEX idx_market_products_dealer_active
  ON market_products (dealer_id, is_active, stock)
  WHERE is_active = true AND stock > 0;

--    Legacy rider_id lookup (for backward compatibility)
CREATE INDEX idx_market_products_rider_id
  ON market_products (rider_id)
  WHERE rider_id IS NOT NULL;

--    Category filtering
CREATE INDEX idx_market_products_category
  ON market_products (dealer_id, category)
  WHERE is_active = true;

-- 3. Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_market_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_market_products_updated_at
  BEFORE UPDATE ON market_products
  FOR EACH ROW
  EXECUTE FUNCTION update_market_products_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE market_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow bot full access to market_products"
  ON market_products
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Comments
COMMENT ON TABLE market_products IS
  'Product catalog for each dealer. Active products with stock > 0 are injected '
  'into the AI order parser prompt so Haiku can match product names and auto-fill prices.';

COMMENT ON COLUMN market_products.rider_id IS
  'LEGACY field from early schema where "rider" was used as a generic owner. '
  'In practice this refers to the dealer/seller. Use dealer_id for new code.';

COMMENT ON COLUMN market_products.dealer_id IS
  'Canonical dealer identifier. Should match orders.dealer_id and dealers.id. '
  'Added to replace the ambiguous rider_id field.';

-- 6. Migration helper: backfill dealer_id from rider_id if rider_id was used as dealer
-- Uncomment and run if rider_id was previously used as dealer identifier:
-- UPDATE market_products SET dealer_id = rider_id::text WHERE dealer_id IS NULL AND rider_id IS NOT NULL;

-- ============================================================================
-- VERIFICATION: Run after applying
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'market_products'
-- ORDER BY ordinal_position;
