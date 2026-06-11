# 🚀 DLOOP TELEGRAM BOT - Phase A Setup Guide

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Setup Steps](#setup-steps)
4. [Testing Checklist](#testing-checklist)
5. [Commands Reference](#commands-reference)
6. [Troubleshooting](#troubleshooting)

---

## ⚡ Quick Start (5 minutes)

```bash
# 1. Clone and install
git clone <repo>
cd dloop-telegram-bot
npm install

# 2. Create .env from template
cp .env.example .env

# 3. Add your secrets to .env (see Setup Steps)

# 4. Run in development
npm run dev

# 5. Test with /start in Telegram @dloop_Order_bot
```

---

## 🏗️ Architecture Overview

### Flow Diagram (POC - Yamamay)

```
┌──────────────────────────────────────┐
│  SHOSHY (Admin)                      │
│  Telegram Chat                       │
└────────────────┬─────────────────────┘
                 │
                 │ /start_order
                 │ (multi-step form)
                 ↓
┌──────────────────────────────────────┐
│  Telegram Bot Core                   │
│  • Listener (webhook/polling)        │
│  • Session state management          │
│  • Command handlers                  │
└────────────┬───────────────────┬─────┘
             │                   │
             │ Save order        │ Create payment link
             ↓                   ↓
    ┌─────────────────┐  ┌──────────────┐
    │  Supabase DB    │  │ Stripe API   │
    │  (orders table) │  │ (payment)    │
    └─────────────────┘  └──────────────┘
             │
             │ Notify dealer
             ↓
    ┌─────────────────────────────┐
    │  Dealer (Telegram User)     │
    │  • See new order            │
    │  • Click "Accetto" button   │
    └──────────┬──────────────────┘
               │
               │ Callback: accept_order
               ↓
    ┌─────────────────────────────┐
    │  SHOSHY Command Panel       │
    │  /assign_rider {order_id}   │
    │  /list_orders               │
    │  /rider_status              │
    └──────────┬──────────────────┘
               │
               │ Assign rider
               ↓
    ┌─────────────────────────────┐
    │  Firebase FCM Push          │
    │  → Rider App Notification   │
    └─────────────────────────────┘
```

### Components

| Component | Purpose | Language | Status |
|-----------|---------|----------|--------|
| `types.ts` | Type definitions | TypeScript | ✅ Done |
| `config.ts` | Env validation, constants | TypeScript | ✅ Done |
| `telegram-bot-core.ts` | Main bot logic | TypeScript | ✅ Done |
| `server.ts` | Express entry point | TypeScript | ✅ Done |
| `package.json` | Dependencies | JSON | ✅ Done |
| `tsconfig.json` | TypeScript config | JSON | ✅ Done |

---

## 🔧 Setup Steps

### Step 1: Prerequisites

```bash
# Node.js 18+
node --version  # Should be v18.0.0+

# npm 9+
npm --version   # Should be v9.0.0+
```

### Step 2: Clone and Install

```bash
git clone <your-repo>
cd dloop-telegram-bot
npm install
```

### Step 3: Create `.env` File

```bash
cp .env.example .env
```

### Step 4: Fill in Secrets

Edit `.env` and add your actual credentials:

#### Telegram

```env
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME=@dloop_Order_bot
SHOSHY_TELEGRAM_USER_ID=1234567890  # Your Telegram user ID (get from @userinfobot)
```

**How to get `SHOSHY_TELEGRAM_USER_ID`:**
1. Run the bot: `npm run dev`
2. Send `/start` to the bot
3. Check console logs for your user ID
4. Add to `.env`

#### Supabase

```env
SUPABASE_URL=https://aqpwfurradxbnqvycvkm.supabase.co
SUPABASE_ANON_KEY=sb_publishable_NBWU-byCV0TIsj5-8Mixog_CEV7IkrB
SUPABASE_PROJECT_ID=aqpwfurradxbnqvycvkm
```

#### Stripe (Test Mode)

```env
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=  # Set after webhook setup (see Step 5)
```

#### Firebase

```env
FIREBASE_PROJECT_ID=dloopriderapp
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account.json
```

**Download Firebase key:**
1. Go to [Firebase Console](https://console.firebase.google.com) → dloopriderapp
2. Settings → Service Accounts → Generate New Private Key
3. Save as `firebase-service-account.json` in project root

### Step 5: Stripe Webhook Setup

```bash
# Install Stripe CLI (if not already installed)
# macOS: brew install stripe/stripe-cli/stripe
# Linux: curl -s https://packages.stripe.dev/api/auth/gpg.key | sudo apt-key add -
# Windows: Download from https://stripe.com/docs/stripe-cli

# 1. Authenticate with Stripe
stripe login

# 2. Forward webhook events to localhost
stripe listen --forward-to localhost:3000/webhook/<TELEGRAM_BOT_TOKEN>

# 3. Copy the webhook signing secret and add to .env
# STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE_...
```

### Step 6: Optional — Webhook Deployment (Production)

For production, you'll want a public URL. Use **Render.com**:

```bash
# 1. Connect your GitHub repo to Render.com
# 2. Create new Web Service
# 3. Set environment variables (from .env)
# 4. Render auto-deploys on push
# 5. Copy public URL and update:
#    - TELEGRAM_WEBHOOK_URL in .env
#    - Register webhook with Telegram API
```

**For development, use polling mode** (no public URL needed):
```env
TELEGRAM_WEBHOOK_URL=  # Leave empty to use polling
```

### Step 7: Database Setup (Supabase)

Create these tables in Supabase:

#### `orders` Table

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  customer_address TEXT NOT NULL,
  items JSONB NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  stripe_fee_amount DECIMAL(10,2),
  total_with_fee DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'pending',
  assigned_rider_id UUID,
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_intent_id VARCHAR(255),
  stripe_payment_link TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_dealer ON orders(dealer_id);
CREATE INDEX idx_orders_rider ON orders(assigned_rider_id);
```

#### `dealers` Table

```sql
CREATE TABLE dealers (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  whatsapp_number VARCHAR(20),
  telegram_user_id VARCHAR(255),
  address TEXT NOT NULL,
  location POINT NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dealers_status ON dealers(status);
```

#### `riders` Table

```sql
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  vehicle_type VARCHAR(50),
  current_location POINT,
  status VARCHAR(50) DEFAULT 'offline',
  firebase_fcm_token TEXT,
  vat_id VARCHAR(50),
  earnings_week DECIMAL(10,2) DEFAULT 0,
  orders_completed_week INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_riders_status ON riders(status);
```

---

## 🧪 Testing Checklist

### Pre-Test Setup

```bash
# 1. Terminal 1: Run bot
npm run dev

# 2. Terminal 2: Stripe webhook listener (if testing payments)
stripe listen --forward-to localhost:3000/webhook/<TOKEN>

# 3. Terminal 3: Optional — check logs
tail -f bot.log
```

### Test Cases

#### ✅ Test 1: Basic Message

```
User: /start
Bot response: Help menu with commands
Expected: Menu displayed correctly
```

#### ✅ Test 2: Create Order (Yamamay POC)

```
User: /start_order
Bot: "Quale dealer?"
User: Yamamay_Napoli_1
Bot: "Nome cliente?"
User: Marco Rossi
Bot: "Numero telefono?"
User: +39 320 1234567
Bot: "Indirizzo?"
User: Via Roma 10, Napoli
Bot: "Nome primo articolo?"
User: Pizza Margherita
Bot: "Prezzo unitario?"
User: 8.50
Bot: "Quantità?"
User: 2
Bot: "Totale attuale: €17.00 - Nome prossimo articolo? (o /confirm)"
User: /confirm
Bot: Order summary with [✅ Conferma] [❌ Annulla] buttons
User: Click ✅ Conferma
Bot: ✅ Ordine creato! [Payment link]
Dealer: 🎉 NUOVO ORDINE notification with [✅ Accetto] [❌ Rifiuto] buttons
SHOSHY: ✅ Ordine #xyz accettato dal dealer!
```

#### ✅ Test 3: Dealer Accept Order

```
Dealer: Receives order notification
Dealer: Clicks ✅ Accetto
Bot: ✅ Ordine accettato!
SHOSHY: ✅ Ordine #xyz accettato dal dealer!
```

#### ✅ Test 4: Assign Rider (SHOSHY)

```
SHOSHY: /assign_rider {order_id} {rider_id}
Bot: ✅ Ordine assigned
Rider App: Receives FCM push notification
```

#### ✅ Test 5: List Orders

```
SHOSHY: /list_orders pending
Bot: Lists all pending orders
```

#### ✅ Test 6: Rider Status

```
SHOSHY: /rider_status
Bot: Lists all online riders with earnings
```

### Common Test Issues

| Issue | Solution |
|-------|----------|
| Bot doesn't respond | Check `TELEGRAM_BOT_TOKEN` in `.env` |
| Supabase errors | Verify tables exist and `SUPABASE_URL`/`SUPABASE_ANON_KEY` |
| Stripe payment link fails | Check `STRIPE_SECRET_KEY` (test mode) |
| Firebase FCM fails | Ensure `firebase-service-account.json` exists |
| Webhook not receiving events | Check port 3000 is open, or use polling mode |

---

## 📖 Commands Reference

### SHOSHY (Admin) Commands

| Command | Format | Example | Notes |
|---------|--------|---------|-------|
| `/start_order` | `/start_order` | `/start_order` | Multi-step order creation |
| `/list_orders` | `/list_orders [status]` | `/list_orders pending` | Status: pending, accepted, assigned, completed, cancelled |
| `/assign_rider` | `/assign_rider {order_id} {rider_id}` | `/assign_rider abc123 rider001` | Manual rider assignment |
| `/rider_status` | `/rider_status` | `/rider_status` | List all online riders |
| `/manual_dispatch` | `/manual_dispatch {order_id}` | `/manual_dispatch abc123` | Reset order to PENDING |
| `/cancel_order` | `/cancel_order {order_id}` | `/cancel_order abc123` | Cancel an order |

### Dealer Commands

| Command | Format | Example | Notes |
|---------|--------|---------|-------|
| `/start_order` | `/start_order` | `/start_order` | Create order (same flow as SHOSHY) |
| Inline buttons | Click in notification | ✅ Accetto / ❌ Rifiuto | Accept/decline order |

### Inline Buttons

| Button | Callback | Triggered When |
|--------|----------|-----------------|
| ✅ Accetto | `accept_order_{order_id}` | Dealer receives new order |
| ❌ Rifiuto | `decline_order_{order_id}` | Dealer receives new order |
| ✅ Conferma ordine | `confirm_items` | User completing order form |
| ❌ Annulla | `cancel_session` | Any multi-step command |

---

## 🐛 Troubleshooting

### Bot doesn't start

**Error:** `❌ MISSING REQUIRED ENVIRONMENT VARIABLES`

**Fix:**
```bash
# Check .env file exists
ls -la .env

# Check all required vars are set
grep -E "TELEGRAM_BOT_TOKEN|SUPABASE_URL" .env
```

### Supabase connection fails

**Error:** `Error: Failed to fetch`

**Fix:**
```bash
# Verify URL and key
curl "https://aqpwfurradxbnqvycvkm.supabase.co/rest/v1/orders?limit=1" \
  -H "apikey: <your-key>"

# If 401, regenerate anon key in Supabase dashboard
```

### Stripe webhook not firing

**Error:** Payment link created but no webhook event

**Fix:**
```bash
# 1. Check webhook is registered in Stripe dashboard
#    Developers → Webhooks → charge.succeeded

# 2. Test locally with Stripe CLI
stripe trigger charge.succeeded

# 3. Check logs
npm run dev 2>&1 | grep "webhook"
```

### Firebase FCM push fails

**Error:** `FirebaseError: Failed to initialize`

**Fix:**
```bash
# 1. Verify service account key file exists
ls -la firebase-service-account.json

# 2. Validate JSON structure
cat firebase-service-account.json | jq .

# 3. Check environment variable points to correct path
echo $FIREBASE_SERVICE_ACCOUNT_KEY_PATH
```

### Session timeout (30 min)

**Issue:** User takes too long to complete order

**Solution:** Extend timeout in `config.ts`:
```typescript
sessionTimeoutMinutes: 45, // was 30
```

---

## 📞 Support

For issues or questions:
1. Check logs: `npm run dev 2>&1 | tee bot.log`
2. Enable debug mode: `DEBUG=true npm run dev`
3. Contact SHOSHY via Telegram

---

## 🎯 Next Steps

### Week 1 (now)
- ✅ Phase A Core Bot live
- ✅ Yamamay POC with manual `/start_order`
- ✅ 5-10 test orders

### Week 2-3
- ⏳ Phase B: Supabase Edge Func webhook processor
- ⏳ Phase C: SHOSHY command panel refinements
- ⏳ Auto-assign riders via PostGIS

### Week 3-4 (if Yamamay OK)
- ⏳ WA bot listener (20h)
- ⏳ Merchant onboarding dashboard (10h)

---

**Status:** Phase A Complete ✅ | Deployment Ready 🚀
