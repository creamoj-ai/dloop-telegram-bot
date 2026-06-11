.PHONY: help install dev build start test lint format clean deploy

help:
	@echo "🤖 Dloop Telegram Bot - Available Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install          Install dependencies"
	@echo "  make env              Copy .env.example to .env"
	@echo ""
	@echo "Development:"
	@echo "  make dev              Start bot in development mode (hot reload)"
	@echo "  make build            Compile TypeScript to JavaScript"
	@echo "  make start            Run compiled bot"
	@echo ""
	@echo "Quality:"
	@echo "  make lint             Lint code with ESLint"
	@echo "  make format           Format code with Prettier"
	@echo "  make test             Run unit tests"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean            Remove build artifacts and node_modules"
	@echo "  make logs             Show bot logs"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-render    Deploy to Render.com (requires git push)"
	@echo "  make webhook-setup    Setup Stripe webhook (local testing)"
	@echo ""

install:
	npm install
	@echo "✅ Dependencies installed"

env:
	cp .env.example .env
	@echo "✅ .env created (edit with your secrets)"
	@echo "📋 See docs/PHASE_A_README.md for instructions"

dev:
	npm run dev

build:
	npm run build
	@echo "✅ Build complete → dist/"

start:
	npm start

test:
	npx ts-node tests/test-utils.ts
	@echo "✅ Tests completed"

lint:
	npm run lint

format:
	npm run format

clean:
	rm -rf dist/
	rm -rf node_modules/
	rm -rf .next/
	@echo "✅ Cleaned"

logs:
	npm run dev 2>&1 | grep -E "(✅|❌|Error|WARNING)"

# Local testing with Stripe CLI
webhook-setup:
	@echo "🔗 Setting up local Stripe webhook..."
	@echo "Run this in another terminal:"
	@echo "  stripe listen --forward-to localhost:3000/webhook/YOUR_TELEGRAM_BOT_TOKEN"
	@echo ""
	@echo "Then trigger a test event:"
	@echo "  stripe trigger charge.succeeded"

# Deployment reminder
deploy-render:
	@echo "🚀 Deploy to Render.com:"
	@echo "1. git add ."
	@echo "2. git commit -m 'chore: Phase A bot ready'"
	@echo "3. git push origin main"
	@echo ""
	@echo "Render auto-deploys on push. Check:"
	@echo "  https://dashboard.render.com"
	@echo ""
	@echo "Register webhook with Telegram:"
	@echo "  curl -X POST https://api.telegram.org/bot8831743845.../setWebhook?url=https://dloop-bot.onrender.com/webhook/..."

# Quick start
quick-start: install env
	@echo ""
	@echo "✅ Quick start complete!"
	@echo ""
	@echo "Next steps:"
	@echo "1. Edit .env with your secrets"
	@echo "2. npm run dev"
	@echo "3. Send /start to @dloop_Order_bot on Telegram"
	@echo ""
	@echo "📖 See docs/PHASE_A_README.md for full setup guide"
