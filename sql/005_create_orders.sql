-- ============================================================================
-- DLOOP TELEGRAM BOT - ORDERS TABLE
-- ============================================================================
-- Tabella ordini per tracking pagamenti e delivery
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID NOT NULL,  -- FK to dealers.id
  customer_name VARCHAR(255),
  customer_phone VARCHAR(20) NOT NULL,
  customer_address TEXT,
  items JSONB NOT NULL,  -- [{name: "Pizza", quantity: 1, price: 10.00}]
  total_amount DECIMAL(10,2) NOT NULL,
  stripe_fee_amount DECIMAL(10,2),  -- 3.5% of total_amount
  total_with_fee DECIMAL(10,2),  -- total_amount + stripe_fee_amount
  status VARCHAR(50) DEFAULT 'pending',  -- pending, accepted, assigned, completed, cancelled
  assigned_rider_id UUID,  -- FK to riders.id (FASE 3)
  payment_status VARCHAR(50) DEFAULT 'pending',  -- pending, completed, failed
  payment_intent_id VARCHAR(255),  -- Stripe payment intent/checkout session ID
  stripe_payment_link TEXT,  -- Generated payment link URL
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_dealer ON orders(dealer_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

-- RLS (Row Level Security)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Allow service role full access to orders"
  ON orders
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Verifica creazione
SELECT COUNT(*) as order_count FROM orders;

-- ============================================================================
-- SUCCESS: Tabella orders creata e pronta per FASE 2
-- ============================================================================
