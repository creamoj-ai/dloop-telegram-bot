# DLOOP SAAS — ROADMAP 2026

**Piattaforma**: Delivery on-demand peer-to-peer (Napoli metro)
**Stack**: Telegram Bot API + Supabase (PostgreSQL + Edge Functions) + Next.js (Vercel)
**Gate critico**: Primo ordine reale consegnato entro **31 Luglio 2026**

---

## ✅ SPRINT 2 — CUSTOMER ORDER FLOW (CHIUSO)

**Obiettivo**: Merchant genera link pubblico → Cliente compila form → Broadcast rider automatico

### Implementato:

#### 1. Bot Merchant (@dloop_merchant_bot)
- `/ordine` → Selezione taglia (S/M/L/XL)
- "Genera Link Cliente" → Crea ordine DB con `customer_token` + scadenza 24h
- Link generato: `https://dloop.it/c/{token}`
- Sessioni database-backed (no Map in-memory)

#### 2. Customer Page API (Supabase Edge Function)
**Path**: `supabase/functions/customer-page/index.ts`

**Endpoints**:
- `GET /c/{token}` → Valida token + ritorna info ordine (JSON)
- `POST /c/{token}` → Compila dati cliente + genera PIN + trigger broadcast

**Features**:
- ✅ Validazione telefono IT: `/^(\+39|39)?3\d{8,9}$/`
- ✅ Validazione indirizzo completo (numero + CAP/città)
- ✅ PIN 4 cifre generato automaticamente
- ✅ Trigger broadcast via `broadcast_started_at = NOW()`
- ✅ Select esplicito colonne (mai `select("*")` su orders)
- ✅ Security: `delivery_pin` esposto solo quando serve

#### 3. Frontend Customer (Next.js Vercel)
**Route**: `https://dloop.it/c/[token]`
**Repo**: `creamoj-ai/dloop-gateway`

**Stati UI**:
1. Loading (spinner)
2. Error (token invalid/expired)
3. Form compilazione (nome, telefono, indirizzo, note)
4. Success (PIN grande + conferma)
5. Already sent + PIN recovery (reload-friendly)

#### 4. Database Schema
**Tabella**: `orders`

**Colonne broadcast**:
```sql
broadcast_tier        INT         -- 0-3 escalation
broadcast_started_at  TIMESTAMPTZ -- Trigger broadcast (NOT NULL = attivo)
status                TEXT        -- pending → accepted → picked_up → delivered
delivery_pin          TEXT        -- Generato al submit cliente
customer_name         TEXT        -- NULL fino a compilazione form
customer_phone        TEXT
dropoff_address       TEXT
```

**REGOLA CRITICA**: Mai usare `select("*")` su orders → rompe per colonna `location` (POINT type)

### Test end-to-end (device reale):
1. Merchant bot: `/ordine` → M → Genera Link ✅
2. Link `https://dloop.it/c/xxx` aperto su mobile ✅
3. Form compilato: Mario Rossi, +39 333 1234567, Via Roma 123, 80100 Napoli ✅
4. Submit → PIN 8716 mostrato ✅
5. Reload → PIN recuperato (no errore secco) ✅
6. DB: `broadcast_started_at` valorizzato, tier = 0 ✅

**Status**: Sprint 2 CHIUSO, flusso merchant→cliente non si tocca più.

---

## 🔧 HOTFIX — INFRASTRUTTURA BOT MERCHANT (14 Luglio 2026)

**Problema**: Bot @dloop_saas_bot non riceveva richieste Telegram dopo blackout server. Log Edge Function mostravano solo boot/shutdown, zero invocazioni HTTP.

### Root Cause Analysis:

1. **JWT Verification attiva** sul gateway Supabase → Telegram riceveva 401 Unauthorized
2. **Webhook secret mismatch** tra Telegram e variabile d'ambiente Supabase
3. **Handler registration order errato** → `registerSessionHandler` catturava tutti i messaggi PRIMA che `/ordine` venisse registrato

### Fix Applicati:

#### 1. Gateway Configuration
```bash
# Deploy con JWT verification disabilitata per webhook pubblici
supabase functions deploy telegram-webhook --no-verify-jwt --project-ref aqpwfurradxbnqvycvkm

# Riconfigurazione webhook Telegram con secret token
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -d "url=https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=dloop_webhook_f7e153779c31588a04dffdab6014c15c"

# Sincronizzazione secret su Supabase
supabase secrets set TELEGRAM_WEBHOOK_SECRET=dloop_webhook_f7e153779c31588a04dffdab6014c15c
```

