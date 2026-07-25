# ============================================================================
# FIX TELEGRAM WEBHOOKS - PowerShell Version
# ============================================================================
# ISTRUZIONI:
# 1. Recupera i token da Supabase Dashboard
# 2. Modifica le variabili sotto con i valori effettivi
# 3. Esegui: .\fix-webhooks.ps1
# ============================================================================

# ────────────────────────────────────────────────────────────────────────────
# CONFIGURAZIONE
# ────────────────────────────────────────────────────────────────────────────

# SOSTITUISCI CON I TUOI TOKEN:
$MERCHANT_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE"
$RIDER_BOT_TOKEN = "YOUR_TELEGRAM_RIDER_BOT_TOKEN_HERE"

# Webhook URLs (NON MODIFICARE)
$MERCHANT_WEBHOOK_URL = "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-webhook"
$RIDER_WEBHOOK_URL = "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/telegram-rider-webhook"

# Secret tokens (hash SHA256 già settati in Supabase)
$MERCHANT_SECRET = "eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457"
$RIDER_SECRET = "eb1f02bd6703db2255848822e7cc0fc781ce5369c3ff28a6f826f052e929b457"

# ────────────────────────────────────────────────────────────────────────────
# VERIFICA WEBHOOK ATTUALI
# ────────────────────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📋 VERIFICA CONFIGURAZIONE ATTUALE" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "1️⃣  MERCHANT BOT (8104434175) - @dloop_order_bot" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────"
$merchantInfo = Invoke-RestMethod -Uri "https://api.telegram.org/bot$MERCHANT_BOT_TOKEN/getWebhookInfo" -Method Get
Write-Host "URL: $($merchantInfo.result.url)"
Write-Host "Pending updates: $($merchantInfo.result.pending_update_count)"
if ($merchantInfo.result.last_error_message) {
    Write-Host "Last error: $($merchantInfo.result.last_error_message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "2️⃣  RIDER BOT (8159234932) - @dloop_rider_bot" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────"
$riderInfo = Invoke-RestMethod -Uri "https://api.telegram.org/bot$RIDER_BOT_TOKEN/getWebhookInfo" -Method Get
Write-Host "URL: $($riderInfo.result.url)"
Write-Host "Pending updates: $($riderInfo.result.pending_update_count)"
if ($riderInfo.result.last_error_message) {
    Write-Host "Last error: $($riderInfo.result.last_error_message)" -ForegroundColor Red
}
Write-Host ""

# ────────────────────────────────────────────────────────────────────────────
# RESET WEBHOOK CON CONFIGURAZIONE CORRETTA
# ────────────────────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🔧 RESET WEBHOOK" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "Vuoi procedere con il reset? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "❌ Operazione annullata" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "1️⃣  Resetto MERCHANT BOT webhook..." -ForegroundColor Yellow
$merchantBody = @{
    url = $MERCHANT_WEBHOOK_URL
    secret_token = $MERCHANT_SECRET
    max_connections = 40
    drop_pending_updates = $true
} | ConvertTo-Json

$merchantResult = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$MERCHANT_BOT_TOKEN/setWebhook" `
    -Method Post `
    -ContentType "application/json" `
    -Body $merchantBody

if ($merchantResult.ok) {
    Write-Host "✅ Merchant webhook configurato" -ForegroundColor Green
} else {
    Write-Host "❌ Errore: $($merchantResult.description)" -ForegroundColor Red
}
Write-Host ""

Write-Host "2️⃣  Resetto RIDER BOT webhook..." -ForegroundColor Yellow
$riderBody = @{
    url = $RIDER_WEBHOOK_URL
    secret_token = $RIDER_SECRET
    max_connections = 40
    drop_pending_updates = $true
} | ConvertTo-Json

$riderResult = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$RIDER_BOT_TOKEN/setWebhook" `
    -Method Post `
    -ContentType "application/json" `
    -Body $riderBody

if ($riderResult.ok) {
    Write-Host "✅ Rider webhook configurato" -ForegroundColor Green
} else {
    Write-Host "❌ Errore: $($riderResult.description)" -ForegroundColor Red
}
Write-Host ""

# ────────────────────────────────────────────────────────────────────────────
# VERIFICA FINALE
# ────────────────────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ VERIFICA FINALE" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "1️⃣  MERCHANT BOT - Deve puntare a telegram-webhook" -ForegroundColor Yellow
$merchantFinal = Invoke-RestMethod -Uri "https://api.telegram.org/bot$MERCHANT_BOT_TOKEN/getWebhookInfo" -Method Get
Write-Host "URL: $($merchantFinal.result.url)" -ForegroundColor $(if ($merchantFinal.result.url -eq $MERCHANT_WEBHOOK_URL) { "Green" } else { "Red" })
Write-Host ""

Write-Host "2️⃣  RIDER BOT - Deve puntare a telegram-rider-webhook" -ForegroundColor Yellow
$riderFinal = Invoke-RestMethod -Uri "https://api.telegram.org/bot$RIDER_BOT_TOKEN/getWebhookInfo" -Method Get
Write-Host "URL: $($riderFinal.result.url)" -ForegroundColor $(if ($riderFinal.result.url -eq $RIDER_WEBHOOK_URL) { "Green" } else { "Red" })
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🎯 CONFIGURAZIONE ATTESA:" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Merchant bot → $MERCHANT_WEBHOOK_URL" -ForegroundColor Green
Write-Host "✅ Rider bot   → $RIDER_WEBHOOK_URL" -ForegroundColor Green
Write-Host ""
Write-Host "TEST:" -ForegroundColor Yellow
Write-Host "1. Invia /start a @dloop_order_bot → deve rispondere merchant bot"
Write-Host "2. Invia /start a @dloop_rider_bot → deve rispondere rider bot"
Write-Host ""
Write-Host "Se ancora invertiti → verifica TOKEN in Supabase secrets match bot corretti" -ForegroundColor Red
Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
