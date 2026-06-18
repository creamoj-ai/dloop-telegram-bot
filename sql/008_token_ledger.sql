-- ============================================================================
-- DLOOP SAAS — TOKEN LEDGER & BILLING
-- ============================================================================
-- Sistema di contabilita token per fatturazione SaaS settimanale.
-- 1 token = 1 consegna. Onboarding = 50 token gratuiti.
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- TOKEN LEDGER (doppia registrazione)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  amount INT NOT NULL, -- +50 (onboarding), -1 (ordine), +1 (refund)
  reason TEXT NOT NULL, -- 'onboarding' | 'order_created' | 'order_refund' | 'manual_adjustment'
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL, -- Null per onboarding/manual
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_merchant ON token_ledger(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_order ON token_ledger(order_id);

COMMENT ON TABLE token_ledger IS 'Registro movimenti token per fatturazione SaaS. Ogni riga = 1 transazione token.';
COMMENT ON COLUMN token_ledger.amount IS 'Quantita token: positivo = credito, negativo = addebito';
COMMENT ON COLUMN token_ledger.reason IS 'onboarding | order_created | order_refund | manual_adjustment';

-- ────────────────────────────────────────────────────────────────────────────
-- MERCHANT TOKEN BALANCE (view materializzata per performance)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW merchant_token_balance AS
SELECT
  merchant_id,
  SUM(amount) as balance,
  COUNT(CASE WHEN amount < 0 THEN 1 END) as orders_count,
  MAX(created_at) as last_movement_at
FROM token_ledger
GROUP BY merchant_id;

COMMENT ON VIEW merchant_token_balance IS 'Saldo token corrente per merchant. Refresh automatico con ogni INSERT su token_ledger.';

-- ────────────────────────────────────────────────────────────────────────────
-- FUNCTIONS: DEDUCT & REFUND TOKEN
-- ────────────────────────────────────────────────────────────────────────────

-- Deduci 1 token alla creazione ordine
CREATE OR REPLACE FUNCTION deduct_token(
  p_merchant_id UUID,
  p_order_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_balance INT;
BEGIN
  -- Controlla saldo
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM token_ledger
  WHERE merchant_id = p_merchant_id;

  IF v_balance < 1 THEN
    RAISE EXCEPTION 'Saldo token insufficiente: % token', v_balance
      USING ERRCODE = 'P0001';
  END IF;

  -- Deduzione
  INSERT INTO token_ledger (merchant_id, amount, reason, order_id)
  VALUES (p_merchant_id, -1, 'order_created', p_order_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduct_token IS 'Deduce 1 token dal merchant alla creazione ordine. Lancia exception se saldo < 1.';

-- Refund 1 token se ordine cancellato pre-pickup
CREATE OR REPLACE FUNCTION refund_token(
  p_order_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_merchant_id UUID;
  v_deduction_exists BOOLEAN;
BEGIN
  -- Trova merchant ID dall'ordine
  SELECT dealer_id INTO v_merchant_id
  FROM orders
  WHERE id = p_order_id;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Verifica che esista una deduzione per quest'ordine
  SELECT EXISTS(
    SELECT 1 FROM token_ledger
    WHERE order_id = p_order_id AND amount = -1 AND reason = 'order_created'
  ) INTO v_deduction_exists;

  IF NOT v_deduction_exists THEN
    -- Nessuna deduzione = niente da rimborsare (e.g. ordine mai completato)
    RETURN FALSE;
  END IF;

  -- Refund
  INSERT INTO token_ledger (merchant_id, amount, reason, order_id)
  VALUES (v_merchant_id, 1, 'order_refund', p_order_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_token IS 'Refund 1 token se ordine cancellato pre-pickup. Ritorna FALSE se nessuna deduzione trovata.';

-- ────────────────────────────────────────────────────────────────────────────
-- SEED: 50 token onboarding per merchant esistenti
-- ────────────────────────────────────────────────────────────────────────────

-- Solo se merchant non ha gia' movimenti token
INSERT INTO token_ledger (merchant_id, amount, reason)
SELECT
  id as merchant_id,
  50 as amount,
  'onboarding' as reason
FROM dealers
WHERE id NOT IN (SELECT DISTINCT merchant_id FROM token_ledger)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICA
-- ============================================================================
SELECT
  merchant_id,
  balance,
  orders_count,
  last_movement_at
FROM merchant_token_balance
ORDER BY balance ASC
LIMIT 10;
