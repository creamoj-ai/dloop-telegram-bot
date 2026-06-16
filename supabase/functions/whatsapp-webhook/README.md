# WhatsApp Webhook Edge Function

## Descrizione

Edge Function Supabase che riceve ordini da WhatsApp, identifica il merchant corretto e invia notifica Telegram.

## Architettura

```
WhatsApp Link: wa.me/[NUM]?text=Ordina_Yamamay
    ↓
Meta Cloud API webhook
    ↓
Edge Function: whatsapp-webhook
    ↓
Parse "Yamamay" → Query dealers table
    ↓
Telegram Bot API → Notifica merchant
```

## Deploy

### 1. Prerequisiti

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref aqpwfurradxbnqvycvkm
```

### 2. Deploy function

```bash
# Da root del repo
supabase functions deploy whatsapp-webhook
```

### 3. Set secrets

```bash
# Telegram bot token
supabase secrets set TELEGRAM_BOT_TOKEN=<your_bot_token>

# Supabase credentials (auto-injected, verifica)
supabase secrets list
```

### 4. Test

```bash
# Test locale (emulatore)
supabase functions serve whatsapp-webhook

# Test curl
curl -X POST "http://localhost:54321/functions/v1/whatsapp-webhook?text=Ordina_Yamamay&phone=+393201234567"

# Test production
curl -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/whatsapp-webhook?text=Ordina_Yamamay&phone=+393201234567"
```

## Parametri

| Param | Type | Required | Esempio |
|-------|------|----------|---------|
| `text` | string | ✅ | `Ordina_Yamamay` |
| `phone` | string | ❌ | `+393201234567` |

## Response

### Success (200)

```json
{
  "success": true,
  "dealer": "Yamamay Napoli Centro",
  "notified": true
}
```

### Error (400/404/500)

```json
{
  "error": "Store not found",
  "storeName": "XYZ"
}
```

## Parsing Rules

1. **Pattern 1**: `Ordina_NegozioX` → extract `NegozioX`
2. **Pattern 2**: `Ordine per: NegozioX` → extract `NegozioX`
3. **Fallback**: Assume entire text is store name

## Database Schema

```sql
SELECT id, name, telegram_chat_id
FROM dealers
WHERE name ILIKE '%Yamamay%'
  AND status = 'active'
LIMIT 2;
```

## Logs

```bash
# View logs
supabase functions logs whatsapp-webhook

# Follow logs
supabase functions logs whatsapp-webhook --follow
```

## Costi

- Supabase Edge Functions: **free tier 500k req/mese**
- Oltre: €2/million req
- Stima POC (50 ordini/giorno): ~€0/mese

## TODO

- [ ] Implementare fallback Haiku per ambiguità
- [ ] Aggiungere rate limiting (anti-spam)
- [ ] Webhook signature validation (Meta Cloud API)
- [ ] Retry logic su Telegram API failure
