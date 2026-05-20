#!/usr/bin/env bash
# scripts/wait_then_attach.sh — polls Cloudflare zone status, then deploys to bind custom domain.
set -euo pipefail
CF_TOKEN="${CF_TOKEN:?set CF_TOKEN env var to your Cloudflare API token}"
ZONE_ID="${ZONE_ID:-42f4bb74d52f51d521adfdaa353b55bc}"
WRANGLER="./node_modules/.bin/wrangler"

echo "Polling Cloudflare zone $ZONE_ID until status=active (then wrangler deploy)..."
while true; do
  STATUS=$(curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
    -H "Authorization: Bearer $CF_TOKEN" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['status'])")
  echo "$(date +%H:%M:%S)  status=$STATUS"
  if [[ "$STATUS" == "active" ]]; then break; fi
  sleep 30
done

echo
echo "Zone active. Deploying Worker with custom-domain routes..."
"$WRANGLER" deploy

echo
echo "Running smoke test against https://verdigraph.dev ..."
bash scripts/smoke_verdigraph_dev.sh "https://verdigraph.dev"
