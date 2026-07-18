// src/server.js — Foundry ASP server
//
// Endpoints:
//   GET  /health                       — health + scraper status
//   GET  /v1/badge/:id.svg             — Foundry Verified badge
//   POST /v1/validate-idea             — 0.005 USDT
//   POST /v1/price-estimator           — 0.005 USDT
//   POST /v1/lint-listing              — 0.05 USDT
//   POST /v1/bootstrap-trust           — 0.001 USDT
//
// Each paid endpoint returns 402 + PAYMENT-REQUIRED on first call.
// Pass X-PAYMENT: <base64(...)> on replay to bypass the gate.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { x402Gate } from './x402/middleware.js';
import { validateIdea } from './services/validateIdea.js';
import { priceEstimator } from './services/priceEstimator.js';
import { lintListing } from './services/lintListing.js';
import { bootstrapTrust } from './services/bootstrapTrust.js';
import { apiLint, apiValidate, apiPrice, apiTrust } from './services/adapters.js';
import { markdownToListing } from './parser/markdownToListing.js';
import { startScraperCron, scrapeOnce } from './scraper/run.js';
import { supabase } from './db/supabase.js';
import { RULES, RULE_CATEGORIES, RULE_BY_ID } from './services/rules.js';
import { getLlmStats } from './llm/client.js';
import {
  batchLint, compareListings, applyRewrites, leaderboard,
  previewStore, previewGet, sandboxSubmit,
  registerWebhook, listWebhooks, fireWebhooks,
  extendedHealthCheck, hashDraft,
} from './services/extraFeatures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let _logoCache = null;
async function getLogo() {
  if (_logoCache) return _logoCache;
  try {
    _logoCache = await readFile(join(__dirname, '..', 'assets', 'logo.png'));
    return _logoCache;
  } catch {
    return null;
  }
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
});

await app.register(cors, { origin: '*' });

