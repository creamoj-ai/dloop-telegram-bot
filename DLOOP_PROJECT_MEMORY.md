# DLOOP SAAS - PROJECT MEMORY

## 🎯 VISION & BUSINESS MODEL

**Dloop è una piattaforma SaaS pura per gestione consegne last-mile.** NON è una marketplace, NON tocca mai denaro.

### Principi Fondamentali:
- ✅ SaaS-only: merchant e rider pagano subscription mensile a Dloop
- ✅ Zero transazioni denaro: prodotti e consegne pagate offline o direttamente
- ✅ Competitive moat: **sistema reputazione rider** (non pricing)
- ✅ Dispatch intelligente: reputation-driven + broadcast tiered escalation
- ❌ NO Stripe payments per ordini (solo billing mensile in weekly-billing/)
- ❌ NO commissioni su transazioni
- ❌ NO gestione denaro prodotti/consegne

## 🏗️ ARCHITETTURA

### Stack Tecnologico:
- **Backend**: Supabase (PostgreSQL + Edge Functions Deno)
- **Bot Framework**: grammY (Telegram, webhook mode)
- **Geospatial**: PostGIS per query nearest rider
- **Cron**: pg_cron per escalation-tick (ogni 60s)

### Edge Functions (Supabase):
```
supabase/functions/
├── telegram-webhook/     # Bot grammY con session DB-backed
│   ├── index.ts         # Entry point + webhookCallback
│   ├── deps.ts          # grammY, Supabase imports
│   ├── handlers/
│   │   ├── commands.ts  # /start, /nuovo_ordine, /mia_reputazione
│   │   ├── callbacks.ts # Accept/decline order, rate rider
│   │   └── session.ts   # Multi-step order creation (6 steps)
│   ├── services/
│   │   ├── dispatch-service.ts    # Broadcast tiered + PostGIS
│   │   ├── order-service.ts       # CRUD ordini
│   │   ├── reputation-service.ts  # Score calculation
│   │   └── session-store.ts       # DB-backed session
│   └── shared/
│       ├── config.ts    # CONFIG constants
│       ├── types.ts     # TypeScript interfaces
│       └── supabase.ts  # Supabase client singleton
├── escalation-tick/      # Cron (60s) - tier escalation 0→1→2→3
├── weekly-billing/       # Stripe subscription billing (cron weekly)
└── whatsapp-webhook/     # WhatsApp intake (future)
```

### Database Schema (PostgreSQL):

**Core Tables:**
- `merchants`: commercianti (subscription)
- `riders`: fattorini (reputation_score, location geography)
- `dealers`: punti ritiro merchant
- `orders`: ordini consegna (broadcast_tier, delivery_fee_shown, payment_mode)
- `ratings`: voti 1-5 (append-only)
- `rider_listino`: prezzi per zona (mediana → delivery_fee_shown)
- `token_ledger`: crediti prepaid merchant
- `sessions`: session state per bot multi-step

**Key Columns:**
```sql
-- riders
reputation_score INT DEFAULT 50         -- 0-100, guida dispatch priority
acceptance_rate DECIMAL(5,4)            -- % ordini accettati
completion_rate DECIMAL(5,4)            -- % ordini completati
on_time_rate DECIMAL(5,4)              -- % consegne puntuali
location geography(Point, 4326)         -- PostGIS per nearest query

-- orders
broadcast_tier INT DEFAULT 0            -- 0=top, 1=mid, 2=all, 3=extended
broadcast_started_at TIMESTAMPTZ        -- timestamp inizio broadcast
delivery_fee_shown DECIMAL(6,2)         -- tariffa mostrata (non processata)
payment_mode TEXT                       -- prepaid|delivery_on_completion|cod
delivery_payment_confirmed BOOLEAN      -- rider conferma incasso
```

## 🚀 DISPATCH SYSTEM (Reputation-Driven)

### Broadcast Tiered Escalation:

