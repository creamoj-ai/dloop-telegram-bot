# 🚀 DLOOP TELEGRAM BOT - Render.com Production Deployment

## 📋 Quick Deploy (5 minutes)

### Step 1: Create Render.com Account

1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Grant permission to your repository

### Step 2: Create Web Service

1. Click "New +" → "Web Service"
2. Connect your GitHub repo (dloop-telegram-bot)
3. Fill in settings:

| Setting | Value |
|---------|-------|
| **Name** | `dloop-telegram-bot` |
| **Environment** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | `Free` or `Starter` ($7/mo) |

### Step 3: Add Environment Variables

In Render dashboard, go to **Environment**:

```env
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME=@dloop_Order_bot
TELEGRAM_WEBHOOK_URL=https://dloop-telegram-bot.onrender.com/webhook
WEBHOOK_PORT=3000
SHOSHY_TELEGRAM_USER_ID=1234567890

SUPABASE_URL=https://aqpwfurradxbnqvycvkm.supabase.co
SUPABASE_ANON_KEY=sb_publishable_NBWU-byCV0TIsj5-8Mixog_CEV7IkrB
SUPABASE_PROJECT_ID=aqpwfurradxbnqvycvkm

STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE_...

FIREBASE_PROJECT_ID=dloopriderapp
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account.json

NODE_ENV=production
DEBUG=false
```

### Step 4: Add Firebase Service Account Key

**Option A: Via File Upload (Recommended)**

1. Create `render.yaml` in repo root:

```yaml
services:
  - type: web
    name: dloop-telegram-bot
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: FIREBASE_SERVICE_ACCOUNT_KEY_PATH
        value: /etc/firebase-key.json
```

2. Store Firebase key in Render **Secrets** (not Environment vars)
3. Reference in build script

**Option B: Inline JSON (Not Recommended)**

```env
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"dloopriderapp",...}'
```

Then modify `config.ts`:
```typescript
const keyData = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
CONFIG.firebase.serviceAccountKey = keyData;
```

### Step 5: Configure Telegram Webhook

Once deployed, register webhook with Telegram API:

```bash
curl -X POST https://api.telegram.org/botYOUR_TELEGRAM_BOT_TOKEN/setWebhook \
  -F "url=https://dloop-telegram-bot.onrender.com/webhook/YOUR_TELEGRAM_BOT_TOKEN"
```

**Verify:**
```bash
curl https://api.telegram.org/botYOUR_TELEGRAM_BOT_TOKEN/getWebhookInfo
```

Should return:
```json
{
  "ok": true,
  "result": {
    "url": "https://dloop-telegram-bot.onrender.com/webhook/...",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

### Step 6: Deploy

1. Render auto-deploys on git push
2. Or click **Deploy** in dashboard
3. Check **Logs** tab for startup messages

```
✅ Server listening on port 3000
📡 Environment: production
🤖 Bot: @dloop_Order_bot
🔗 Webhook URL: https://dloop-telegram-bot.onrender.com/webhook/...
Ready to receive orders! 🚀
```

---

## 🔒 Security Checklist

### Environment Variables

- ✅ Never commit `.env` to git
- ✅ Use Render **Secrets** for sensitive keys
- ✅ Rotate Stripe/Firebase keys monthly
- ✅ Use separate keys for dev/prod

### Network

- ✅ Telegram webhook token in URL (already secured by Telegram)
- ✅ HTTPS only (Render auto-provides SSL)
- ✅ IP whitelist in firewall (if needed)

### Database

- ✅ Supabase RLS enabled (row-level security)
- ✅ Use anon key for public operations only
- ✅ Service key stored securely (Render Secrets)

### Secrets Management

**Good:**
```
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=/etc/secrets/firebase-key.json
```

**Bad:**
```
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}' # Exposed in logs
```

---

## 📊 Monitoring

### Render Dashboard

1. **Logs** tab: Real-time logs
2. **Metrics** tab: CPU, memory, requests
3. **Deploys** tab: Deployment history

### Alerting

Set up Render alerts:
1. Settings → Alerts
2. Add email for failures
3. Monitor monthly usage

### Health Checks

```bash
# Automated (Render default)
GET https://dloop-telegram-bot.onrender.com/health
# Response: {"status":"ok","timestamp":"..."}

