-- ============================================================================
-- DLOOP SAAS — REPUTATION SYSTEM + DELIVERY FEE + BROADCAST TIERED
-- ============================================================================
-- Aggiunge: ratings, rider_listino, campi reputazione rider, campi consegna
-- ordini, PostGIS, funzione mediana zona, broadcast_tier.
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1a. RATINGS (append-only, bidirectional)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  rater_role TEXT NOT NULL CHECK (rater_role IN ('merchant','customer','rider')),
  ratee_role TEXT NOT NULL CHECK (ratee_role IN ('merchant','rider')),
  ratee_id UUID NOT NULL,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_order ON ratings(order_id);

COMMENT ON TABLE ratings IS 'Rating bidirezionali: merchant↔rider, customer→rider. Append-only.';
COMMENT ON COLUMN ratings.score IS 'Voto 1-5 stelle';

-- ────────────────────────────────────────────────────────────────────────────
-- 1b. RIDER LISTINO (prezzi consegna per zona)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rider_listino (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES riders(id),
  zona TEXT NOT NULL,
  prezzo DECIMAL(6,2) NOT NULL CHECK (prezzo > 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rider_id, zona)
);

CREATE INDEX IF NOT EXISTS idx_rider_listino_zona ON rider_listino(zona);
CREATE INDEX IF NOT EXISTS idx_rider_listino_rider ON rider_listino(rider_id);

COMMENT ON TABLE rider_listino IS 'Prezzi consegna rider per zona. Modifica max 1 volta/settimana, ±20%.';
COMMENT ON COLUMN rider_listino.prezzo IS 'Prezzo consegna EUR (es. 3.50)';

-- ────────────────────────────────────────────────────────────────────────────
-- 1c. ORDERS: aggiorna payment_mode + campi consegna/broadcast
-- ────────────────────────────────────────────────────────────────────────────

-- Rename constraint payment_mode: merchant_external → delivery_on_completion
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_mode_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_mode_check
  CHECK (payment_mode IN ('prepaid','delivery_on_completion','cod'));

-- Aggiorna righe esistenti
UPDATE orders SET payment_mode = 'delivery_on_completion'
  WHERE payment_mode = 'merchant_external';

-- Nuovi campi consegna
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_fee_shown DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS delivery_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_payment_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS broadcast_tier INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS broadcast_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_broadcast ON orders(broadcast_tier, broadcast_started_at)
  WHERE status = 'pending';

COMMENT ON COLUMN orders.delivery_fee_shown IS 'Prezzo consegna MOSTRATO al cliente (mediana zona), NON addebitato da Dloop';
COMMENT ON COLUMN orders.delivery_paid_at IS 'Timestamp conferma incasso consegna dal rider';
COMMENT ON COLUMN orders.delivery_payment_confirmed IS 'Rider conferma di aver incassato la consegna';
COMMENT ON COLUMN orders.broadcast_tier IS 'Tier broadcast: 0=top reputation, 1=media, 2=tutti, 3=esteso+alert admin';
COMMENT ON COLUMN orders.broadcast_started_at IS 'Timestamp inizio broadcast (per escalation tier)';

-- ────────────────────────────────────────────────────────────────────────────
-- 1d. RIDERS: campi reputazione
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS acceptance_rate DECIMAL(5,4) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS completion_rate DECIMAL(5,4) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS on_time_rate DECIMAL(5,4) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS total_deliveries INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reputation_score INT DEFAULT 50;

CREATE INDEX IF NOT EXISTS idx_riders_reputation ON riders(reputation_score DESC);

COMMENT ON COLUMN riders.acceptance_rate IS 'Accettati / ricevuti (0.0-1.0)';
COMMENT ON COLUMN riders.completion_rate IS 'Completati / accettati (0.0-1.0)';
COMMENT ON COLUMN riders.on_time_rate IS 'Consegne in finestra / completate (0.0-1.0)';
COMMENT ON COLUMN riders.total_deliveries IS 'Totale consegne completate';
COMMENT ON COLUMN riders.reputation_score IS 'Score composito 0-100, calcolato con formula pesi';