#### 2. Code Fixes (Commit: 2b9881a)
**File**: `supabase/functions/telegram-webhook/index.ts`
- ✅ Spostato `registerCustomerLinkHandlers` PRIMA di `registerSessionHandler`
  - Reason: `bot.on("message:text")` nel session handler catturava TUTTI i messaggi, impedendo ai comandi successivi di essere processati
- ✅ Aggiunto boot diagnostics (logging token/secret validation)
- ✅ Migrato da `serve()` deprecated a `Deno.serve()` native API
- ✅ Aggiunto `bot.catch()` error handler per logging errori grammY
- ✅ Aggiunto request logging dettagliato (method, URL, secret header presence)

**File**: `handlers/commands.ts`, `handlers/customer-link.ts`
- ✅ Aggiunto debug logging completo in `handleStart` e `handleOrdine`
- ✅ Rimosso `bot.command("ordine")` duplicato (ora solo in customer-link.ts)

#### 3. Database Cleanup
- ✅ Rimossi merchant duplicati (2 record con stesso `telegram_user_id` causavano errore `.maybeSingle()`)
- ✅ Inserito merchant test: Crescenzo Merchant Prova (ID Telegram: 6693621032)

### Test End-to-End (Post-Fix):

✅ `/start` → Risposta immediata con menu comandi
✅ `/nuovo_ordine` → Flusso multi-step funzionante
✅ `/ordine` → Form inline con taglie (S/M/L/XL) + bottoni Fragile/Genera Link
✅ `/mia_reputazione` → Risposta corretta "Non registrato come rider"

### Logging Implementato:

```
[boot] TELEGRAM_BOT_TOKEN set: true len: 46
[boot] TELEGRAM_WEBHOOK_SECRET set: true len: 46
[boot] customer-link handlers registered
[boot] All handlers registered. Creating webhookCallback...
[req] POST https://... | secret-header: present
[req] Processing update via grammY...
[handleOrdine] Command received from user: 6693621032
[handleOrdine] Querying merchant...
[handleOrdine] Merchant found: true
[handleOrdine] Merchant ID: 44b8fb32-737f-4795-8d44-6350f1c79ecd
[req] grammY returned status: 200
```

### Status Finale:

✅ Bot @dloop_saas_bot **completamente operativo**
✅ Webhook riceve correttamente tutte le richieste Telegram
✅ Secret token validato da grammY
✅ Handler registration order corretto
✅ Debug logging completo per troubleshooting futuro
✅ Codice committato e pushato su GitHub (main branch)

**Impatto**: Nessuna modifica funzionale, solo fix infrastrutturale. Flusso merchant→cliente (Sprint 2) rimane intoccato.

---

## 🚧 SPRINT 3 FASE 1 — RIDER BOT + BROADCAST FCFS

**Obiettivo**: Bot rider separato con broadcast ordini + accept/reject First-Come-First-Served

**Gate**: Primo ordine reale consegnato entro **31/7/2026**

### Scope:

#### 1. Nuovo Bot Rider (@dloop_rider_bot)
**Repo**: Stesso `creamoj-ai/dloop-telegram-bot` (handler separati)

**Registrazione rider**:
- `/start` → Verifica rider esistente o nuova registrazione
- Form onboarding:
  - Nome completo
  - Telefono (validazione IT)
  - Mezzo (bici/moto/auto/piedi)
  - Zona operativa (quartiere Napoli)
  - Conferma termini servizio
- Insert `riders` table:
  ```sql
  id, telegram_user_id, name, phone, vehicle_type,
  zone, status (active/inactive), reputation_score (default 100)
  ```

**Comandi rider**:
- `/stato` → Toggle online/offline (aggiorna `riders.status`)
- `/ordini` → Lista ordini broadcast ricevuti (pending + non scaduti)
- `/storico` → Ordini completati rider (delivered + rating)

#### 2. Sistema Broadcast FCFS (First-Come-First-Served)

**Trigger**: `broadcast_started_at IS NOT NULL AND status = 'pending'`

**Cron Job** (Supabase Edge Function invocata ogni 60s):
- Nome funzione: `escalation-tick`
- Path: `supabase/functions/escalation-tick/index.ts`

