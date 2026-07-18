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
import { config } from './config.js';
import { x402Gate } from './x402/middleware.js';
import { validateIdea } from './services/validateIdea.js';
import { priceEstimator } from './services/priceEstimator.js';
import { lintListing } from './services/lintListing.js';
import { bootstrapTrust } from './services/bootstrapTrust.js';
import { startScraperCron, scrapeOnce } from './scraper/run.js';
import { supabase } from './db/supabase.js';

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
    endpoints: {
      'validate-idea': '0.005 USDT',
      'price-estimator': '0.005 USDT',
      'lint-listing': '0.05 USDT',
      'bootstrap-trust': '0.001 USDT',
    },
  };
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
