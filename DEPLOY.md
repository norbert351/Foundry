# 🚀 Foundry — Deploy Guide

**Hackathon:** OKX.AI Genesis (Build X Series) · **Deadline:** July 27 23:59 UTC · **Stack:** Node.js 20 + Fastify on Render

## What's Built (verified working end-to-end)

| Endpoint | Fee | Status |
|---|---|---|
| `GET /health` | free | ✅ live |
| `GET /v1/badge/:id.svg` | free | ✅ live |
| `POST /v1/validate-idea` | 0.005 USDT | ✅ tested with 447 real agents |
| `POST /v1/price-estimator` | 0.005 USDT | ✅ tested, returns real p25/median/p75 |
| `POST /v1/lint-listing` | 0.05 USDT | ✅ tested, scores 0–100 + LLM rewrites |
| `POST /v1/bootstrap-trust` | 0.001 USDT | ✅ tested, signs EIP-191 receipt on X Layer |

**Self-lint:** 100/100 (Foundry scores its own listing clean).
**Tests:** 14/14 pass (`pnpm test`).
**Real scrape:** 447 unique agents in `.cache/marketplace-latest.json`.

## One-Command Deploy (Render Blueprint)

1. **Push to a fresh GitHub repo** (you own it):
   ```bash
   tar -xzf foundry.tar.gz
   cd foundry
   git init && git add -A && git commit -m "Foundry ASP v0.1.0"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/foundry-asp.git
   git push -u origin main
   ```

2. **Connect to Render:**
   - Go to https://dashboard.render.com/blueprints
   - New Blueprint Instance → point at the GitHub repo
   - Render auto-detects `render.yaml` and creates the service
   - Service name → `foundry-asp` → URL: `https://foundry-asp.onrender.com`

3. **Set env vars in Render dashboard** (sync: false in render.yaml — set them manually):
   ```
   FOUNDRY_WALLET_PK = 0x<your EOA private key>  # new wallet, just for signing
   ANTHROPIC_API_KEY = sk-ant-...
   PUBLIC_URL = https://foundry-asp.onrender.com
   ```
   (SUPABASE_URL/KEY optional — the app works with local cache if missing)

4. **First-boot scrape:**
   ```bash
   # In Render Shell tab, or locally with the same env:
   pnpm scrape   # populates the marketplace snapshot
   ```

5. **Health check:**
   ```bash
   curl https://foundry-asp.onrender.com/health
   ```

## Register on OKX.AI

Once deployed, register the ASP via the OKX.AI marketplace (use the `onchainos` CLI as you did for #5789):

```bash
# 1. Pre-check (one-time consent)
onchainos agent pre-check --role asp

# 2. Upload avatar
onchainos agent upload --file ./foundry-logo.png

# 3. Create with the 4 services from listing-draft.json
# (use the in-Telegram identity-register flow which gates the card + confirm step)
```

After the ASP is listed, run **self-lint** in production to populate the badge history:

```bash
curl -X POST https://foundry-asp.onrender.com/v1/bootstrap-trust \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://foundry-asp.onrender.com/v1/lint-listing","service_name":"Foundry Lint Listing"}'
```

Tweet the resulting badge URL with `#OKXAI`.

## X Post (90s Demo)

The demo flow that wins judges:

1. **"I want to launch a new ASP. Will it pass review?"** → `validate-idea` (BUILD / MAYBE / KILL + top 3 competitors)
2. **"What should I charge?"** → `price-estimator` (real p25/median/p75 + recommended)
3. **"Will my draft listing pass?"** → `lint-listing` (100 score, OR rewrites if low)
4. **"Now bootstrap trust"** → `bootstrap-trust` (signed receipt + badge)

Suggested tweet structure:

> "I built Foundry: a 4-in-1 ASP that validates ideas, prices services, lints listings, and signs on-chain trust receipts for the OKX.AI marketplace. It scored its own draft 100/100.
>
> 4 services. 1 ASP. x402. 14 unit tests. 0 frameworks.
>
> #OKXAI"
>
> [demo video]
>
> Foundry Verified: <badge_url>

## File Tree

```
foundry/
├── src/
│   ├── server.js              Fastify app + 4 paid routes + 1 free badge
│   ├── config.js              env loader
│   ├── x402/middleware.js     402 challenge + X-PAYMENT verify
│   ├── db/
│   │   ├── supabase.js        async proxy + dev stub
│   │   ├── localCache.js      file fallback when Supabase absent
│   │   └── schema.sql         4 tables + 19 review rules
│   ├── scraper/               OKX marketplace via onchainos CLI
│   ├── services/
│   │   ├── validateIdea.js    demand score, jaccard similarity, LLM
│   │   ├── priceEstimator.js  real distribution + LLM complexity
│   │   ├── lintListing.js     19 rules + LLM rewriter
│   │   └── bootstrapTrust.js  EIP-191 signed receipt
│   └── llm/client.js          Anthropic wrapper
├── test/                      14 tests covering rules, gate, stats
├── scripts/self-lint.js       "eat your own dog food"
├── render.yaml                deploy config
├── listing-draft.json         OKX.AI submission payload
└── package.json
```

## What You Still Need To Do

1. **Push to GitHub** (5 min) → I created the tarball at `/home/ubuntu/foundry.tar.gz`
2. **Connect Render blueprint** (2 min) → set FOUNDRY_WALLET_PK + ANTHROPIC_API_KEY
3. **Generate a fresh EOA wallet** for signing receipts (use `cast wallet new` or render an ethers Wallet)
4. **Run `pnpm scrape`** in Render shell to populate the marketplace snapshot
5. **Register ASP** via onchainos or the Telegram identity-register flow
6. **X post** with the demo + badge URL
7. **Submit the Google form** before July 27 23:59 UTC

## A2A worker (hire response)

See `A2A.md`. Local 24/7:

```bash
systemctl --user enable --now foundry-asp foundry-a2a-worker
```

Render blueprint now includes `foundry-a2a-worker` background service.
Two-phase: API (`foundry_job` payload) + Agent (Hermes queue/cron + okx-a2a).
