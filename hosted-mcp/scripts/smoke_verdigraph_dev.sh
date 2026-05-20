#!/usr/bin/env bash
# scripts/smoke_verdigraph_dev.sh — post-deploy smoke test for verdigraph.dev.
set -euo pipefail
BASE="${1:-https://verdigraph.dev}"
PASS=0; FAIL=0
c_green(){ printf "\033[32m%s\033[0m" "$1"; }
c_red(){ printf "\033[31m%s\033[0m" "$1"; }
c_dim(){ printf "\033[2m%s\033[0m" "$1"; }

check() {
  local label="$1" url="$2" expected="$3" needle="${4:-}"
  local status
  status="$(curl -sS -o /tmp/smoke_body -w '%{http_code}' "$url" 2>/dev/null || echo "000")"
  local body; body="$(cat /tmp/smoke_body)"
  local ok=1
  [[ "$status" != "$expected" ]] && ok=0
  [[ -n "$needle" ]] && ! grep -q -- "$needle" <<<"$body" && ok=0
  if (( ok )); then
    PASS=$((PASS+1)); printf "%s %s %s\n" "$(c_green '✓')" "$label" "$(c_dim "[$status]")"
  else
    FAIL=$((FAIL+1)); printf "%s %s %s\n" "$(c_red '✗')" "$label" "$(c_dim "[$status, wanted $expected${needle:+, contains '$needle'}]")"
  fi
}

echo "Target: $BASE"
echo "─────────────────────────────────────────────────────────"

check "GET /"                              "$BASE/"                                       200 "brain-building"
check "GET /app (shop SPA)"                "$BASE/app"                                    200 "live MCP build"
check "GET /.well-known/mcp"               "$BASE/.well-known/mcp"                        200 'schema_version'
check "GET /.well-known/mcp/server-card"   "$BASE/.well-known/mcp/server-card.json"       200 'tools'
check "GET /llms.txt"                      "$BASE/llms.txt"                               200 "Brain-building shop"
check "GET /sitemap.xml"                   "$BASE/sitemap.xml"                            200 "<urlset"
check "GET /robots.txt"                    "$BASE/robots.txt"                             200 ""
check "GET /icon.svg"                      "$BASE/icon.svg"                               200 "<svg"
check "GET /conservation/public"           "$BASE/conservation/public"                    200 "net_revenue"

SESSION_RESP="$(curl -sS -X POST "$BASE/app/sessions")"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$SESSION_RESP" 2>/dev/null || echo "")"
PAIRING="$(jq -r '.pairing_code // empty' <<<"$SESSION_RESP" 2>/dev/null || echo "")"
if [[ -n "$SESSION_ID" ]]; then
  PASS=$((PASS+1)); printf "%s %s %s\n" "$(c_green '✓')" "POST /app/sessions" "$(c_dim "session=${SESSION_ID:0:8}… pairing=$PAIRING")"
else
  FAIL=$((FAIL+1)); printf "%s %s\n" "$(c_red '✗')" "POST /app/sessions"
fi

SAMPLE='{"agent_name":"smoke","purpose":"smoke","initial_nodes":["a","b"],"fitness_metrics":["task_success_rate"]}'
PREVIEW="$(curl -sS -X POST "$BASE/app/import" -H 'content-type: application/json' -d "{\"content\":$(printf %s "$SAMPLE" | jq -Rs .),\"format\":\"verdigraph_genome\"}")"
if [[ "$(jq -r '.ok // false' <<<"$PREVIEW")" == "true" ]]; then
  PASS=$((PASS+1)); printf "%s %s\n" "$(c_green '✓')" "POST /app/import (free preview build)"
else
  FAIL=$((FAIL+1)); printf "%s %s\n" "$(c_red '✗')" "POST /app/import"
  echo "$PREVIEW" | head -c 240; echo
fi

echo "─────────────────────────────────────────────────────────"
echo "PASS=$PASS FAIL=$FAIL"
exit $(( FAIL > 0 ? 1 : 0 ))
