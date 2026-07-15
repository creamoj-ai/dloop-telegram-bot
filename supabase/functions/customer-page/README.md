# Customer Page Edge Function

Edge Function per gestire il completamento ordini da parte dei clienti tramite link generato dal merchant.

## Flusso

1. **Merchant genera link** (`/ordine` in Telegram)
   - Sistema crea ordine con `status="pending"`, `customer_token`, `token_expires_at` (24h)
   - Merchant invia link al cliente: `https://dloop.it/c/{token}`

2. **Cliente apre link** (GET `/c/{token}`)
   - Verifica token valido e non scaduto
   - Verifica ordine in stato `pending`
   - Mostra form HTML mobile-first per compilare:
     - Nome destinatario
     - Telefono (validazione formato IT: +39, 39, 3...)
     - Indirizzo di consegna
     - Note (opzionale)

3. **Cliente conferma** (POST `/c/{token}`)
   - Validazione server-side
   - Se errori: ri-mostra form con errori (dati non persi)
   - Se valido:
     - Aggiorna ordine: `delivery_address`, `recipient_name`, `recipient_phone`, `notes`
     - Genera PIN 4 cifre random, salva su `delivery_pin`
     - Setta `broadcast_tier=0`, `broadcast_started_at=NOW()` per triggerare broadcast
     - Invia PIN al cliente via WhatsApp (stub per ora, attivo quando `CUSTOMER_WA_ENABLED=true`)
     - Mostra pagina conferma con PIN

4. **Broadcast rider automatico**
   - `escalation-tick` (cron ogni 60s) rileva ordini con `broadcast_started_at` NOT NULL
   - Notifica rider in zona (tier 0 → top reputation)
   - Escalation automatica tier 0→1→2→3 se nessuno accetta

## Endpoint

- `GET /c/{token}` - Mostra form HTML
- `POST /c/{token}` - Submit form, aggiorna ordine, trigger broadcast

## Environment Variables

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
CUSTOMER_WA_ENABLED=false  # true per attivare invio PIN via WhatsApp
WA_PHONE_ID=xxx            # Phone number ID WhatsApp Cloud API
WA_ACCESS_TOKEN=xxx        # Access token WhatsApp Cloud API
```

## Deploy

```bash
# Deploy function
supabase functions deploy customer-page

# Set secrets (se non già settati)
supabase secrets set SUPABASE_URL=https://xxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
supabase secrets set CUSTOMER_WA_ENABLED=false
```

## Database Schema

Richiede colonne su `orders`:
- `customer_token` (TEXT, UNIQUE)
- `token_expires_at` (TIMESTAMPTZ)
- `delivery_address` (TEXT)
- `recipient_name` (TEXT)
- `recipient_phone` (TEXT)
- `notes` (TEXT, nullable)
- `delivery_pin` (TEXT, nullable)
- `broadcast_tier` (INT, default 0)
- `broadcast_started_at` (TIMESTAMPTZ, nullable)

Migration SQL: `sql/012_customer_page_delivery_pin.sql`

## Note

- Form funziona su connessioni 3G (no JS pesante, HTML puro)
- Validazione telefono italiano: +393xxxxxxxx, 393xxxxxxxx, 3xxxxxxxx
- PIN 4 cifre mostrato a cliente e inviato via WhatsApp (quando attivo)
- Link scade dopo 24 ore dalla generazione
- Broadcast rider gestito da `escalation-tick` (automatico, no azione manuale)