**Tier 0 (t=0s)**: Notifica solo rider con reputation_score >= 70 in raggio 5km
**Tier 1 (t=60s)**: Allarga a reputation_score >= 40
**Tier 2 (t=120s)**: Tutti i rider in zona (score >= 0)
**Tier 3 (t=180s)**: Raggio esteso 10km + alert admin per dispatch manuale

### Flow:
1. Merchant crea ordine `/nuovo_ordine` → status PENDING
2. `dispatch-service.ts` query PostGIS nearest riders tier 0
3. Setta `broadcast_tier=0`, `broadcast_started_at=NOW()`
4. Notifica max 5 rider (InlineKeyboard: Accetto/Rifiuto)
5. Primo rider che accetta → status ACCEPTED, assegnato
6. Se decline → `recordDecline()` aggiorna acceptance_rate, re-dispatch
7. Cron `escalation-tick` (60s) scala tier se nessuno accetta
8. Tier 3 → alert admin Telegram con `/assign_rider` manual

### Reputation Score Calculation:
```typescript
score = (
  avg_rating_normalized * 0.35 +
  acceptance_rate * 0.20 +
  completion_rate * 0.25 +
  on_time_rate * 0.20
) * 100  // 0-100
```

## 💰 PAYMENT MODES (REGISTERED ONLY)

1. **prepaid**: Merchant usa crediti token_ledger (deducted on order creation)
2. **delivery_on_completion**: Cliente paga rider alla consegna (delivery_fee_shown)
3. **cod**: Contrassegno - rider raccoglie prodotto + consegna

**CRITICAL**: Dloop NON processa pagamenti! Solo registra `payment_mode` e mostra `delivery_fee_shown` (mediana zona).

### Delivery Fee Shown:
- Calcolato da `getZoneMedianFee(zona)` → SQL function `get_zone_median_fee`
- Mediana prezzi in `rider_listino` per zona
- Se < 5 listini → fallback `CONFIG.DELIVERY_FEE.cold_start_default` (€3.50)
- Mostrato a customer nel recap ordine, NON processato da Dloop

## 📱 BOT COMMANDS (Telegram)

### User Commands:
- `/start` - Menu principale con lista comandi
- `/nuovo_ordine` - Multi-step order creation (6 steps)
- `/mia_reputazione` - Rider vede proprio score e stats

### Admin Commands (solo shoshyUserId):
- `/list_orders [status]` - Lista ordini
- `/assign_rider {order_id} {rider_id}` - Assegnazione manuale
- `/rider_status` - Rider online
- `/cancel_order {order_id}` - Cancella ordine

### Multi-Step Order Flow (session DB-backed):
1. **PICKUP** - Selezione dealer (InlineKeyboard)
2. **DELIVERY_ADDRESS** - Indirizzo consegna (text input)
3. **RECIPIENT** - Nome + telefono destinatario (text)
4. **TIME_WINDOW** - Fascia oraria opzionale (bottoni)
5. **PAYMENT_MODE** - prepaid|delivery_on_completion|cod (bottoni)
6. **RECAP** - Conferma ordine → dispatch

## 🔧 CONFIGURATION

