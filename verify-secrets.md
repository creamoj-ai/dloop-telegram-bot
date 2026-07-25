# 🔐 VERIFICA SECRETS SUPABASE

## Problema Identificato

Dai log vediamo due errori:

### 1. rider-webhook (custom secret check)
```
[rider-webhook] Secret mismatch - header: eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457 expected: set
```

### 2. telegram-webhook (grammY built-in check)
```
status: 401,
statusText: "secret token is wrong"
```

## Root Cause

Il problema è **doppio**:

1. **Webhook URL probabilmente scambiati** → START su rider bot attiva merchant bot
2. **Secret tokens non sincronizzati** → 401 Unauthorized

## Soluzione Step-by-Step

### STEP 1: Verifica Secrets Supabase

Esegui in Supabase Dashboard → Project Settings → Edge Functions → Secrets:

```bash
TELEGRAM_WEBHOOK_SECRET=eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457
TELEGRAM_RIDER_WEBHOOK_SECRET=eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457
```

⚠️ **IMPORTANTE:** I valori DEVONO essere **esattamente** questi hash SHA256.

### STEP 2: Verifica Bot Tokens

I token devono corrispondere ai bot corretti:

```bash
TELEGRAM_BOT_TOKEN → bot merchant (@dloop_order_bot, ID: 8104434175)
TELEGRAM_RIDER_BOT_TOKEN → bot rider (@dloop_rider_bot, ID: 8159234932)
```

**Come verificare quale token è di quale bot:**

```bash
# Test merchant bot token
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getMe" | grep username

# Deve rispondere: "username":"dloop_order_bot"

# Test rider bot token
curl -s "https://api.telegram.org/bot<TELEGRAM_RIDER_BOT_TOKEN>/getMe" | grep username

# Deve rispondere: "username":"dloop_rider_bot"
```

### STEP 3: Reset Webhook (usa fix-webhooks.sh)

1. Apri `fix-webhooks.sh`
2. Sostituisci i placeholder con i token effettivi
3. Esegui:
   ```bash
   bash fix-webhooks.sh
   ```

### STEP 4: Test

```bash
# 1. Test merchant bot
# Invia /start a @dloop_order_bot su Telegram
# Deve rispondere con menu merchant

# 2. Test rider bot
# Invia /start a @dloop_rider_bot su Telegram
# Deve rispondere con registrazione rider

# 3. Verifica logs
supabase functions logs telegram-webhook --project-ref aqpwfurradxbnqvycvkm
supabase functions logs telegram-rider-webhook --project-ref aqpwfurradxbnqvycvkm
```

## Debugging Avanzato

Se dopo STEP 3 persiste il 401, il problema è che **i secret configurati nei webhook Telegram non matchano i secret in Supabase**.

### Opzione A: Rigenera secret e riconfigura

```bash
# 1. Genera nuovo secret random
openssl rand -hex 32

# 2. Setta in Supabase secrets:
TELEGRAM_WEBHOOK_SECRET=<nuovo_secret>
TELEGRAM_RIDER_WEBHOOK_SECRET=<nuovo_secret>

# 3. Rideploya functions:
supabase functions deploy telegram-webhook --project-ref aqpwfurradxbnqvycvkm --no-verify-jwt
supabase functions deploy telegram-rider-webhook --project-ref aqpwfurradxbnqvycvkm --no-verify-jwt

# 4. Riconfigura webhook con fix-webhooks.sh (usando nuovo secret)
```

### Opzione B: Disabilita temporaneamente secret check

Solo per DEBUG, NON per produzione:

**telegram-webhook/index.ts** (riga 48):
```typescript
const handleUpdate = webhookCallback(bot, "std/http");
// Rimuovi: { secretToken: CONFIG.telegram.webhookSecret }
```

**telegram-rider-webhook/index.ts** (righe 307-313):
```typescript
// Commenta il blocco:
// if (secretHeader !== expectedSecret) {
//   console.log("[rider-webhook] Secret mismatch...");
//   return new Response("Unauthorized", { status: 401 });
// }
```

Rideploya e testa. Se funziona → problema è nei secret values.

## Checklist Finale

- [ ] Secret Supabase settati a valori hash corretti
- [ ] Bot tokens verificati (getMe API)
- [ ] Webhook resettati con fix-webhooks.sh
- [ ] Test /start su entrambi i bot
- [ ] Logs non mostrano più 401
- [ ] Merchant bot risponde solo a @dloop_order_bot
- [ ] Rider bot risponde solo a @dloop_rider_bot
