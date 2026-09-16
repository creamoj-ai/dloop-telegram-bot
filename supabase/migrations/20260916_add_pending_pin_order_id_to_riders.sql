-- ============================================================================
-- MIGRATION: Add pending_pin_order_id to riders table
-- ============================================================================
-- Traccia l'ordine specifico in attesa PIN per ogni rider, evitando
-- la race condition con .limit(1) quando più rider sono attivi.
-- ============================================================================

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS pending_pin_order_id UUID REFERENCES orders(id);

COMMENT ON COLUMN public.riders.pending_pin_order_id IS 'ID ordine in attesa PIN: impostato al delivery_confirmed, azzerato dopo validazione PIN';
