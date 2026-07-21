#!/usr/bin/env bash
# scripts/smoke-listing.sh — Pre-listing self-test for Foundry ASP
#
# Verifies every endpoint the OKX.AI marketplace reviewers will probe.
# Run:  bash scripts/smoke-listing.sh [BASE_URL]
# Default BASE_URL from PUBLIC_URL env or https://foundry-3657.onrender.com

set -euo pipefail

BASE="${1:-${PUBLIC_URL:-https://foundry-3657.onrender.com}}"
PASS=0; FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $label: $actual"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label: wanted '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  local label="$1" substring="$2" body="$3"
  if echo "$body" | grep -qF "$substring"; then
    echo "  ✅ $label: contains '$substring'"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label: missing '$substring'"
    FAIL=$((FAIL + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Foundry ASP listing smoke test"
echo "Target: $BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Health
echo ""
echo "1. Health check"
HEALTH=$(curl -sfS "$BASE/health")
check "  HTTP 200"      "0" "$?"
check "  service name"  "foundry-asp"  "$(echo "$HEALTH" | jq -r '.service')"
check "  chain"         "x-layer"      "$(echo "$HEALTH" | jq -r '.chain')"
check "  chain_id"      "196"          "$(echo "$HEALTH" | jq -r '.chain_id // empty')"
check "  bypass=false"  "false"        "$(echo "$HEALTH" | jq -r '.bypass_payment')"

# 2. Rules (free)
echo ""
echo "2. Rules endpoint (free)"
RULES_CODE=$(curl -sfS -o /dev/null -w '%{http_code}' "$BASE/v1/rules")
check "  HTTP 200" "200" "$RULES_CODE"

# 3. Instant Ship (free POST)
echo ""
echo "3. Instant Ship (free)"
SHIP=$(curl -sfS -X POST "$BASE/v1/instant-ship" \
  -H 'Content-Type: application/json' \
  -d '{"draft":"# Test ASP\n\nAn agent that helps builders.\n\n## Validate\nAnalyzes ideas."}')
SHIP_CODE=$?
check "  HTTP 2xx"       "0"  "$SHIP_CODE"
check "  has ship_id"    "true"  "$(echo "$SHIP" | jq 'has("ship_id")')"
check "  has listing"    "true"  "$(echo "$SHIP" | jq 'has("listing")')"

# 4. Verified scoreboard (free)
echo ""
echo "4. Public Scoreboard (free)"
SCOREBOARD_CODE=$(curl -sfS -o /dev/null -w '%{http_code}' "$BASE/v1/verified?limit=5")
check "  HTTP 200" "200" "$SCOREBOARD_CODE"

# 5. Competitor Radar (free)
echo ""
echo "5. Competitor Radar (free)"
COMP=$(curl -sfS "$BASE/v1/competitors?category=FINANCE&limit=3")
check "  HTTP 200"       "0"  "$?"
check "  has category"   "true"  "$(echo "$COMP" | jq 'has("category")')"
check "  has competitors" "true" "$(echo "$COMP" | jq 'has("competitors")')"

# 6. x402 paid endpoint (must return 402)
echo ""
echo "6. x402 Payment Required (paid endpoint)"
X402=$(curl -sfS -D- -X POST "$BASE/v1/validate-idea" \
  -H 'Content-Type: application/json' \
  -d '{"idea":"test"}' 2>&1) || true
X402_CODE=$(echo "$X402" | head -1 | grep -oP '\d{3}')
check "  HTTP 402" "402" "$X402_CODE"

# 7. Decode x402 challenge payload
echo ""
echo "7. x402 v2 challenge shape"
PAYLOAD=$(echo "$X402" | grep -i '^payment-required:' | sed 's/^[^:]*: *//' | tr -d '\r')
if [ -n "$PAYLOAD" ]; then
  DECODED=$(echo "$PAYLOAD" | base64 -d 2>/dev/null || true)
  check "  x402Version=2"      "2"      "$(echo "$DECODED" | jq -r '.x402Version')"
  check "  network=eip155:196" "eip155:196" "$(echo "$DECODED" | jq -r '.accepts[0].network')"
  check "  chainId=196"        "196"    "$(echo "$DECODED" | jq -r '.accepts[0].chainId')"
  check "  scheme=exact"       "exact"  "$(echo "$DECODED" | jq -r '.accepts[0].scheme')"
  check "  has payTo"          "true"   "$(echo "$DECODED" | jq '.accepts[0].payTo | startswith("0x")')"
  check "  has asset (USDT)"   "true"   "$(echo "$DECODED" | jq '.accepts[0].asset | startswith("0x")')"
else
  echo "  ❌ No PAYMENT-REQUIRED header found"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  echo "❌ CRITICAL — fix failures before listing"
  exit 1
else
  echo "✅ All checks passed — ready for listing review"
fi
