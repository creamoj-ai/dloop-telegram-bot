#!/bin/bash
# ============================================================================
# FIX TELEGRAM WEBHOOKS - Configura correttamente entrambi i bot
# ============================================================================
# ISTRUZIONI:
# 1. Recupera i token da: supabase secrets list --project-ref aqpwfurradxbnqvycvkm
# 2. Sostituisci MERCHANT_BOT_TOKEN e RIDER_BOT_TOKEN con i valori effettivi
# 3. Esegui: bash fix-webhooks.sh
# ============================================================================

# ────────────────────────────────────────────────────────────────────────────
# CONFIGURAZIONE
# ────────────────────────────────────────────────────────────────────────────

# SOSTITUISCI CON I TUOI TOKEN:
MERCHANT_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN_HERE"
RIDER_BOT_TOKEN="YOUR_TELEGRAM_RIDER_BOT_TOKEN_HERE"

# Webhook URLs (NON MODIFICARE)
MERCHANT_WEBHOOK_URL="https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-webhook"
RIDER_WEBHOOK_URL="https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-rider-webhook"

# Secret tokens (hash SHA256 già settati in Supabase)
MERCHANT_SECRET="eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457"
RIDER_SECRET="eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457"

# ────────────────────────────────────────────────────────────────────────────
# VERIFICA WEBHOOK ATTUALI
# ────────────────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════"
echo "📋 VERIFICA CONFIGURAZIONE ATTUALE"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

echo "1️⃣  MERCHANT BOT (8104434175) - @dloop_order_bot"
echo "────────────────────────────────────────────────────────────────────────"
curl -s "https://api.telegram.org/bot${MERCHANT_BOT_TOKEN}/getWebhookInfo" | \
  grep -oP '"url":"[^"]*"|"pending_update_count":\d+|"last_error_message":"[^"]*"' || echo "Errore chiamata API"
echo ""
echo ""

echo "2️⃣  RIDER BOT (8159234932) - @dloop_rider_bot"
echo "────────────────────────────────────────────────────────────────────────"
curl -s "https://api.telegram.org/bot${RIDER_BOT_TOKEN}/getWebhookInfo" | \
  grep -oP '"url":"[^"]*"|"pending_update_count":\d+|"last_error_message":"[^"]*"' || echo "Errore chiamata API"
echo ""
echo ""

# ────────────────────────────────────────────────────────────────────────────
# RESET WEBHOOK CON CONFIGURAZIONE CORRETTA
# ────────────────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════"
echo "🔧 RESET WEBHOOK"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

read -p "Vuoi procedere con il reset? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Operazione annullata"
  exit 0
fi

echo ""
echo "1️⃣  Resetto MERCHANT BOT webhook..."
curl -s -X POST "https://api.telegram.org/bot${MERCHANT_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${MERCHANT_WEBHOOK_URL}\",
    \"secret_token\": \"${MERCHANT_SECRET}\",
    \"max_connections\": 40,
    \"drop_pending_updates\": true
  }" | grep -oP '"ok":(true|false)|"description":"[^"]*"'

echo ""
echo ""

echo "2️⃣  Resetto RIDER BOT webhook..."
curl -s -X POST "https://api.telegram.org/bot${RIDER_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${RIDER_WEBHOOK_URL}\",
    \"secret_token\": \"${RIDER_SECRET}\",
    \"max_connections\": 40,
    \"drop_pending_updates\": true
  }" | grep -oP '"ok":(true|false)|"description":"[^"]*"'

echo ""
echo ""

# ────────────────────────────────────────────────────────────────────────────
# VERIFICA FINALE
# ────────────────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════"
echo "✅ VERIFICA FINALE"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

echo "1️⃣  MERCHANT BOT - Deve puntare a telegram-webhook"
curl -s "https://api.telegram.org/bot${MERCHANT_BOT_TOKEN}/getWebhookInfo" | \
  grep -oP '"url":"[^"]*"'
echo ""
echo ""

echo "2️⃣  RIDER BOT - Deve puntare a telegram-rider-webhook"
curl -s "https://api.telegram.org/bot${RIDER_BOT_TOKEN}/getWebhookInfo" | \
  grep -oP '"url":"[^"]*"'
echo ""
echo ""

echo "═══════════════════════════════════════════════════════════════════════"
echo "🎯 CONFIGURAZIONE ATTESA:"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "✅ Merchant bot → ${MERCHANT_WEBHOOK_URL}"
echo "✅ Rider bot   → ${RIDER_WEBHOOK_URL}"
echo ""
echo "TEST:"
echo "1. Invia /start a @dloop_order_bot → deve rispondere merchant bot"
echo "2. Invia /start a @dloop_rider_bot → deve rispondere rider bot"
echo ""
echo "Se ancora invertiti → verifica TOKEN in Supabase secrets match bot corretti"
echo "═══════════════════════════════════════════════════════════════════════"