**Logica escalation**:
```typescript
// Ogni 60s, per ogni ordine attivo:
const elapsed = NOW() - broadcast_started_at;

if (elapsed > 5min && tier < 3) {
  // Escalation tier (0→1→2→3, zone sempre più ampie)
  tier++;
  notifyRidersInTier(order, tier);
}

// Notifica rider:
// - tier 0: top reputation (score >= 90), zona esatta
// - tier 1: good reputation (score >= 70), zona + adiacenti
// - tier 2: all active riders, zona + 2km
// - tier 3: emergency broadcast, tutta città
```

**Messaggio broadcast** (Telegram inline keyboard):
```
📦 Nuovo ordine disponibile!

Taglia: M (Medio)
Ritiro: Via Foria 123, Napoli
Consegna: Via Roma 456, 80100 Napoli
Pagamento: Cliente paga al rider
Fragile: 🔴 Sì

Tempo per accettare: 5 min

[ACCETTA] [RIFIUTA]
```

**Callback handlers**:
- `ACCETTA` → Claim ordine FCFS (race condition gestita con DB transaction):
  ```sql
  UPDATE orders
  SET status = 'accepted',
      rider_id = {rider_telegram_id},
      accepted_at = NOW()
  WHERE id = {order_id}
    AND status = 'pending'  -- Atomic check
  RETURNING *;
  ```
  - Se success: Notifica rider "Ordine assegnato! Vai al ritiro"
  - Se fail (già accettato da altro): "Ordine non più disponibile"
  - Notifica merchant: "Rider {nome} ha accettato l'ordine"

- `RIFIUTA` → Log rifiuto (opzionale, no penalty tier 0):
  ```sql
  INSERT INTO rider_rejections (rider_id, order_id, rejected_at);
  ```

#### 3. Flusso Pickup → Delivery

**Stato `accepted`** (rider ha accettato):
- Rider riceve:
  ```
  ✅ Ordine assegnato!

  📍 RITIRO:
  Indirizzo: Via Foria 123, Napoli
  Contatto merchant: @merchant_username

  [RITIRATO] [PROBLEMA]
  ```

**Stato `picked_up`** (rider ha ritirato):
- Click `RITIRATO` → `UPDATE orders SET status = 'picked_up', picked_up_at = NOW()`
- Rider riceve:
  ```
  📦 In consegna

  📍 DESTINAZIONE:
  Via Roma 456, 80100 Napoli
  Cliente: Mario Rossi (+39 333 1234567)

  Note: Citofono piano 3

  [CONSEGNATO]
  ```
- Notifica cliente (futuro): "Il tuo ordine è in arrivo!"

**Stato `delivered`** (consegnato):
- Click `CONSEGNATO` → Richiedi PIN:
  ```
  🔐 Inserisci il PIN del cliente per confermare la consegna:

  (Il cliente ha ricevuto un PIN a 4 cifre)
  ```
- Rider invia PIN → Verifica DB:
  ```typescript
  const order = await getOrder(orderId);
  if (pinInserito === order.delivery_pin) {
    await updateOrder(orderId, {
      status: 'delivered',
      delivered_at: NOW()
    });
    // Success: Ordine completato
  } else {
    // Error: PIN errato, riprova
  }
  ```
- Notifica merchant: "Ordine consegnato! PIN verificato."
- Notifica cliente (futuro): "Consegna completata! Lascia un feedback."

#### 4. Handlers Bot Rider

**Path**: `supabase/functions/telegram-webhook-rider/`

**Struttura**:
```
telegram-webhook-rider/
├── index.ts              # Entry point (route /telegram-webhook-rider)
├── handlers/
│   ├── start.ts          # /start + registrazione rider
│   ├── status.ts         # /stato (online/offline toggle)
│   ├── orders.ts         # /ordini (lista broadcast attivi)
│   ├── history.ts        # /storico (ordini completati)
│   ├── accept-order.ts   # Callback ACCETTA (FCFS claim)
│   ├── reject-order.ts   # Callback RIFIUTA (log)
│   ├── pickup.ts         # Callback RITIRATO (status → picked_up)
│   ├── deliver.ts        # Callback CONSEGNATO (richiesta PIN)
│   └── verify-pin.ts     # Verifica PIN + status → delivered
└── shared/
    ├── db-riders.ts      # CRUD riders table
    └── notifications.ts  # Send Telegram messages
```

