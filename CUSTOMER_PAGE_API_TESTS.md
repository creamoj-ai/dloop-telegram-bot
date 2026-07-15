# Customer Page API - Test Results

## Implementazione completata

La function `customer-page` è ora una **API JSON pura** (no HTML).

### Modifiche principali

1. **GET /c/{token}** → Ritorna JSON con stato ordine
2. **POST /c/{token}** → Accetta JSON body, ritorna success + PIN
3. **Rimosso completamente**: tutti i render*(), Blob, HTML
4. **CORS**: Configurato per `https://dloop.it`
5. **Logic fix**: Ordine compilato rilevato da `customer_name` valorizzato

---

## Test con curl (output reali)

### Test 1: GET token valido (ordine pending, non compilato)
```bash
curl -s "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/customer-page/c/3s5ymymh"
```

**Output:**
```json
{"valid":true,"order":{"package_size":"L","package_count":3,"is_fragile":true,"pickup_address":"via Roma 10","payment_mode":"delivery_on_completion"}}
```

✅ Status: 200
✅ Nessun dato sensibile esposto (no delivery_pin, merchant_id, etc.)

---

### Test 2: GET token inesistente
```bash
curl -s "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/customer-page/c/tokenfake123"
```

**Output:**
```json
{"valid":false,"reason":"not_found"}
```

✅ Status: 200
✅ Reason corretta

---

### Test 3: POST dati validi (primo submit)
```bash
curl -s -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/customer-page/c/3s5ymymh" \
  -H "Content-Type: application/json" \
  -d '{"recipient_name":"Mario Rossi","recipient_phone":"+393331234567","delivery_address":"Via Napoli 123, 80100 Napoli (NA)","notes":"Citofono: Rossi"}'
```

**Output:**
```json
{"success":true,"pin":"2190"}
```

✅ Status: 200
✅ PIN generato e ritornato (WhatsApp stub, frontend lo mostrerà)
✅ DB aggiornato: customer_name, customer_phone, dropoff_address, delivery_pin, broadcast_tier=0, broadcast_started_at valorizzato

---

### Test 4: GET dopo POST (ordine già compilato)
```bash
curl -s "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/customer-page/c/3s5ymymh"
```

**Output:**
```json
{"valid":false,"reason":"already_sent"}
```

✅ Status: 200
✅ Previene doppio submit

---

### Test 5: POST duplicato (ordine già compilato)
```bash
curl -s -X POST "https://aqpwfurradxbnqvycvkm.supabase.co/functions/v1/customer-page/c/3s5ymymh" \
  -H "Content-Type: application/json" \
  -d '{"recipient_name":"Test","recipient_phone":"+393331234567","delivery_address":"Via Test"}'
```

**Output:**
```json
{"success":false,"error":"Ordine già inviato"}
```

✅ Status: 200
✅ Validazione corretta

---

## Verifiche DB

Ordine token `3s5ymymh` dopo POST:

- ✅ `customer_name`: "Mario Rossi"
- ✅ `customer_phone`: "+393331234567"
- ✅ `dropoff_address`: "Via Napoli 123, 80100 Napoli (NA)"
- ✅ `delivery_pin`: "2190"
- ✅ `status`: "pending" (per trigger escalation-tick)
- ✅ `broadcast_tier`: 0
- ✅ `broadcast_started_at`: NOT NULL (trigger broadcast)

---

## Logica interna mantenuta

✅ Validazione telefono IT (regex invariata)
✅ UPDATE riga orders (stessi campi)
✅ Genera delivery_pin 4 cifre
✅ Stub WhatsApp (PIN nel response, frontend lo mostrerà)
✅ Dispatch automatico via broadcast_started_at

---

## CORS Headers

```
Access-Control-Allow-Origin: https://dloop.it
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## Deploy

```bash
SUPABASE_ACCESS_TOKEN=xxx ./deploy-customer-page.sh
```

Script auto-disabilita JWT verification dopo ogni deploy.

---

## Prossimo step (task separato)

Frontend HTML su Vercel (repo dloop-gateway) che chiama questa API.