# Manual
curl https://dloop-telegram-bot.onrender.com/status
# Response: {"status":"running","bot":"Dloop Telegram Bot v1.0",...}
```

---

## 🆘 Troubleshooting

### Build fails

**Error:** `npm ERR! code ENOENT`

**Fix:**
```bash
# Check package.json
git status package.json

# Rebuild
git push  # Auto-rebuild on Render
```

### Webhook not receiving events

**Error:** Telegram sends orders but bot doesn't respond

**Fix:**
```bash
# 1. Check webhook URL is correct
curl https://api.telegram.org/bot.../getWebhookInfo

# 2. Check logs for errors
tail -f /var/log/render.log

# 3. Reset webhook
curl -X POST https://api.telegram.org/bot.../deleteWebhook
curl -X POST https://api.telegram.org/bot.../setWebhook?url=...
```

### Service crashes after deploy

**Error:** `Error: listen EADDRINUSE`

**Fix:**
```bash
# Check if port hardcoded
grep "3000" src/*.ts

# Should use CONFIG.telegram.webhookPort (default 3000)

# If multiple services, use unique port
# Update WEBHOOK_PORT in Render env vars
```

### Firebase initialization fails

**Error:** `FirebaseError: Failed to initialize app`

**Fix:**
```bash
# 1. Verify key file exists at FIREBASE_SERVICE_ACCOUNT_KEY_PATH
# 2. Check key JSON is valid
# 3. Add to Render Secrets, not Environment vars

# In code:
if (!fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH)) {
  console.warn("⚠️ Firebase key not found at", path);
}
```

### Memory/CPU spikes

**Error:** Service killed due to high usage

**Fix:**
```typescript
// Optimize session cleanup (in config.ts)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

// Add periodic cleanup:
setInterval(() => {
  const now = new Date();
  for (const [chatId, session] of botSessions) {
    if (new Date(session.expires_at) < now) {
      botSessions.delete(chatId);
    }
  }
}, 5 * 60 * 1000); // Every 5 min
```

---

## 📈 Cost Estimation (Monthly)

| Service | Free Tier | Cost |
|---------|-----------|------|
| **Render.com** | 750 free hours | $7 (Starter) or $25+ (Standard) |
| **Supabase** | 2M API calls | Free (under limit) |
| **Stripe** | Unlimited | 3.5% + $0.30 per transaction |
| **Firebase FCM** | 10M messages | Free (under limit) |
| **Telegram** | Unlimited | Free |
| **Total** | ~$0 (free tier) | ~$7/mo + Stripe fees |

**After launch with orders:**
- Render: $7-25/mo (depending on traffic)
- Stripe: 3.5% + $0.30 per order (pass-through to merchant)
- Others: Free under expected volume

---

## 🔄 CI/CD Pipeline

### Auto-Deploy on Push

Render auto-deploys when you push to `main`:

```bash
git add .
git commit -m "feat: Phase A core bot complete"
git push origin main
```

Render log:
```
▶️  Build started
▶️  Running build command: npm install && npm run build
▶️  npm start
✅ Server listening on port 3000
✅ Bot fully initialized!
```

### Rollback

If deploy fails:
1. Render dashboard → Deploys
2. Click previous successful deploy
3. Click "Redeploy"

---

## 📞 Support

### Render Support

- **Status Page:** [render.com/status](https://render.com/status)
- **Docs:** [render.com/docs](https://render.com/docs)
- **Email:** support@render.com

### Telegram API Support

- **Docs:** [core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- **Bot Father:** @BotFather (for bot settings)

---

## ✅ Deployment Checklist

Before going live:

- [ ] All env vars set in Render
- [ ] Firebase service account key uploaded to Secrets
- [ ] Telegram webhook URL set and verified
- [ ] Supabase tables created (orders, dealers, riders)
- [ ] Stripe test webhook registered
- [ ] Health check passing: `/health` endpoint
- [ ] Bot responds to `/start` command
- [ ] Order creation tested end-to-end
- [ ] Dealer notification working
- [ ] SHOSHY admin commands working
- [ ] Logs clean (no errors in startup)

---

**Status:** Ready for Production 🚀