#### 5. Database Schema Aggiornamenti

**Nuova tabella `riders`**:
```sql
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_user_id BIGINT UNIQUE NOT NULL,
  telegram_username TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL, -- 'bike', 'moto', 'car', 'foot'
  zone TEXT NOT NULL, -- 'Centro', 'Vomero', 'Chiaia', etc.
  status TEXT NOT NULL DEFAULT 'inactive', -- 'active', 'inactive', 'suspended'
  reputation_score INT DEFAULT 100, -- 0-100
  total_deliveries INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_online_at TIMESTAMPTZ
);

CREATE INDEX idx_riders_telegram_user_id ON riders(telegram_user_id);
CREATE INDEX idx_riders_status_zone ON riders(status, zone) WHERE status = 'active';
```

**Aggiornamento tabella `orders`**:
```sql
ALTER TABLE orders ADD COLUMN rider_id UUID REFERENCES riders(id);
ALTER TABLE orders ADD COLUMN accepted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN picked_up_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMPTZ;

CREATE INDEX idx_orders_broadcast ON orders(broadcast_started_at, status)
  WHERE broadcast_started_at IS NOT NULL AND status = 'pending';
```

**Nuova tabella `rider_rejections`** (opzionale, analytics):
```sql
CREATE TABLE rider_rejections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id UUID REFERENCES riders(id),
  order_id UUID REFERENCES orders(id),
  rejected_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 6. Supabase Edge Functions Deploy

**Nuove functions**:
1. `telegram-webhook-rider` (webhook bot rider)
   ```bash
   supabase functions deploy telegram-webhook-rider --project-ref aqpwfurradxbnqvycvkm
   ```

2. `escalation-tick` (cron broadcast)
   ```bash
   supabase functions deploy escalation-tick --project-ref aqpwfurradxbnqvycvkm
   ```

**Secrets**:
```bash
supabase secrets set TELEGRAM_RIDER_BOT_TOKEN=xxx --project-ref aqpwfurradxbnqvycvkm
```

**Webhook setup**:
```bash
curl https://api.telegram.org/bot{RIDER_BOT_TOKEN}/setWebhook \
  -d "url=https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-webhook-rider"
