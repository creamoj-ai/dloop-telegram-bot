#!/bin/bash
# Deploy customer-page function and disable JWT verification

set -e

PROJECT_REF="aqpwfurradxbnqvycvkm"
ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN}"

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Error: SUPABASE_ACCESS_TOKEN environment variable not set"
  echo "Usage: SUPABASE_ACCESS_TOKEN=your_token ./deploy-customer-page.sh"
  exit 1
fi

echo "🚀 Deploying customer-page function..."
supabase functions deploy customer-page --project-ref $PROJECT_REF

echo "🔓 Disabling JWT verification for public access..."
curl -s -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/customer-page" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_jwt": false}' | grep -o '"verify_jwt":[^,}]*'

echo "✅ Deployment complete! Test URL:"
echo "https://$PROJECT_REF.supabase.co/functions/v1/customer-page/c/{token}"
