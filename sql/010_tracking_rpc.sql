-- ============================================================================
-- DLOOP SAAS — PUBLIC ORDER TRACKING RPC
-- ============================================================================
-- Returns ONLY safe, non-PII fields for public tracking page.
-- Called with ANON key from dloop-gateway frontend at dloop.it/t/{uuid}
-- ============================================================================

CREATE OR REPLACE FUNCTION get_tracking_status(p_order_id UUID)
RETURNS TABLE(
  order_id UUID,
  status TEXT,
  merchant_name TEXT,
  rider_first_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id AS order_id,
    o.status::TEXT,
    o.restaurant_name::TEXT AS merchant_name,
    -- Only first name from riders table, split on space. Returns NULL if no rider assigned.
    CASE
      WHEN r.name IS NOT NULL THEN split_part(r.name::TEXT, ' ', 1)
      ELSE NULL
    END AS rider_first_name,
    o.created_at,
    o.created_at AS updated_at  -- orders table non ha updated_at, uso created_at
  FROM orders o
  LEFT JOIN riders r ON r.id = o.assigned_rider_id
  WHERE o.id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SECURITY DEFINER means it runs with the OWNER's privileges,
-- bypassing RLS. The function itself constrains what is returned.
-- The `orders` table has RLS enabled with only a service-role policy.
-- The `anon` role cannot read from `orders` directly.
-- This function acts as a controlled data projection - no PII can leak.

COMMENT ON FUNCTION get_tracking_status IS
  'Public tracking: returns only order status, merchant name, and rider first name. '
  'No PII (no phone, no address, no amounts). Called via ANON key from frontend.';

-- Grant ANON role permission to execute this function
GRANT EXECUTE ON FUNCTION get_tracking_status(UUID) TO anon;

-- ============================================================================
-- TESTING
-- ============================================================================
-- Test with a valid order UUID:
-- SELECT * FROM get_tracking_status('your-order-uuid-here');
--
-- Test with invalid UUID (should return 0 rows):
-- SELECT * FROM get_tracking_status('00000000-0000-0000-0000-000000000000');
--
-- Test via REST API with ANON key:
-- curl "https://aqpwfurradxbnqvycvkm.supabase.co/rest/v1/rpc/get_tracking_status" \
--   -H "apikey: YOUR_ANON_KEY" \
--   -H "Content-Type: application/json" \
--   -d '{"p_order_id": "your-uuid"}'
-- ============================================================================