-- ────────────────────────────────────────────────────────────────────────────
-- 1e. PostGIS
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE riders ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_riders_location ON riders USING GIST(location);

COMMENT ON COLUMN riders.location IS 'Posizione rider (lat/lon WGS84) per query distanza PostGIS';

-- ────────────────────────────────────────────────────────────────────────────
-- 1f. VIEW: rider_reputation (aggregato calcolato)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW rider_reputation AS
SELECT
  r.id as rider_id,
  r.name,
  COALESCE(AVG(rt.score), 0) as avg_rating,
  r.acceptance_rate,
  r.completion_rate,
  r.on_time_rate,
  r.total_deliveries,
  r.reputation_score
FROM riders r
LEFT JOIN ratings rt ON rt.ratee_id = r.id AND rt.ratee_role = 'rider'
GROUP BY r.id;

COMMENT ON VIEW rider_reputation IS 'Vista aggregata reputazione rider: avg_rating + rates + score';

-- ────────────────────────────────────────────────────────────────────────────
-- 1g. FUNCTION: mediana zona (cold start default se < 5 listini)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_zone_median_fee(p_zona TEXT)
RETURNS DECIMAL AS $$
DECLARE
  v_count INT;
  v_median DECIMAL;
BEGIN
  SELECT COUNT(*) INTO v_count FROM rider_listino WHERE zona = p_zona;

  -- Cold start: < 5 listini in zona → ritorna NULL (config default)
  IF v_count < 5 THEN
    RETURN NULL;
  END IF;

  -- Calcola mediana
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY prezzo)
  INTO v_median FROM rider_listino WHERE zona = p_zona;

  RETURN v_median;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_zone_median_fee IS 'Mediana prezzi consegna zona. NULL se < 5 listini (cold start).';

-- ────────────────────────────────────────────────────────────────────────────
-- 1h. FUNCTION: get_riders_by_tier (PostGIS nearest + reputation filter)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_riders_by_tier(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_radius_m INT,
  p_min_reputation INT,
  p_max_riders INT
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  phone TEXT,
  telegram_user_id BIGINT,
  vehicle_type TEXT,
  status TEXT,
  vat_id TEXT,
  created_at TIMESTAMPTZ,
  earnings_week DECIMAL,
  orders_completed_week INT,
  rating DECIMAL,
  location geography,
  acceptance_rate DECIMAL,
  completion_rate DECIMAL,
  on_time_rate DECIMAL,
  total_deliveries INT,
  reputation_score INT,
  distance_m DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.phone,
    r.telegram_user_id,
    r.vehicle_type,
    r.status,
    r.vat_id,
    r.created_at,
    r.earnings_week,
    r.orders_completed_week,
    r.rating,
    r.location,
    r.acceptance_rate,
    r.completion_rate,
    r.on_time_rate,
    r.total_deliveries,
    r.reputation_score,
    ST_Distance(
      r.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
    ) as distance_m
  FROM riders r
  WHERE r.status = 'online'
    AND r.location IS NOT NULL
    AND r.reputation_score >= p_min_reputation
    AND ST_DWithin(
      r.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY r.reputation_score DESC, distance_m ASC
  LIMIT p_max_riders;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_riders_by_tier IS 'Query PostGIS: rider online, reputation >= threshold, nearest in radius, ordinati per reputation DESC + distance ASC.';

-- ────────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_listino ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_ratings" ON ratings;
CREATE POLICY "service_role_ratings"
  ON ratings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_listino" ON rider_listino;
CREATE POLICY "service_role_listino"
  ON rider_listino FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- VERIFICA
-- ============================================================================

SELECT
  COUNT(*) as rider_count,
  COUNT(CASE WHEN reputation_score >= 70 THEN 1 END) as top_reputation,
  COUNT(CASE WHEN reputation_score >= 40 AND reputation_score < 70 THEN 1 END) as mid_reputation
FROM riders;

-- Verifica constraint payment_mode
SELECT DISTINCT payment_mode FROM orders;
