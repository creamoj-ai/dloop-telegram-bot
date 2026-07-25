-- ============================================================================
-- CREATE TEST ORDER - Ordine completo per test broadcast rider
-- ============================================================================

INSERT INTO orders (
  restaurant_name,
  restaurant_address,
  pickup_address,
  customer_name,
  customer_phone,
  customer_address,
  distance_km,
  base_earning,
  status,
  package_size,
  package_count,
  is_fragile,
  delivery_fee_shown,
  payment_mode,
  source
) VALUES (
  'Test Merchant Napoli',
  'Via Roma 1, 80100 Napoli',
  'Via Roma 1, 80100 Napoli',
  'Mario Rossi',
  '+39 333 1234567',
  'Via Verdi 10, 80055 Portici (NA)',
  5.2,
  3.50,
  'pending',
  'M',
  1,
  false,
  5.50,
  'delivery_on_completion',
  'telegram_link'
)
RETURNING id, customer_name, customer_address, status;
