#!/bin/bash

# ============================================================================
# DLOOP TELEGRAM BOT - AUTOMATED SETUP SCRIPT
# ============================================================================
# Usage: chmod +x setup.sh && ./setup.sh

set -e  # Exit on error

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║    🤖 DLOOP TELEGRAM BOT - SETUP WIZARD                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check Node.js
echo "📋 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js $NODE_VERSION found"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm first."
    exit 1
fi

NPM_VERSION=$(npm -v)
echo "✅ npm $NPM_VERSION found"
echo ""

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
if npm install; then
    echo "✅ Dependencies installed"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi
echo ""

# Step 2: Setup .env
echo "🔐 Setting up environment variables..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env from template"
    else
        echo "❌ .env.example not found"
        exit 1
    fi
else
    echo "⚠️  .env already exists (skipping)"
fi
echo ""

# Step 3: Check for firebase key
echo "🔑 Checking Firebase service account key..."
if [ ! -f firebase-service-account.json ]; then
    echo "⚠️  firebase-service-account.json not found"
    echo ""
    echo "To download:"
    echo "1. Go to Firebase Console → dloopriderapp → Settings"
    echo "2. Service Accounts → Generate New Private Key"
    echo "3. Save as firebase-service-account.json in this folder"
    echo ""
    read -p "Continue setup without Firebase key? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled"
        exit 1
    fi
else
    echo "✅ firebase-service-account.json found"
fi
echo ""

# Step 4: Verify .env has required values
echo "📝 Checking .env file..."
REQUIRED_VARS=(
    "TELEGRAM_BOT_TOKEN"
    "SUPABASE_URL"
    "SUPABASE_ANON_KEY"
    "STRIPE_SECRET_KEY"
    "FIREBASE_PROJECT_ID"
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" .env; then
        MISSING+=("$var")
    fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
    echo "✅ All required environment variables found in .env"
else
    echo "⚠️  Some variables might be missing or empty:"
    for var in "${MISSING[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Edit .env and fill in all values before starting the bot"
fi
echo ""

# Step 5: Build (optional)
echo "🔨 Building TypeScript..."
if npm run build 2>/dev/null; then
    echo "✅ Build successful"
else
    echo "⚠️  Build skipped (optional)"
fi
echo ""

# Step 6: Summary
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    ✅ SETUP COMPLETE                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1️⃣  Edit .env with your secrets:"
echo "   nano .env"
echo ""
echo "2️⃣  Download Firebase key (if not already done):"
echo "   • Firebase Console → dloopriderapp → Settings → Service Accounts"
echo "   • Generate New Private Key → save as firebase-service-account.json"
echo ""
echo "3️⃣  Create Supabase tables (copy SQL from docs/PHASE_A_README.md)"
echo "   • Go to Supabase Dashboard → SQL Editor"
echo "   • Run the three table creation scripts"
echo ""
echo "4️⃣  Start the bot:"
echo "   npm run dev"
echo ""
echo "5️⃣  Test in Telegram:"
echo "   • Search @dloop_Order_bot"
echo "   • Send /start"
echo "   • Try /start_order"
echo ""
echo "📖 See QUICK_START.md for detailed instructions"
echo "📞 For help: docs/PHASE_A_README.md → Troubleshooting"
echo ""
