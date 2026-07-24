-- ============================================================================
-- MIGRATION: Add telegram_user_id to riders table
-- ============================================================================
-- Aggiunge colonna telegram_user_id per integrazione bot Telegram rider
-- ============================================================================

ALTER TABLE public.riders
ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_riders_telegram_user_id
ON public.riders(telegram_user_id);

COMMENT ON COLUMN public.riders.telegram_user_id IS 'Telegram User ID univoco del rider per bot integration';
