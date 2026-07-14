ALTER TABLE rider_listino
  ADD COLUMN IF NOT EXISTS base_fee        NUMERIC(6,2) NOT NULL DEFAULT 4.00,
  ADD COLUMN IF NOT EXISTS per_km_rate     NUMERIC(6,2) NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS xl_surcharge    NUMERIC(6,2) NOT NULL DEFAULT 2.50,
  ADD COLUMN IF NOT EXISTS multi_surcharge NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS zone            TEXT NOT NULL DEFAULT 'portici';

CREATE INDEX IF NOT EXISTS idx_rider_listino_zone ON rider_listino(zone);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS package_size      TEXT NOT NULL DEFAULT 'M' CHECK (package_size IN ('S','M','L','XL')),
  ADD COLUMN IF NOT EXISTS package_count     INT NOT NULL DEFAULT 1 CHECK (package_count > 0),
  ADD COLUMN IF NOT EXISTS is_fragile        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offered_fee       NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS customer_token    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS token_expires_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_customer_token ON orders(customer_token) WHERE customer_token IS NOT NULL;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS vehicle_type     TEXT NOT NULL DEFAULT 'scooter' CHECK (vehicle_type IN ('bike','scooter','car','van')),
  ADD COLUMN IF NOT EXISTS max_package_size TEXT NOT NULL DEFAULT 'L' CHECK (max_package_size IN ('S','M','L','XL'));

UPDATE riders SET max_package_size = CASE vehicle_type WHEN 'bike' THEN 'S' WHEN 'scooter' THEN 'L' WHEN 'car' THEN 'XL' WHEN 'van' THEN 'XL' ELSE 'L' END WHERE max_package_size = 'L';

ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS default_package_size TEXT DEFAULT 'M' CHECK (default_package_size IN ('S','M','L','XL')),
  ADD COLUMN IF NOT EXISTS default_payment_mode TEXT CHECK (default_payment_mode IN ('prepaid','delivery_on_completion','cod')),
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS pickup_lng NUMERIC(10,7);

UPDATE dealers SET pickup_address = address, pickup_lat = (location)[1], pickup_lng = (location)[0] WHERE pickup_address IS NULL AND address IS NOT NULL AND location IS NOT NULL;

CREATE OR REPLACE FUNCTION get_zone_median_fee(p_zone TEXT, p_distance_km NUMERIC, p_package_size TEXT, p_package_count INT) RETURNS NUMERIC AS $$ DECLARE v_active_count INT; v_median_base NUMERIC; v_median_per_km NUMERIC; v_median_xl NUMERIC; v_median_multi NUMERIC; v_km_over_2 NUMERIC; v_fee NUMERIC; BEGIN SELECT COUNT(DISTINCT rl.rider_id) INTO v_active_count FROM rider_listino rl INNER JOIN riders r ON r.id = rl.rider_id WHERE rl.zone = p_zone AND r.status IN ('online', 'on_delivery'); IF v_active_count < 3 THEN v_median_base := 4.00; v_median_per_km := 0.80; v_median_xl := 2.50; v_median_multi := 1.00; ELSE SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY base_fee), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY per_km_rate), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY xl_surcharge), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY multi_surcharge) INTO v_median_base, v_median_per_km, v_median_xl, v_median_multi FROM rider_listino rl INNER JOIN riders r ON r.id = rl.rider_id WHERE rl.zone = p_zone AND r.status IN ('online', 'on_delivery'); END IF; v_km_over_2 := GREATEST(p_distance_km - 2, 0); v_fee := v_median_base + (CEIL(v_km_over_2) * v_median_per_km); IF p_package_size = 'XL' THEN v_fee := v_fee + v_median_xl; END IF; IF p_package_count >= 3 THEN v_fee := v_fee + v_median_multi; END IF; RETURN ROUND(v_fee * 2) / 2.0; END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_rider_price(p_rider_id UUID, p_distance_km NUMERIC, p_package_size TEXT, p_package_count INT) RETURNS NUMERIC AS $$ DECLARE v_base NUMERIC; v_per_km NUMERIC; v_xl NUMERIC; v_multi NUMERIC; v_km_over_2 NUMERIC; v_fee NUMERIC; BEGIN SELECT base_fee, per_km_rate, xl_surcharge, multi_surcharge INTO v_base, v_per_km, v_xl, v_multi FROM rider_listino WHERE rider_id = p_rider_id LIMIT 1; IF v_base IS NULL THEN RETURN NULL; END IF; v_km_over_2 := GREATEST(p_distance_km - 2, 0); v_fee := v_base + (CEIL(v_km_over_2) * v_per_km); IF p_package_size = 'XL' THEN v_fee := v_fee + v_xl; END IF; IF p_package_count >= 3 THEN v_fee := v_fee + v_multi; END IF; RETURN ROUND(v_fee * 2) / 2.0; END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calculate_distance_km(p_lat1 NUMERIC, p_lng1 NUMERIC, p_lat2 NUMERIC, p_lng2 NUMERIC) RETURNS NUMERIC AS $$ DECLARE v_earth_radius NUMERIC := 6371; v_dlat NUMERIC; v_dlng NUMERIC; v_a NUMERIC; v_c NUMERIC; BEGIN v_dlat := RADIANS(p_lat2 - p_lat1); v_dlng := RADIANS(p_lng2 - p_lng1); v_a := SIN(v_dlat/2) * SIN(v_dlat/2) + COS(RADIANS(p_lat1)) * COS(RADIANS(p_lat2)) * SIN(v_dlng/2) * SIN(v_dlng/2); v_c := 2 * ATAN2(SQRT(v_a), SQRT(1-v_a)); RETURN ROUND((v_earth_radius * v_c)::NUMERIC, 2); END; $$ LANGUAGE plpgsql IMMUTABLE;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM rider_listino WHERE base_fee IS NOT NULL LIMIT 1) THEN UPDATE rider_listino SET base_fee = 4.00, per_km_rate = 0.80, xl_surcharge = 2.50, multi_surcharge = 1.00, zone = 'portici' WHERE base_fee IS NULL; END IF; END $$;

SELECT get_zone_median_fee('portici', 5.0, 'M', 1) as test_5km;
SELECT get_zone_median_fee('portici', 3.5, 'XL', 4) as test_XL;
SELECT calculate_distance_km(40.8518, 14.2681, 40.8156, 14.3388) as test_km;
