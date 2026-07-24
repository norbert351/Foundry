# Foundry ASP

**Pre-flight to post-flight for OKX.AI Agent Service Providers.**

Ship a listing that gets approved, priced right, and trusted — in one call.

## 4 services (1 ASP)

| Service | Endpoint | Fee | What it does |
|---|---|---|---|
| `validate-idea` | `POST /v1/validate-idea` | 0.005 USDT | Demand score, competition map, build/kill verdict |
| `price-estimator` | `POST /v1/price-estimator` | 0.005 USDT | Real marketplace p25/median/p75 + recommended price |
| `lint-listing` | `POST /v1/lint-listing` | 0.05 USDT | OKX review score (0–100), flagged rejection reasons, LLM-rewritten description |
| `bootstrap-trust` | `POST /v1/bootstrap-trust` | 0.001 USDT | Signed on-chain receipt + "Foundry Verified" badge URL |

All endpoints return `402 Payment Required` on first call with x402 challenge in `PAYMENT-REQUIRED` header. After payment, replay with `X-PAYMENT` header returns the result.

## Quick test (no payment)

```bash
# Health
curl http://localhost:8080/health

# Validate idea (bypasses x402 if X_BYPASS_PAYMENT=1)
curl -X POST http://localhost:8080/v1/validate-idea \
  -H "Content-Type: application/json" \
  -d '{"idea":"African freelancer cross-border invoice agent","category":"LIFESTYLE"}'
```

## Run

```bash
pnpm install
cp .env.example .env  # fill in
pnpm scrape  # one-shot scrape to seed Supabase
pnpm dev      # server on :8080
```

## Architecture

```
foundry/
├── src/
│   ├── server.js              Fastify app, mounts 4 routes + x402 middleware
│   ├── config.js              env loader
│   ├── db/
│   │   ├── supabase.js        Supabase client
│   │   └── schema.sql         tables: marketplace_snapshot, listing_intake, lint_runs, trust_receipts
│   ├── scraper/
│   │   ├── run.js             cron + one-shot
│   │   └── okx.js             OKX marketplace scraper (public API)
│   ├── services/
│   │   ├── validateIdea.js    demand scoring
│   │   ├── priceEstimator.js  marketplace stats
│   │   ├── lintListing.js     OKX review rules + LLM rewriter
│   │   └── bootstrapTrust.js  EIP-191 signed receipt
│   ├── x402/
│   │   ├── middleware.js      402 challenge + verify
│   │   └── verify.js          payment signature verifier
│   └── llm/
│       └── client.js          Anthropic wrapper
├── test/
│   ├── validateIdea.test.js
│   ├── priceEstimator.test.js
│   ├── lintListing.test.js
│   └── x402.test.js
├── render.yaml                Render deploy config
└── package.json
```

## Listing self-test (eat your own dog food)

```bash
# Run lint-listing on Foundry's own draft listing
node scripts/self-lint.js
```

## License

MIT
# Deploy trigger

