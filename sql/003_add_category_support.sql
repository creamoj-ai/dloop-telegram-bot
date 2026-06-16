-- ============================================================================
-- DLOOP TELEGRAM BOT - MULTI-CATEGORY SUPPORT MIGRATION
-- ============================================================================
-- Adds category awareness to the existing schema:
--   1. dealers.category        -- which vertical the dealer belongs to
--   2. market_products.category_attributes -- JSONB for category-specific attrs
--   3. training_examples.category          -- filter examples by vertical
--   4. dealer_categories       -- reference table of available categories
--
-- Run this in Supabase SQL Editor:
--   Project: aqpwfurradxbnqvycvkm
--   Dashboard: https://supabase.com/dashboard/project/aqpwfurradxbnqvycvkm/sql
--
-- PRE-REQUISITES:
--   - 001_create_training_examples.sql has been applied
--   - 002_create_market_products.sql has been applied
--   - dealers table exists (from main schema)
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DEALER CATEGORIES REFERENCE TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dealer_categories (
  id            TEXT        PRIMARY KEY,              -- e.g., 'food', 'abbigliamento'
  label_it      TEXT        NOT NULL,                 -- Italian display name
  description   TEXT        NULL,                     -- Short description
  icon          TEXT        NULL,                     -- Emoji icon for Telegram
  is_active     BOOLEAN     DEFAULT TRUE,             -- Enable/disable a category
  sort_order    INTEGER     DEFAULT 0,                -- Display ordering
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Seed the 6 MVP categories
INSERT INTO dealer_categories (id, label_it, description, icon, sort_order) VALUES
  ('food',           'Cibo & Ristorazione',      'Ordini da ristoranti, pizzerie, fast food',                       E'\U0001F355', 1),
  ('abbigliamento',  'Abbigliamento & Intimo',    'Vestiti, intimo, accessori (Yamamay, etc.)',                      E'\U0001F457', 2),
  ('grocery',        'Supermercato & Grocery',     'Spesa al supermercato, prodotti alimentari confezionati',         E'\U0001F6D2', 3),
  ('pet',            'Articoli per Animali',       'Cibo e accessori per animali domestici',                          E'\U0001F43E', 4),
  ('farmacie',       'Farmacia & Salute',          'Farmaci, integratori, prodotti salute e benessere',               E'\U0001F48A', 5),
  ('casa',           'Casa & Arredamento',         'Articoli per la casa, tessili, arredamento, utilita domestiche',  E'\U0001F3E0', 6)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE dealer_categories IS
  'Reference table of available business categories/verticals. '
  'Each dealer is assigned to one category which determines the AI parsing behavior.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ADD CATEGORY TO DEALERS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

-- Add category column to dealers (nullable for backwards compatibility)
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'food'
  REFERENCES dealer_categories(id);

-- Index for category-based queries
CREATE INDEX IF NOT EXISTS idx_dealers_category
  ON dealers (category)
  WHERE category IS NOT NULL;

COMMENT ON COLUMN dealers.category IS
  'The business category/vertical for this dealer. '
  'Determines which AI parsing prompt and validation rules are used. '
  'Defaults to ''food'' for backwards compatibility.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ADD CATEGORY_ATTRIBUTES TO MARKET_PRODUCTS
-- ═══════════════════════════════════════════════════════════════════════════

-- Add JSONB column for category-specific product attributes
ALTER TABLE market_products
  ADD COLUMN IF NOT EXISTS category_attributes JSONB DEFAULT NULL;

COMMENT ON COLUMN market_products.category_attributes IS
  'Category-specific attributes for this product as JSONB. '
  'Shape depends on the dealer''s category: '
  'FOOD: {ingredienti: [...], allergeni: [...]} '
  'ABBIGLIAMENTO: {taglie_disponibili: ["S","M","L"], colori: ["nero","bianco"]} '
  'GROCERY: {unita: "kg", brand: "Barilla", peso: "500g"} '
  'PET: {specie: "cane", taglia_animale: "grande"} '
  'FARMACIE: {dosaggio: "500mg", forma: "compresse", tipo_ricetta: "OTC"} '
  'CASA: {dimensioni: "200x200cm", materiale: "cotone"} '
  'NULL for legacy products without enriched metadata.';

-- Index for querying products by specific category attributes (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_market_products_category_attrs
  ON market_products USING gin (category_attributes)
  WHERE category_attributes IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ADD CATEGORY TO TRAINING_EXAMPLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Add category column to training_examples
ALTER TABLE training_examples
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'food'
  REFERENCES dealer_categories(id);

-- Index for category-filtered few-shot retrieval
CREATE INDEX IF NOT EXISTS idx_training_examples_category
  ON training_examples (category, is_confirmed, quality_score DESC)
  WHERE is_confirmed = true;

-- Combined index: dealer + category + confirmed (most specific query)
CREATE INDEX IF NOT EXISTS idx_training_examples_dealer_category
  ON training_examples (dealer_id, category, is_confirmed, quality_score DESC)
  WHERE dealer_id IS NOT NULL AND is_confirmed = true;

COMMENT ON COLUMN training_examples.category IS
  'The business category this training example belongs to. '
  'Used to filter few-shot examples by vertical. '
  'Defaults to ''food'' for backwards compatibility with pre-category examples.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. BACKWARDS COMPATIBILITY: Default existing data to 'food'
-- ═══════════════════════════════════════════════════════════════════════════

-- Set existing dealers without a category to 'food'
UPDATE dealers
  SET category = 'food'
  WHERE category IS NULL;

-- Set existing training examples without a category to 'food'
UPDATE training_examples
  SET category = 'food'
  WHERE category IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. EXAMPLE: SEED MARKET_PRODUCTS FOR ABBIGLIAMENTO (Yamamay)
-- ═══════════════════════════════════════════════════════════════════════════
-- Uncomment and adapt dealer_id to seed products for a Yamamay dealer.
-- This demonstrates how category_attributes enriches the catalog.
/*
INSERT INTO market_products (dealer_id, name, price, category, description, stock, category_attributes) VALUES
  ('yamamay_napoli_1', 'Maglietta Basica Cotone', 15.90, 'intimo', 'Maglietta in cotone organico', 100,
   '{"taglie_disponibili": ["XS","S","M","L","XL"], "colori": ["bianco","nero","grigio","rosa"], "materiale": "cotone", "genere": "donna"}'::jsonb),
  ('yamamay_napoli_1', 'Reggiseno Push-Up', 29.90, 'intimo', 'Reggiseno push-up con ferretto', 50,
   '{"taglie_disponibili": ["2B","2C","3B","3C","3D","4B","4C","4D"], "colori": ["nero","bianco","beige","rosso"], "materiale": "pizzo/microfibra", "genere": "donna"}'::jsonb),
  ('yamamay_napoli_1', 'Boxer Uomo Cotone', 12.90, 'intimo', 'Boxer in cotone elasticizzato', 80,
   '{"taglie_disponibili": ["S","M","L","XL","XXL"], "colori": ["nero","bianco","blu","grigio"], "materiale": "cotone", "genere": "uomo"}'::jsonb),
  ('yamamay_napoli_1', 'Pigiama Donna Invernale', 39.90, 'pigiameria', 'Pigiama lungo in caldo cotone', 30,
   '{"taglie_disponibili": ["S","M","L","XL"], "colori": ["rosa","grigio","azzurro"], "materiale": "caldo cotone", "genere": "donna"}'::jsonb),
  ('yamamay_napoli_1', 'Costume Bikini', 35.90, 'costumi', 'Bikini a triangolo', 40,
   '{"taglie_disponibili": ["XS","S","M","L"], "colori": ["nero","bianco","azzurro","corallo"], "materiale": "lycra", "genere": "donna"}'::jsonb);
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. EXAMPLE: SEED TRAINING_EXAMPLES FOR ABBIGLIAMENTO
-- ═══════════════════════════════════════════════════════════════════════════
-- Uncomment to seed initial training examples for abbigliamento category.
/*
INSERT INTO training_examples (dealer_id, category, raw_input, parsed_output, is_confirmed, quality_score, source, model_version) VALUES
  ('yamamay_napoli_1', 'abbigliamento',
   '2 magliette bianche taglia M e un reggiseno nero taglia 3C per Anna, Via Toledo 22 Napoli 3339876543',
   '{
     "is_order": true,
     "category": "abbigliamento",
     "customer": {"name": "Anna", "phone": "+39 3339876543"},
     "delivery": {"street": "Via Toledo", "number": "22", "city": "Napoli", "extra": null},
     "items": [
       {"product": "Maglietta Basica Cotone", "quantity": 2, "unit_price": 15.90, "notes": null,
        "category_attributes": {"taglia": "M", "colore": "bianco", "materiale": null, "genere": "donna", "taglia_reggiseno": null}},
       {"product": "Reggiseno Push-Up", "quantity": 1, "unit_price": 29.90, "notes": null,
        "category_attributes": {"taglia": null, "colore": "nero", "materiale": null, "genere": "donna", "taglia_reggiseno": "3C"}}
     ],
     "missing_fields": []
   }'::jsonb,
   true, 8, 'manual', 'claude-3-5-haiku-20241022');
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Run after applying
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT * FROM dealer_categories ORDER BY sort_order;
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'dealers' AND column_name = 'category';
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'market_products' AND column_name = 'category_attributes';
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'training_examples' AND column_name = 'category';