// ─── Health ────────────────────────────────────────────────────────────
app.get('/health', async () => {
  let lastScrape = null;
  let listingCount = 0;
  try {
    const { data } = await supabase
      .from('latest_marketplace')
      .select('updated_at', { count: 'exact', head: true });
    listingCount = data?.length ?? 0;
    const { data: latest } = await supabase
      .from('marketplace_snapshot')
      .select('scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .single();
    lastScrape = latest?.scraped_at || null;
  } catch { /* ignore */ }
  return {
    ok: true,
    service: 'foundry-asp',
    version: '0.1.0',
    chain: 'x-layer',
    chain_id: config.xlayer.chainId,
    pay_to: config.xlayer.foundryWalletPk ? '(configured)' : '(unconfigured)',
    last_scrape: lastScrape,
    marketplace_size: listingCount,
    bypass_payment: config.bypassPayment,
    llm: {
      anthropic: !!config.llm.apiKey,
      hermes: !!process.env.HERMES_LLM_URL,
      stats: getLlmStats(),
    },
    endpoints: {
      'validate-idea': '0.005 USDT',
      'price-estimator': '0.005 USDT',
      'lint-listing': '0.05 USDT',
      'bootstrap-trust': '0.001 USDT',
      'batch-lint': '0.1 USDT',
      'compare': '0.05 USDT',
      'apply-rewrites': '0.05 USDT',
      'health-check': '0.005 USDT',
      'leaderboard': 'free',
      'rules': 'free',
      'schema': 'free',
      'sandbox': 'free',
      'preview': 'free (20/h)',
    },
  };
});

// ─── Logo (free — public asset) ────────────────────────────────────────
app.get('/logo.png', async (_req, reply) => {
  const buf = await getLogo();
  if (!buf) return reply.code(404).send({ error: 'logo_missing' });
  reply.type('image/png').send(buf);
});

// ─── OG image (X / Telegram link previews) ──────────────────────────────
app.get('/og.png', async (_req, reply) => {
  const buf = await getLogo();
  if (!buf) return reply.code(404).send({ error: 'logo_missing' });
  reply.type('image/png').send(buf);
});

// ─── Landing page (minimal, free) ──────────────────────────────────────
app.get('/', async (_req, reply) => {
  reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Foundry — Pre-flight to post-flight for OKX.AI ASPs</title>
<meta name="description" content="Validate ideas, price services, lint listings, and bootstrap trust for Agent Service Providers on X Layer."/>
<meta property="og:title" content="Foundry — Ship a listing that gets approved, priced right, and trusted."/>
<meta property="og:description" content="4 services in 1 ASP. x402. Self-lints at 100/100."/>
<meta property="og:image" content="${config.publicUrl}/og.png"/>
<link rel="icon" type="image/png" href="${config.publicUrl}/logo.png"/>
<style>
  :root { --bg:#0a0a0a; --card:#141414; --border:#1f1f1f; --text:#fff; --muted:#9ca3af; --accent:#00d4aa; --warn:#ff8a3d; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 36px; }
  header img { width: 48px; height: 48px; border-radius: 8px; }
  header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  header .sub { color: var(--muted); font-size: 13px; }
  .hero { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 28px; margin-bottom: 24px; }
  .hero h2 { margin: 0 0 6px; font-size: 28px; letter-spacing: -0.03em; }
  .hero p { color: var(--muted); margin: 0; font-size: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 28px; }
  .svc { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .svc h3 { margin: 0 0 4px; font-size: 15px; }
  .svc .fee { color: var(--accent); font-family: ui-monospace, monospace; font-size: 13px; margin-bottom: 8px; }
  .svc p { margin: 0; color: var(--muted); font-size: 13px; }
  .svc code { background: #0a0a0a; padding: 1px 5px; border-radius: 3px; color: var(--accent); font-size: 12px; }
  .demo { background: var(--card); border: 1px solid var(--accent); border-radius: 10px; padding: 20px; }
  .demo h3 { margin: 0 0 8px; font-size: 16px; color: var(--accent); }
  .demo pre { background: #0a0a0a; border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 12px; overflow-x: auto; color: #e5e5e5; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 28px; }
  footer a { color: var(--accent); text-decoration: none; }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="/logo.png" alt="Foundry"/>
    <div>
      <h1>Foundry</h1>
      <div class="sub">Pre-flight to post-flight for OKX.AI Agent Service Providers</div>
    </div>
  </header>

  <div class="hero">
    <h2>Ship a listing that gets approved, priced right, and trusted — in one call.</h2>
    <p>4 services in 1 ASP, paid via x402 on X Layer. Self-lints at 100/100.</p>
  </div>

  <div class="grid">
    <div class="svc">
      <h3>Validate Idea</h3>
      <div class="fee">0.005 USDT</div>
      <p>Demand score, competition map, build / maybe / kill verdict.</p>
      <p><code>POST /v1/validate-idea</code></p>
    </div>
    <div class="svc">
      <h3>Price Estimator</h3>
      <div class="fee">0.005 USDT</div>
      <p>Real p25 / median / p75 + recommended fee from 447 live listings.</p>
      <p><code>POST /v1/price-estimator</code></p>
    </div>
    <div class="svc">
      <h3>Lint Listing</h3>
      <div class="fee">0.05 USDT</div>
      <p>0–100 score, OKX review rules, LLM rewrites for the failing fields.</p>
      <p><code>POST /v1/lint-listing</code></p>
    </div>
    <div class="svc">
      <h3>Bootstrap Trust</h3>
      <div class="fee">0.001 USDT</div>
      <p>EIP-191 signed on-chain receipt + "Foundry Verified" badge for your X post.</p>
      <p><code>POST /v1/bootstrap-trust</code></p>
    </div>
    <div class="svc">
      <h3>Batch Lint</h3>
      <div class="fee">0.1 USDT</div>
      <p>Lint up to 20 listings in one call. Get a ranked leaderboard.</p>
      <p><code>POST /v1/batch-lint</code></p>
    </div>
    <div class="svc">
      <h3>Compare</h3>
      <div class="fee">0.05 USDT</div>
      <p>Side-by-side comparison of 2-5 listings. Differentiation report.</p>
      <p><code>POST /v1/compare</code></p>
    </div>
    <div class="svc">
      <h3>Apply Rewrites</h3>
      <div class="fee">0.05 USDT</div>
      <p>Auto-apply LLM rewrites to your listing and re-lint to confirm the fix.</p>
      <p><code>POST /v1/apply-rewrites</code></p>
    </div>
    <div class="svc">
      <h3>Health Check</h3>
      <div class="fee">0.005 USDT</div>
      <p>Deep health check: p50/p99 latency, success rate, schema validation across N samples.</p>
      <p><code>POST /v1/health-check</code></p>
    </div>
    <div class="svc" style="border-color: #00d4aa;">
      <h3>Leaderboard</h3>
      <div class="fee" style="color: #00d4aa;">FREE</div>
      <p>Top-scoring live listings on the marketplace right now.</p>
      <p><code>GET /v1/leaderboard</code></p>
    </div>
    <div class="svc" style="border-color: #00d4aa;">
      <h3>Rules</h3>
      <div class="fee" style="color: #00d4aa;">FREE</div>
      <p>The complete 19-rule book Foundry uses to score listings.</p>
      <p><code>GET /v1/rules</code></p>
    </div>
    <div class="svc" style="border-color: #00d4aa;">
      <h3>Sandbox</h3>
      <div class="fee" style="color: #00d4aa;">FREE</div>
      <p>Submit a draft, get a fake agent_id + score. Iterate before listing.</p>
      <p><code>POST /v1/sandbox</code></p>
    </div>
    <div class="svc" style="border-color: #00d4aa;">
      <h3>Preview</h3>
      <div class="fee" style="color: #00d4aa;">FREE</div>
      <p>Generate a public URL showing your draft's lint score. 20/h per IP.</p>
      <p><code>POST /v1/preview</code></p>
    </div>
  </div>

  <div class="demo">
    <h3>Try the linter (free, no payment)</h3>
    <pre>curl -X POST https://foundry-asp.onrender.com/api/lint \
  -H "Content-Type: application/json" \
  -d '{
    "draft": "# MyAgent\n\nAn AI agent that does something useful.\n\n## Service One\nDoes the thing.\n\n## Service Two\nDoes the other thing."
  }'</pre>
  </div>

  <footer>
    <a href="/health">/health</a> · <a href="/logo.png">logo</a> · <a href="https://web3.okx.com/xlayer/build-x-series">OKX.AI Genesis Hackathon</a> · x402 · chain 196
  </footer>
</div>
</body>
</html>`);
});

// ─── Foundry Verified badge (static SVG, free) ─────────────────────────
app.get('/v1/badge/:id.svg', async (req, reply) => {
  const id = String(req.params.id || '0');
  reply.type('image/svg+xml').send(`
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="44" viewBox="0 0 220 44">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0a0a"/>
      <stop offset="1" stop-color="#1f1f1f"/>
    </linearGradient>
  </defs>
  <rect width="220" height="44" rx="6" fill="url(#g)" stroke="#00d4aa" stroke-width="1"/>
  <circle cx="20" cy="22" r="8" fill="none" stroke="#00d4aa" stroke-width="2"/>
  <path d="M16 22l3 3 5-6" fill="none" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="36" y="20" font-family="ui-sans-serif,system-ui" font-size="11" fill="#fff" font-weight="600">Foundry Verified</text>
  <text x="36" y="34" font-family="ui-monospace,monospace" font-size="9" fill="#9ca3af">#${id} · x-layer</text>
</svg>`.trim());
});

// ─── 1. validate-idea ──────────────────────────────────────────────────
app.post('/v1/validate-idea', {
  preHandler: x402Gate({ amount: 0.005, description: 'Foundry: validate-idea' }),
}, async (req) => {
  const { idea, category } = req.body || {};
  return await validateIdea({ idea, category });
});

// ─── 2. price-estimator ────────────────────────────────────────────────
app.post('/v1/price-estimator', {
  preHandler: x402Gate({ amount: 0.005, description: 'Foundry: price-estimator' }),
}, async (req) => {
  const { category, idea, expected_volume_per_day } = req.body || {};
  return await priceEstimator({ category, idea, expected_volume_per_day });
});

// ─── 3. lint-listing ───────────────────────────────────────────────────
app.post('/v1/lint-listing', {
  preHandler: x402Gate({ amount: 0.05, description: 'Foundry: lint-listing' }),
}, async (req) => {
  const { listing, rewrite } = req.body || {};
  return await lintListing({ listing, rewrite: rewrite !== false });
});

// ─── 4. bootstrap-trust ────────────────────────────────────────────────
app.post('/v1/bootstrap-trust', {
  preHandler: x402Gate({ amount: 0.001, description: 'Foundry: bootstrap-trust' }),
}, async (req) => {
  const { endpoint, service_name, caller_wallet } = req.body || {};
  return await bootstrapTrust({ endpoint, service_name, caller_wallet });
});

// ─── Frontend adapter routes (/api/*) — match the Google AI Studio contract ─
//
// The React frontend (App.tsx) calls /api/lint (free) and /api/service/{validate,price,trust}
// (paid). These adapters accept the frontend's {draft: string} shape and return
// the JSON shapes the UI already expects. The paid 3 also respect x402.

app.post('/api/lint', async (req) => {
  const { draft } = req.body || {};
  return await apiLint({ draft });
});

app.post('/api/service/validate', {
  preHandler: x402Gate({ amount: 0.005, description: 'Foundry: validate-idea' }),
}, async (req) => {
  const { draft } = req.body || {};
  return await apiValidate({ draft });
});

app.post('/api/service/price', {
  preHandler: x402Gate({ amount: 0.005, description: 'Foundry: price-estimator' }),
}, async (req) => {
  const { draft } = req.body || {};
  return await apiPrice({ draft });
});

app.post('/api/service/trust', {
  preHandler: x402Gate({ amount: 0.001, description: 'Foundry: bootstrap-trust' }),
}, async (req) => {
  const { draft } = req.body || {};
  return await apiTrust({ draft });
});

// Tiny helper for the frontend to preview a parsed listing (debug aid)
app.post('/api/_parse', async (req) => {
  const { draft } = req.body || {};
  return markdownToListing(draft);
});

// ─── EXTRA: Rule transparency (free) ───────────────────────────────────
app.get('/v1/rules', async () => {
  return {
    count: RULES.length,
    categories: RULE_CATEGORIES,
    rules: RULES,
  };
});

app.get('/v1/rules/:id', async (req, reply) => {
  const rule = RULE_BY_ID[req.params.id];
  if (!rule) return reply.code(404).send({ error: 'rule_not_found' });
  return rule;
});

// ─── EXTRA: Batch lint (paid, bulk) ───────────────────────────────────
app.post('/v1/batch-lint', {
  preHandler: x402Gate({ amount: 0.1, description: 'Foundry: batch-lint (20 listings)' }),
}, async (req) => {
  const { listings, sortBy } = req.body || {};
  return await batchLint({ listings, sortBy });
});

// ─── EXTRA: Compare listings (paid) ────────────────────────────────────
app.post('/v1/compare', {
  preHandler: x402Gate({ amount: 0.05, description: 'Foundry: compare (2-5 listings)' }),
}, async (req) => {
  const { listings, criterion } = req.body || {};
  return await compareListings({ listings, criterion });
});

// ─── EXTRA: Apply rewrites (paid) ─────────────────────────────────────
app.post('/v1/apply-rewrites', {
  preHandler: x402Gate({ amount: 0.05, description: 'Foundry: apply-rewrites' }),
}, async (req) => {
  const { listing, auto_apply } = req.body || {};
  return await applyRewrites({ listing, auto_apply: !!auto_apply });
});

// ─── EXTRA: Leaderboard (free) ────────────────────────────────────────
app.get('/v1/leaderboard', async (req) => {
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
  const min_score = parseInt(req.query.min_score || '60', 10);
  return await leaderboard({ limit, min_score });
});

// ─── EXTRA: Public preview (free, 20 calls/IP/hour) ───────────────────
const previewHits = new Map();
app.post('/v1/preview', async (req) => {
  const ip = req.ip || 'unknown';
  const h = previewHits.get(ip) || { count: 0, resetAt: Date.now() + 3600_000 };
  if (Date.now() > h.resetAt) { h.count = 0; h.resetAt = Date.now() + 3600_000; }
  if (h.count >= 20) return { error: 'rate_limited', message: '20 previews per hour. Use /v1/lint-listing for unlimited.', resetAt: h.resetAt };
  h.count++;
  previewHits.set(ip, h);

  const { draft, secret } = req.body || {};
  if (!draft) return { error: 'draft_required' };
  if (!secret) return { error: 'secret_required', message: 'Pick a secret string to control who can view this preview' };
  const { listing } = markdownToListing(draft);
  const result = await lintListing({ listing, rewrite: false });
  const id = previewStore(draft, secret);
  return {
    preview_id: id,
    public_url: `${config.publicUrl}/v1/preview/${id}`,
    score: result.score,
    pass: result.pass,
    findings: result.findings.length,
    block_count: result.summary.block_count,
  };
});

app.get('/v1/preview/:id', async (req) => {
  const entry = previewGet(req.params.id);
  if (!entry) return { error: 'preview_not_found_or_expired' };
  const { listing } = markdownToListing(entry.draft);
  const result = await lintListing({ listing, rewrite: false });
  return {
    score: result.score,
    pass: result.pass,
    findings: result.findings,
    summary: result.summary,
    draft_preview: entry.draft.slice(0, 500),
  };
});

// ─── EXTRA: Sandbox (free, returns fake agent_id + score) ──────────────
app.post('/v1/sandbox', async (req) => {
  const { draft } = req.body || {};
  return await sandboxSubmit({ draft });
});

// ─── EXTRA: Webhook registry (free) ────────────────────────────────────
app.post('/v1/webhooks', async (req) => {
  const { url, draft, event } = req.body || {};
  if (!url || !draft) return { error: 'url_and_draft_required' };
  return registerWebhook({ url, draft_hash: hashDraft(draft), event });
});

app.get('/v1/webhooks', async () => ({ webhooks: listWebhooks() }));

// ─── EXTRA: Extended health check (paid) ───────────────────────────────
app.post('/v1/health-check', {
  preHandler: x402Gate({ amount: 0.005, description: 'Foundry: extended health check' }),
}, async (req) => {
  const { endpoint, samples } = req.body || {};
  return await extendedHealthCheck({ endpoint, samples });
});

// ─── EXTRA: Listing schema (free) ─────────────────────────────────────
// OpenAPI-style schema of the listing structure Foundry validates against.
app.get('/v1/schema', async () => {
  return {
    listing: {
      required: ['name', 'description', 'category', 'services'],
      fields: {
        name: { type: 'string', min: 3, max: 25, rule: 'NAME_LENGTH' },
        description: { type: 'string', min: 30, max: 500, rule: 'DESC_LENGTH' },
        category: { type: 'enum', values: RULE_CATEGORIES.concat(['FINANCE', 'LIFESTYLE', 'ART_CREATION', 'EDUCATION', 'PRODUCTIVITY', 'SOCIAL']).filter((v, i, a) => a.indexOf(v) === i), rule: 'CATEGORY_INVALID' },
        services: { type: 'array', min: 1, rule: 'SVC_NAME_LENGTH' },
      },
      service: {
        required: ['name', 'description', 'type', 'fee'],
        fields: {
          name: { type: 'string', min: 5, max: 30, rule: 'SVC_NAME_LENGTH' },
          description: { type: 'string', min: 50, max: 400, rule: 'SVC_DESC_TWO_PART' },
          type: { type: 'enum', values: ['A2MCP', 'A2A'], rule: 'SVC_TYPE_INVALID' },
          fee: { type: 'string', pattern: '^[0-9]+(\\.[0-9]{1,6})?$', rule: 'SVC_FEE_HAS_SYMBOL' },
          endpoint: { type: 'string', pattern: '^https://', rule: 'SVC_ENDPOINT_NOT_HTTPS' },
        },
      },
    },
    fee_schedule: {
      'validate-idea': '0.005 USDT',
      'price-estimator': '0.005 USDT',
      'lint-listing': '0.05 USDT',
      'bootstrap-trust': '0.001 USDT',
      'batch-lint': '0.1 USDT (up to 20 listings)',
      'compare': '0.05 USDT (2-5 listings)',
      'apply-rewrites': '0.05 USDT',
      'health-check': '0.005 USDT',
    },
  };
});

// ─── Start ─────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // Initial scrape on boot (async, non-blocking)
    scrapeOnce().catch((e) => app.log.warn({ err: e.message }, 'initial scrape failed'));
    // Cron for ongoing freshness
    startScraperCron();
    // Listen
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`Foundry ASP listening on :${config.port}`);
    app.log.info(`PUBLIC_URL: ${config.publicUrl}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
