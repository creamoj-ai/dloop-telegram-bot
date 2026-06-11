# ⚡ QUICK START - 5 Minutes to Bot Launch

## 🎯 Goal
Get the bot running locally in 5 minutes, then test with real Telegram.

---

## Step 1: Install (1 min)

```bash
cd dloop-telegram-bot-final
npm install
```

Wait for completion. You'll see:
```
added 150 packages in 42s
```

---

## Step 2: Setup Secrets (2 min)

### A. Copy env template

```bash
cp .env.example .env
```

### B. Edit .env with YOUR values

Open `.env` and add:

```env
# ✅ You already have these:
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME=@dloop_Order_bot
SUPABASE_URL=https://aqpwfurradxbnqvycvkm.supabase.co
SUPABASE_ANON_KEY=sb_publishable_NBWU-byCV0TIsj5-8Mixog_CEV7IkrB
SUPABASE_PROJECT_ID=aqpwfurradxbnqvycvkm
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
FIREBASE_PROJECT_ID=dloopriderapp

# ⚠️ You need to add these:

# SHOSHY_TELEGRAM_USER_ID — Get it:
# 1. Send /start to @userinfobot on Telegram
# 2. It replies with your ID (e.g., 123456789)
SHOSHY_TELEGRAM_USER_ID=123456789

# FIREBASE_SERVICE_ACCOUNT_KEY_PATH — Download from Firebase
# 1. Go to Firebase Console → dloopriderapp → Settings
# 2. Service Accounts → Generate New Private Key
# 3. Save as firebase-service-account.json in this folder
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account.json
```

### C. Download Firebase Key

1. Go to [Firebase Console](https://console.firebase.google.com) → dloopriderapp
2. Click **Settings** (gear icon) → **Service Accounts**
3. Click **Generate New Private Key** → Save as `firebase-service-account.json`
4. Move to project root:
   ```bash
   mv ~/Downloads/firebase-key.json ./firebase-service-account.json
   ```

5. Verify:
   ```bash
   ls firebase-service-account.json
   # Should output: firebase-service-account.json
   ```

---

## Step 3: Create Database Tables (1 min)

Open Supabase and run this SQL:

**Go to:** https://supabase.com → Dashboard → SQL Editor

**Run each script:**

### Table 1: Orders

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
```

### Table 2: Dealers

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

### Table 3: Riders

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

Each should complete with: ✅ **Success. No rows returned**

---

## Step 4: Start Bot (1 min)

```bash
npm run dev
```

You should see:

```
🚀 Initializing Dloop Telegram Bot...

📡 Using polling mode
✅ Supabase client initialized
✅ Stripe client initialized
✅ Firebase Admin SDK initialized
✅ Bot fully initialized!

✅ Server listening on port 3000
📡 Environment: development
🤖 Bot: @dloop_Order_bot

Ready to receive orders! 🚀
```

**Important:** Keep this terminal open!

---

## Step 5: Test Bot (1 min)

Open Telegram and:

1. **Search** for `@dloop_Order_bot`
2. **Send** `/start`
3. Bot should reply with help menu

**You should see:**
```
🤖 Dloop Bot v1.0

SHOSHY Commands:
/start_order - Crea nuovo ordine
/list_orders - Vedi ordini pendenti
... (more commands)

Inserisci /start_order per iniziare.
```

✅ **Bot is working!**

---

## Step 6: Create Your First Order (Optional)

Send `/start_order` and follow the prompts:

```
Bot: 📋 Creazione nuovo ordine - 🏪 Quale dealer?
You: yamamay_napoli_1

Bot: 👤 Nome cliente?
You: Marco Rossi

Bot: 📱 Numero telefono?
You: +39 320 1234567

Bot: 📍 Indirizzo?
You: Via Roma 10, Napoli

Bot: 📦 Nome primo articolo?
You: Pizza Margherita

Bot: 💰 Prezzo unitario?
You: 8.50

Bot: 📊 Quantità?
You: 2

Bot: 📦 Totale attuale: €17.00 - Nome prossimo articolo?
You: /confirm

Bot: 📋 Riepilogo Ordine ... Confermi?
You: [Click ✅ Conferma]

Bot: ✅ Ordine creato!
```

✅ **Order created and saved to Supabase!**

---

## 🎉 Success!

Your bot is now:
- ✅ Running locally
- ✅ Connected to Supabase
- ✅ Integrated with Stripe
- ✅ Ready for Yamamay POC

---

## 🚀 Next Steps

### For Yamamay POC

1. Test 5-10 orders manually
2. Share with Yamamay: "Here's the bot, try it!"
3. Collect feedback

### For Production Deployment

See **docs/RENDER_DEPLOYMENT.md** for:
- Deploy to Render.com (5 min)
- Setup Telegram webhook
- Configure environment variables

### For Troubleshooting

See **docs/PHASE_A_README.md** → Troubleshooting section

---

## 📞 Quick Commands

```bash
# Start bot
npm run dev

# Stop bot
Ctrl + C

# Run tests
npx ts-node tests/test-utils.ts

# Check logs
npm run dev 2>&1 | grep ERROR

# Format code
npm run format

# Build for production
npm run build
```

---

## ⚠️ Common Issues

### "Cannot find module 'telegram-bot-api'"

```bash
# Fix: Install dependencies
npm install
```

### ".env file not found"

```bash
# Fix: Create .env
cp .env.example .env
# Then edit with your values
```

### "Firebase not initialized"

```bash
# Check firebase-service-account.json exists
ls firebase-service-account.json

# If not, download from Firebase Console (see Step 2C)
```

### "Bot not responding to /start"

```bash
# Check TELEGRAM_BOT_TOKEN in .env is correct
grep TELEGRAM_BOT_TOKEN .env

# Restart bot
npm run dev
```

---

## 🎯 Success Criteria

✅ Bot starts without errors  
✅ `/start` command works  
✅ `/start_order` creates orders  
✅ Dealer gets Telegram notification  
✅ Dealer can click [✅ Accetto]  
✅ Order saved to Supabase  
✅ Stripe payment link generated  

**If all above work → Bot is ready! 🚀**

---

**Time Elapsed:** ~5 minutes  
**Status:** Ready for POC 🎉
