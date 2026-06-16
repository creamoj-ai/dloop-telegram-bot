-- ============================================================================
-- DLOOP TELEGRAM BOT - TRAINING EXAMPLES TABLE
-- ============================================================================
-- Few-shot learning system: stores confirmed order parses so Haiku
-- can learn from real production data.
--
-- Run this in Supabase SQL Editor:
--   Project: aqpwfurradxbnqvycvkm
--   Dashboard: https://supabase.com/dashboard/project/aqpwfurradxbnqvycvkm/sql
-- ============================================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS training_examples (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id      UUID        NULL,                       -- FK to orders.id (nullable: example may exist before order is finalized)
  dealer_id     TEXT        NULL,                       -- dealer identifier for filtering examples by merchant
  raw_input     TEXT        NOT NULL,                   -- original user message (natural language)
  parsed_output JSONB       NOT NULL,                   -- Haiku's structured parse result
  is_confirmed  BOOLEAN     DEFAULT FALSE,              -- true once dealer accepts the order
  quality_score SMALLINT    DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 10),
                                                        -- 0 = unrated, 1-10 manual/auto quality
  source        TEXT        DEFAULT 'telegram',         -- 'telegram', 'whatsapp', 'web', 'manual'
  model_version TEXT        DEFAULT 'claude-3-5-haiku-20241022',
                                                        -- model that produced the parse
  feedback      TEXT        NULL,                       -- optional human correction notes
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes for fast few-shot retrieval
--    Primary query: SELECT ... WHERE is_confirmed = true ORDER BY quality_score DESC, created_at DESC LIMIT 5
CREATE INDEX idx_training_examples_confirmed
  ON training_examples (is_confirmed, quality_score DESC, created_at DESC)
  WHERE is_confirmed = true;

--    Lookup by order_id (for marking confirmed after dealer accept)
CREATE INDEX idx_training_examples_order_id
  ON training_examples (order_id)
  WHERE order_id IS NOT NULL;

--    Optional: filter by dealer for dealer-specific few-shot
CREATE INDEX idx_training_examples_dealer
  ON training_examples (dealer_id, is_confirmed, quality_score DESC)
  WHERE dealer_id IS NOT NULL AND is_confirmed = true;

-- 3. Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_training_examples_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_training_examples_updated_at
  BEFORE UPDATE ON training_examples
  FOR EACH ROW
  EXECUTE FUNCTION update_training_examples_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE training_examples ENABLE ROW LEVEL SECURITY;

-- Allow the service role (anon key used by the bot) full access.
-- In production you would tighten this to service_role only.
CREATE POLICY "Allow bot full access to training_examples"
  ON training_examples
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Add table comment
COMMENT ON TABLE training_examples IS
  'Stores input/output pairs from the Haiku order parser. '
  'Confirmed examples (is_confirmed=true) are injected as few-shot prompts '
  'to improve parsing accuracy over time.';

COMMENT ON COLUMN training_examples.raw_input IS
  'The original natural-language message sent by the user via Telegram.';

COMMENT ON COLUMN training_examples.parsed_output IS
  'The structured JSON produced by Haiku (same shape as ParsedOrder).';

COMMENT ON COLUMN training_examples.quality_score IS
  '0 = auto-inserted, not yet rated. 1-10 = manual quality rating. '
  'Higher scores are preferred for few-shot selection.';

-- ============================================================================
-- VERIFICATION: Run after applying
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'training_examples'
-- ORDER BY ordinal_position;
