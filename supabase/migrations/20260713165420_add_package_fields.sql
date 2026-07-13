-- ============================================================================
-- MIGRATION: Add Package Fields to Orders Table
-- ============================================================================
-- Adds package_size, package_count, is_fragile columns for Telegram Mini App
-- ============================================================================

-- Add package_size column (S/M/L/XL)
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS package_size TEXT
CHECK (package_size IN ('S', 'M', 'L', 'XL'));

-- Add package_count column (1-10 colli)
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS package_count INTEGER DEFAULT 1
CHECK (package_count > 0 AND package_count <= 10);

-- Add is_fragile flag
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS is_fragile BOOLEAN DEFAULT FALSE;

-- Add comments for documentation
COMMENT ON COLUMN public.orders.package_size IS 'Taglia pacco: S (< 30cm), M (30-60cm), L (60-100cm), XL (> 100cm)';
COMMENT ON COLUMN public.orders.package_count IS 'Numero di colli (default 1, max 10)';
COMMENT ON COLUMN public.orders.is_fragile IS 'Pacco fragile (richiede attenzione extra dal rider)';

-- Create index for analytics on package_size (optional but useful)
CREATE INDEX IF NOT EXISTS idx_orders_package_size
ON public.orders(package_size)
WHERE package_size IS NOT NULL;

-- Create index for fragile orders (fast queries)
CREATE INDEX IF NOT EXISTS idx_orders_is_fragile
ON public.orders(is_fragile)
WHERE is_fragile = TRUE;
