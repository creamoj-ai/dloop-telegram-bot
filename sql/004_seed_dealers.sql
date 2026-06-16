-- ============================================================================
-- DLOOP TELEGRAM BOT - SEED DEALERS (TEST DATA)
-- ============================================================================
-- Popola tabella dealers con merchant di test per POC
-- Run in Supabase SQL Editor: aqpwfurradxbnqvycvkm
-- ============================================================================
-- NOTA: La tabella dealers esiste già. Aggiungiamo solo colonne mancanti e dati test.
-- ============================================================================

-- 1. Aggiungi colonne mancanti per FASE 1 (safe, non tocca dati esistenti)
ALTER TABLE dealers
ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
ADD COLUMN IF NOT EXISTS location POINT;

CREATE INDEX IF NOT EXISTS idx_dealers_business_name ON dealers(business_name);

-- 2. Inserisci merchant di test (status=active, separati dai pending esistenti)
INSERT INTO dealers (
  id,
  business_name,
  owner_name,
  email,
  phone,
  category,
  address,
  city,
  postal_code,
  status,
  telegram_chat_id,
  whatsapp_number,
  location
)
VALUES
  (
    gen_random_uuid(),
    'Yamamay Napoli Centro',
    'Test Owner',
    'test.yamamay@dloop.test',
    '+39 081 1234567',
    'abbigliamento',
    'Via Toledo 256',
    'Napoli',
    '80134',
    'active',
    NULL,  -- ⚠️ DA COMPILARE: ottieni chat_id inviando /start al bot da account merchant
    '+39 081 1234567',
    POINT(14.2489, 40.8359)
  ),
  (
    gen_random_uuid(),
    'Pizzeria Sorbillo',
    'Test Owner',
    'test.sorbillo@dloop.test',
    '+39 081 446643',
    'ristorazione',
    'Via dei Tribunali 32',
    'Napoli',
    '80138',
    'active',
    NULL,  -- ⚠️ DA COMPILARE
    '+39 081 446643',
    POINT(14.2568, 40.8506)
  ),
  (
    gen_random_uuid(),
    'Farmacia Salute',
    'Test Owner',
    'test.farmacia@dloop.test',
    '+39 081 5547890',
    'farmacia',
    'Corso Umberto I 123',
    'Napoli',
    '80138',
    'active',
    NULL,  -- ⚠️ DA COMPILARE
    '+39 081 5547890',
    POINT(14.2611, 40.8489)
  );

-- 3. Verificare insert (solo active, non tocca i 2 pending esistenti)
SELECT id, business_name, status, telegram_chat_id, phone
FROM dealers
WHERE status = 'active'
ORDER BY business_name;

-- ============================================================================
-- NEXT STEPS:
-- 1. Esegui questo SQL in Supabase dashboard
-- 2. Per ogni merchant, ottieni telegram_chat_id:
--    - Fai login Telegram con account del merchant
--    - Invia /start a @dloop_saas_bot
--    - Copia chat_id dai log del bot
--    - UPDATE dealers SET telegram_chat_id = {id} WHERE business_name = 'Yamamay Napoli Centro';
-- ============================================================================
