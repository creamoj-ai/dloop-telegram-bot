# FASE 1 — DEPLOY INSTRUCTIONS

## ✅ Checklist Pre-Deploy

### 1. Popola dealers table

```bash
# Vai su Supabase dashboard
https://supabase.com/dashboard/project/aqpwfurradxbnqvycvkm/sql

# Esegui SQL
cat sql/004_seed_dealers.sql | pbcopy  # macOS
# oppure copia manualmente

# Incolla in SQL Editor → Run
```

Verifica:
```sql
SELECT id, name, telegram_chat_id, status FROM dealers;
```

### 2. Ottieni telegram_chat_id per ogni merchant

Per ogni merchant in `dealers`:

```bash
# 1. Merchant fa login Telegram
# 2. Merchant invia /start a @dloop_saas_bot
# 3. Copia chat_id dai log del bot (o usa @userinfobot)
# 4. Update DB:

UPDATE dealers
SET telegram_chat_id = 123456789  -- ⚠️ sostituisci con chat_id reale
WHERE id = 'yamamay_napoli_1';
```

### 3. Deploy Edge Function

```bash
# Install Supabase CLI (se non presente)
npm install -g supabase

# Login
supabase login

# Link project
cd /path/to/dloop-telegram-bot
supabase link --project-ref aqpwfurradxbnqvycvkm

# Deploy
supabase functions deploy whatsapp-webhook

# Set secret (bot token)
supabase secrets set TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN .env | cut -d '=' -f2)

# Verifica deploy
supabase functions list
```

Output atteso:
```
┌────────────────────┬─────────┬────────────────────────────┐
│ NAME               │ VERSION │ CREATED AT                 │
├────────────────────┼─────────┼────────────────────────────┤
│ whatsapp-webhook   │ 1       │ 2026-06-16T14:30:00.000Z   │
└────────────────────┴─────────┴────────────────────────────┘
```

## 🧪 Test End-to-End

### Test 1: Verifica endpoint

```bash
curl -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/whatsapp-webhook?text=Ordina_Yamamay&phone=+393201234567"
```

Expected output:
```json
{
  "success": true,
  "dealer": "Yamamay Napoli Centro",
  "notified": true
}
```

### Test 2: Verifica notifica Telegram

Controlla:
- [ ] Merchant riceve messaggio Telegram
- [ ] Messaggio contiene "NUOVO ORDINE DA WHATSAPP"
- [ ] Contiene nome negozio + phone + testo

### Test 3: Store non trovato

```bash
curl -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/whatsapp-webhook?text=Ordina_NegozioInesistente"
```

Expected:
```json
{
  "error": "Store not found",
  "storeName": "NegozioInesistente"
}
```

### Test 4: Ambiguità (future)

```bash
# Se hai 2+ negozi con nome simile
curl -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/whatsapp-webhook?text=Ordina_Farmacia"
```

Expected:
```json
{
  "error": "Ambiguous store name",
  "matches": ["Farmacia Salute", "Farmacia Centro"]
}
```

## 📊 Monitoring

```bash
# View logs in real-time
supabase functions logs whatsapp-webhook --follow

# Check errors
supabase functions logs whatsapp-webhook | grep ERROR
```

## ⚠️ Troubleshooting

### Edge Function non risponde

```bash
# Verifica deploy
supabase functions list

# Re-deploy
supabase functions deploy whatsapp-webhook --no-verify-jwt

# Check secrets
supabase secrets list
```

### Telegram notification non arriva

```bash
# Verifica telegram_chat_id in dealers table
SELECT id, telegram_chat_id FROM dealers WHERE id = 'yamamay_napoli_1';

# Test Telegram API manualmente
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": 123456789, "text": "Test"}'
```

## ✅ Success Criteria FASE 1

- [x] Tabella dealers popolata con 3 merchant
- [x] Edge Function deployed su Supabase
- [ ] Test: wa.me link → notifica Telegram funziona
- [ ] Test: store non trovato → error 404
- [ ] Logs puliti (no errori)

## 📈 Metriche

```sql
-- Count ordini ricevuti (dopo FASE 2)
SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '24 hours';

-- Dealer più attivi
SELECT dealer_id, COUNT(*) as orders
FROM orders
GROUP BY dealer_id
ORDER BY orders DESC;
```

## Next: FASE 2 — PAGAMENTO

Una volta completata FASE 1, procedi con:
- Stripe Payment Link generation
- Webhook payment status
- Conferma ordine a cliente su WA