### Environment Variables (Supabase Secrets):
```
TELEGRAM_BOT_TOKEN=8771823120:AAHeJBEuL9nfMhj7riMvZA0sCqrduoNYG60
TELEGRAM_WEBHOOK_SECRET=31e1100e1eed3477c1cd83a43b8645a02396be9ad0e7da43842cb64eabb9bdbb
SHOSHY_TELEGRAM_USER_ID=6693621032
SUPABASE_URL=https://aqpwfurradxbnqvycvkm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### CONFIG Constants (shared/config.ts):
```typescript
REPUTATION: {
  weights: { avg_rating: 0.35, acceptance_rate: 0.20, completion_rate: 0.25, on_time_rate: 0.20 },
  default_score: 50,
}
DELIVERY_FEE: {
  cold_start_default: 3.50,
  min_listini_for_median: 5,
}
BROADCAST: {
  radius_km: 5,
  extended_radius_km: 10,
  max_riders_per_tier: 5,
  tier_thresholds: { 0: 70, 1: 40, 2: 0, 3: 0 },
}
```

## 📝 SQL MIGRATIONS

### Latest: `009_reputation_and_delivery_fee.sql`
- Tabelle: `ratings`, `rider_listino`
- Campi rider: reputation_score, acceptance/completion/on_time_rate, location (PostGIS)
- Campi order: broadcast_tier, broadcast_started_at, delivery_fee_shown, payment_mode
- PostGIS extension + geography column
- Vista `rider_reputation`
- Funzione `get_zone_median_fee(zona)`

### Previous:
- `008_token_ledger.sql` - Prepaid credits
- `007_merchant_modes_and_wa.sql` - WhatsApp integration

## 🚨 CRITICAL FIXES HISTORY

### 1. grammY Import Issue:
**Problema**: `deno.land/x/grammy` requires `cdn.skypack.dev` access denied
**Fix**: Cambiato a `esm.sh/grammy@1.30.0` in `deps.ts`

### 2. JWT Verification Blocking Webhook:
**Problema**: Edge Function ritorna 401 per JWT verification
**Fix**: `verify_jwt: false` in `supabase/config.toml` + Management API PATCH

### 3. Secret Token Mismatch:
**Problema**: grammY webhookCallback faceva propria verifica token senza config
**Fix**: Aggiunto `secretToken` option a `webhookCallback(bot, "std/http", { secretToken })`

### 4. Markdown Parsing Error (byte offset 300):
**Problema**: Underscore in `/nuovo_ordine` interpretati come italic, `<order_id>` come HTML tag
**Fix**: Cambiato `parse_mode: "Markdown"` → `"HTML"`, `**bold**` → `<b>bold</b>`

## 🎯 DEPLOYMENT

### Webhook Setup (Telegram):
```bash
curl -X POST "https://api.telegram.org/bot8771823120:AAHeJBEuL9nfMhj7riMvZA0sCqrduoNYG60/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-webhook",
    "secret_token": "31e1100e1eed3477c1cd83a43b8645a02396be9ad0e7da43842cb64eabb9bdbb"
  }'
```

### Function Deploy:
```bash
supabase login --token YOUR_TOKEN
supabase functions deploy telegram-webhook --project-ref aqpwfurradxbnqvycvkm --no-verify-jwt
supabase functions deploy escalation-tick --project-ref aqpwfurradxbnqvycvkm --no-verify-jwt
```

### Cron Job (pg_cron):
```sql
-- Già configurato in DB
SELECT * FROM cron.job WHERE jobname = 'dloop-escalation-tick';
-- Runs: every 60s
-- Invokes: escalation-tick edge function
```

## ✅ CURRENT STATUS (2026-06-18)

- ✅ Telegram bot funzionante (webhook mode)
- ✅ Sistema reputazione implementato
- ✅ Broadcast tiered dispatch attivo
- ✅ Multi-step order creation (session DB)
- ✅ Payment modes: prepaid, delivery_on_completion, cod
- ✅ Delivery fee shown (mediana zona)
- ✅ PostGIS nearest rider queries
- ✅ Escalation-tick cron function deployed
- ✅ Rating system (merchant/customer → rider)

### Next Steps:
- [ ] Test completo flow end-to-end con ordini reali
- [ ] Deploy whatsapp-webhook per intake ordini
- [ ] Monitoraggio reputazione rider in produzione
- [ ] Tuning tier thresholds basato su dati reali

## 🔗 REPOSITORY

**Path**: `C:/Users/itjob/dloop-telegram-bot`
**Branch**: `feat/saas-dispatch`
**Project ID**: `aqpwfurradxbnqvycvkm` (eu-central-1)

---

**Last Updated**: 2026-06-18
**Status**: ✅ Production Ready - Bot Operational
