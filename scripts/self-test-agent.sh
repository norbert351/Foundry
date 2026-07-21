#!/usr/bin/env bash
# scripts/self-test-agent.sh
#
# Run this BEFORE submitting your ASP listing to OKX.AI.
# Point it at your deployed endpoint and it validates all three reviewer checks.
#
# Usage: bash scripts/self-test-agent.sh [YOUR_ENDPOINT]
# Example: bash scripts/self-test-agent.sh https://my-asp.onrender.com/v1/my-service

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ENDPOINT="${1:-}"
if [ -z "$ENDPOINT" ]; then
  echo "Usage: bash scripts/self-test-agent.sh <YOUR_ASP_ENDPOINT>"
  echo "Example: bash scripts/self-test-agent.sh https://my-asp.onrender.com/v1/my-service"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OKX.AI ASP Listing Self-Test"
echo "Testing: $ENDPOINT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0; FAIL=0

# ── Check 1: x402 compliance ─────────────────
echo ""
echo "1. x402 compliance check"
echo "   Probing endpoint for 402 Payment Required..."
RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d '{"test":"x402-compliance"}' 2>&1) || true

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "402" ]; then
  echo -e "   ${GREEN}✅ HTTP 402 returned${NC}"
  PASS=$((PASS + 1))
else
  echo -e "   ${RED}❌ Expected 402, got $HTTP_CODE${NC}"
  FAIL=$((FAIL + 1))
fi

# Check body fields
NETWORK=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('network',''))" 2>/dev/null || echo "")
CHAIN_ID=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('chain_id',''))" 2>/dev/null || echo "")
PAY_TO=$(echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pay_to',''))" 2>/dev/null || echo "")

if [ "$NETWORK" = "eip155:196" ]; then
  echo -e "   ${GREEN}✅ network = eip155:196${NC}"
  PASS=$((PASS + 1))
else
  echo -e "   ${RED}❌ network should be eip155:196, got '$NETWORK'${NC}"
  FAIL=$((FAIL + 1))
fi

if [ "$CHAIN_ID" = "196" ]; then
  echo -e "   ${GREEN}✅ chain_id = 196${NC}"
  PASS=$((PASS + 1))
else
  echo -e "   ${RED}❌ chain_id should be 196, got '$CHAIN_ID'${NC}"
  FAIL=$((FAIL + 1))
fi

if echo "$PAY_TO" | grep -qE '^0x[0-9a-fA-F]{40}$'; then
  echo -e "   ${GREEN}✅ pay_to is valid EVM address${NC}"
  PASS=$((PASS + 1))
else
  echo -e "   ${RED}❌ pay_to is missing or invalid: '$PAY_TO'${NC}"
  FAIL=$((FAIL + 1))
fi

# ── Check 2: Endpoint reachability ────────────
echo ""
echo "2. Endpoint reachability check"
REACH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$ENDPOINT" 2>&1) || REACH_CODE="0"

if [ "$REACH_CODE" != "0" ]; then
  echo -e "   ${GREEN}✅ Endpoint reachable (HTTP $REACH_CODE)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "   ${RED}❌ Endpoint unreachable — deploy it first${NC}"
  FAIL=$((FAIL + 1))
fi

# ── Check 3: Self-test via Foundry (optional) ──
echo ""
echo "3. Foundry readiness report"
echo "   (Run this separately if Foundry is deployed)"
echo "   curl -X POST https://foundry-3657.onrender.com/v1/listing-readiness \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"endpoint\":\"$ENDPOINT\"}'"

# ── Summary ────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "RESULTS: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Fix the failures above, then re-run this script."
  echo "Tips:"
  echo "  - Make sure X_BYPASS_PAYMENT is not set to 1"
  echo "  - Use network: eip155:196 (CAIP-2 for X Layer)"
  echo "  - Deploy to a public HTTPS URL (Render, Railway, Fly.io, Vercel)"
  exit 1
else
  echo ""
  echo -e "${GREEN}Ready to list! Submit your ASP on OKX.AI.${NC}"
  echo "Also run the Foundry full preflight:"
  echo "  bash scripts/smoke-listing.sh"
fi