```

**Cron setup** (Supabase Dashboard):
- Function: `escalation-tick`
- Schedule: `*/1 * * * *` (ogni 1 minuto)
- HTTP Method: POST
- Payload: `{}`

---

## 📋 SPRINT 3 FASE 1 — TASK BREAKDOWN

### Milestone 1: Setup Bot Rider (Giorni 1-2)
- [ ] Crea bot Telegram @dloop_rider_bot (BotFather)
- [ ] Configura webhook `telegram-webhook-rider` Edge Function
- [ ] Deploy function + set secrets
- [ ] Test `/start` echo (sanity check)

### Milestone 2: Database Schema (Giorno 2)
- [ ] Migrazione: crea tabella `riders`
- [ ] Migrazione: aggiungi colonne `orders` (rider_id, accepted_at, etc.)
- [ ] Migrazione: crea tabella `rider_rejections` (opzionale)
- [ ] Verifica indici performance

### Milestone 3: Registrazione Rider (Giorni 3-4)
- [ ] Handler `/start` con verifica rider esistente
- [ ] Form onboarding (nome, telefono, veicolo, zona)
- [ ] Validazione telefono IT (riusa da customer-page)
- [ ] Insert `riders` table con status = 'inactive'
- [ ] Messaggio welcome + guida comandi

### Milestone 4: Comandi Base Rider (Giorno 4)
- [ ] Handler `/stato` → Toggle online/offline
- [ ] Update `riders.status` + `last_online_at`
- [ ] Conferma visuale stato corrente

### Milestone 5: Broadcast System (Giorni 5-7)
- [ ] Edge Function `escalation-tick` (cron ogni 60s)
- [ ] Logica tier escalation (0→1→2→3)
- [ ] Query rider per zona + reputation
- [ ] Send broadcast message con inline keyboard `[ACCETTA] [RIFIUTA]`
- [ ] Test manuale: crea ordine → verifica broadcast ricevuto

### Milestone 6: Accept/Reject FCFS (Giorni 7-8)
- [ ] Handler callback `ACCETTA`:
  - DB transaction atomica (UPDATE WHERE status = 'pending')
  - Gestione race condition (2+ rider cliccano simultaneo)
  - Notifica success/fail al rider
  - Notifica merchant "Rider {nome} accettato"
- [ ] Handler callback `RIFIUTA`:
  - Log rejection (opzionale)
  - Dismiss message

### Milestone 7: Pickup Flow (Giorno 9)
- [ ] Callback `RITIRATO`:
  - Update `status = 'picked_up'`, `picked_up_at = NOW()`
  - Mostra dettagli consegna (cliente, indirizzo, note, PIN richiesto)
- [ ] Test: ordine accepted → picked_up

### Milestone 8: Delivery + PIN Verification (Giorni 10-11)
- [ ] Callback `CONSEGNATO` → Richiedi PIN
- [ ] Handler input PIN:
  - Verifica vs `orders.delivery_pin`
  - Se match: `status = 'delivered'`, `delivered_at = NOW()`
  - Se no match: errore + riprova
- [ ] Notifiche merchant + cliente (stub per ora)
- [ ] Update `riders.total_deliveries++`

### Milestone 9: Comando /ordini (Giorno 12)
- [ ] Query ordini broadcast attivi (pending, tier corrente)
- [ ] Lista formattata con dettagli pickup/dropoff
- [ ] Inline keyboard per accept/reject da lista

### Milestone 10: Test End-to-End (Giorni 13-14)
- [ ] Ordine test completo:
  1. Merchant crea ordine → Link cliente
  2. Cliente compila form → PIN generato, broadcast attivato
  3. Rider riceve broadcast → ACCETTA
  4. Rider → RITIRATO
  5. Rider → CONSEGNATO → Inserisce PIN
  6. Status = delivered, notifiche merchant
- [ ] Test race condition (2 rider ACCETTA simultaneo)
- [ ] Test escalation tier (ordine pending 5+ min → tier 1)

### Milestone 11: Ordine Reale Pilota (Giorni 15+)
- [ ] Onboarding 2-3 rider reali (amici/beta tester)
- [ ] Merchant crea ordine reale (pacco test)
- [ ] Monitoraggio completo flow
- [ ] **GATE: Primo ordine consegnato entro 31/7** ✅

---

## 🔒 VINCOLI FISSI (SPRINT 3)

1. **Mai `select("*")` su `orders`** → Colonna `location` (POINT) rompe serializzazione
   - Sempre lista esplicita colonne

2. **Stato su DB, mai in-memory** → Edge Functions stateless
   - No `Map<userId, state>` globali
   - Sessioni/stato persistiti in Supabase

3. **Non toccare flusso merchant→cliente** → Sprint 2 è CHIUSO
   - customer-page API intoccabile
   - Frontend `/c/[token]` intoccabile
   - Broadcast trigger (`broadcast_started_at`) già implementato

4. **Atomic operations per FCFS** → Gestione race condition obbligatoria
   - `UPDATE ... WHERE status = 'pending'` + verifica affected rows
   - Transazioni DB per claim ordine

5. **Validazioni rigorose** → Riusa logica esistente
   - Telefono IT: `/^(\+39|39)?3\d{8,9}$/`
   - Nessun dato sensibile in log

---

## 📊 METRICHE SUCCESSO (GATE 31/7)

- ✅ Bot rider registra almeno 2 rider reali
- ✅ Almeno 1 ordine creato da merchant
- ✅ Broadcast ricevuto da rider in < 60s
- ✅ Ordine accettato (FCFS funzionante)
- ✅ Status pickup → delivery completato
- ✅ PIN verificato correttamente
- ✅ Status = delivered, merchant notificato
- ✅ Zero errori critici in produzione

---

## 🚀 SPRINT 3 FASE 2 (Post 31/7, Non in Scope)

- Rating sistema (cliente valuta rider, rider valuta merchant)
- Geo-tracking real-time rider (condivisione posizione)
- Notifiche push cliente (ordine in arrivo)
- WhatsApp integration (PIN via WA, non solo Telegram)
- Dashboard analytics (ordini/giorno, tempi medi, zone hot)
- Sistema pagamenti (stripe/wallet rider)
- Multi-merchant (marketplace, non single dealer)

**Focus**: Prima consegna reale entro 31/7. Resto è feature creep.

---

**Ultima modifica**: 2026-07-14 (hotfix infrastruttura bot merchant)
**Owner**: Dloop Dev Team
**Status**: Sprint 3 Fase 1 in avvio (post-hotfix, infra stabile)
