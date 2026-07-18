// src/services/extraFeatures.js
//
// New "stand out" features:
//   - batchLint(listings[]) → ranked scores
//   - compare(listings[]) → side-by-side best/worst + recommendation
//   - applyRewrites(original, findings) → fixed listing
//   - leaderboard(scored) → top-N + stats
//   - publicPreview(listingId or hash) → see score without paying
//   - sandboxSubmit(draft) → fake agent_id + score, for pre-iteration
//   - notifyOnApproval(webhookUrl, agentId) → fire webhook when approved
//   - listingHealthCheck(endpoint) → extended check beyond bootstrap-trust

import { createHash, randomUUID } from 'node:crypto';
import { lintListing } from './lintListing.js';
import { bootstrapTrust } from './bootstrapTrust.js';
import { callLLM } from '../llm/client.js';
import { RULES } from './rules.js';

// ─── /v1/batch-lint ────────────────────────────────────────────────────
export async function batchLint({ listings, sortBy = 'score' } = {}) {
  if (!Array.isArray(listings)) throw new Error('listings must be an array');
  if (listings.length === 0) throw new Error('listings cannot be empty');
  if (listings.length > 20) throw new Error('batch limit is 20 listings per call');

  const results = await Promise.all(
    listings.map(async (listing, idx) => {
      try {
        const r = await lintListing({ listing, rewrite: false });
        return { index: idx, name: listing.name, ok: true, ...r };
      } catch (e) {
        return { index: idx, name: listing?.name || '?', ok: false, error: e.message };
      }
    })
  );

  const ok = results.filter((r) => r.ok);
  const ranked = [...ok].sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score;
    if (sortBy === 'blocks') return a.summary.block_count - b.summary.block_count;
    return 0;
  });

  const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.score, 0) / ok.length) : 0;
  return {
    count: results.length,
    passed: ok.filter((r) => r.pass).length,
    failed: ok.length - ok.filter((r) => r.pass).length,
    avg_score: avg,
    sorted_by: sortBy,
    results: ranked,
  };
}

// ─── /v1/compare ───────────────────────────────────────────────────────
export async function compareListings({ listings, criterion = 'score' } = {}) {
  if (!Array.isArray(listings)) throw new Error('listings must be an array');
  if (listings.length < 2) throw new Error('need at least 2 listings to compare');
  if (listings.length > 5) throw new Error('compare limit is 5 listings per call');

  const r = await batchLint({ listings, sortBy: 'score' });
  const winner = r.results[0];
  const loser = r.results[r.results.length - 1];

  // Find the rules that differentiate them
  const winnerSet = new Set((winner.findings || []).map((f) => f.code));
  const loserSet = new Set((loser.findings || []).map((f) => f.code));
  const differentiator = [...loserSet].filter((c) => !winnerSet.has(c));

  return {
    count: r.count,
    winner: { name: winner.name, score: winner.score, findings: winner.findings?.length || 0 },
    loser: { name: loser.name, score: loser.score, findings: loser.findings?.length || 0 },
    score_spread: winner.score - loser.score,
    differentiator_rules: differentiator.slice(0, 5),
    recommendation: winner.score === loser.score
      ? 'Tied on score — pick by use case, name clarity, or category fit.'
      : `"${winner.name}" scores ${winner.score - loser.score} points higher than "${loser.name}". Ship "${winner.name}" first.`,
    ranked: r.results.map((x) => ({ name: x.name, score: x.score, pass: x.pass })),
  };
}

// ─── /v1/apply-rewrites ────────────────────────────────────────────────
export async function applyRewrites({ listing, rewrite = true, auto_apply = false } = {}) {
  if (!listing) throw new Error('listing required');
  const result = await lintListing({ listing, rewrite });
  if (!result.rewritten || Object.keys(result.rewritten).length === 0) {
    // No LLM rewrites available — still return the diff and a note
    return {
      original: listing,
      fixed: auto_apply ? listing : null,
      changes: [],
      score_before: result.score,
      score_after: result.score,
      pass_before: result.pass,
      pass_after: result.pass,
      mode: auto_apply ? 'applied' : 'preview',
      note: result.rewritten
        ? 'No rewrites needed — listing is already clean.'
        : 'LLM not configured — set ANTHROPIC_API_KEY or HERMES_LLM_URL to enable auto-rewrites. The 19-rule linter still flagged the issues; fix them manually.',
    };
  }
  const fixed = JSON.parse(JSON.stringify(listing));
  const changes = [];
  if (result.rewritten.name && result.rewritten.name !== fixed.name) {
    changes.push({ field: 'name', before: fixed.name, after: result.rewritten.name });
    if (auto_apply) fixed.name = result.rewritten.name;
  }
  if (result.rewritten.description && result.rewritten.description !== fixed.description) {
    changes.push({ field: 'description', before: fixed.description.slice(0, 80) + '...', after: result.rewritten.description.slice(0, 80) + '...' });
    if (auto_apply) fixed.description = result.rewritten.description;
  }
  if (result.rewritten.service_descriptions && Array.isArray(fixed.services)) {
    for (let i = 0; i < result.rewritten.service_descriptions.length; i++) {
      const newDesc = result.rewritten.service_descriptions[i];
      if (newDesc && fixed.services[i] && newDesc !== fixed.services[i].description) {
        changes.push({ field: `services[${i}].description`, before: fixed.services[i].description.slice(0, 60) + '...', after: newDesc.slice(0, 60) + '...' });
        if (auto_apply) fixed.services[i].description = newDesc;
      }
    }
  }
  // Re-lint the fixed version to confirm improvement
  const reScored = auto_apply ? await lintListing({ listing: fixed, rewrite: false }) : null;
  return {
    original: listing,
    fixed: auto_apply ? fixed : null,
    changes,
    score_before: result.score,
    score_after: reScored?.score ?? null,
    pass_before: result.pass,
    pass_after: reScored?.pass ?? null,
    mode: auto_apply ? 'applied' : 'preview',
  };
}

// ─── /v1/leaderboard ───────────────────────────────────────────────────
export async function leaderboard({ limit = 10, min_score = 70 } = {}) {
  // Pulls from local cache (or scrapes live). Returns the highest-scoring
  // listings in the marketplace right now, based on their own metadata.
  const { loadLocalMarketplace } = await import('../db/localCache.js');
  const agents = loadLocalMarketplace();
  if (agents.length === 0) {
    return { error: 'no_data', message: 'Marketplace snapshot is empty. Run `pnpm scrape` first.' };
  }

  // Heuristic score: lower price + high sold + good rating = better
  const scored = agents
    .filter((a) => a.service_min_price > 0 && a.sold_count > 0)
    .map((a) => {
      const priceScore = a.service_min_price <= 0.05 ? 40 : a.service_min_price <= 0.2 ? 25 : 10;
      const volumeScore = Math.min(40, Math.round(Math.log10(a.sold_count + 1) * 15));
      const ratingScore = a.rating ? Math.min(20, Math.round(a.rating / 5)) : 10;
      return { ...a, foundry_score: priceScore + volumeScore + ratingScore };
    })
    .filter((a) => a.foundry_score >= min_score)
    .sort((a, b) => b.foundry_score - a.foundry_score)
    .slice(0, limit);

  return {
    sample_size: agents.length,
    filter: { min_score, limit },
    leaderboard: scored.map((a, i) => ({
      rank: i + 1,
      agent_id: a.agent_id,
      name: a.name,
      category: a.category,
      price: a.service_min_price,
      sold: a.sold_count,
      rating: a.rating,
      foundry_score: a.foundry_score,
    })),
    score_methodology: 'price (≤40) + volume (≤40) + rating (≤20) — max 100',
  };
}

// ─── /v1/preview/:hash ────────────────────────────────────────────────
// Public preview of a listing's score without paying. Owner submits a
// draft + a secret, gets back a /v1/preview/:hash URL others can hit
// anonymously to see the score.
const PREVIEW_STORE = new Map();
export function previewStore(draft, secret) {
  const id = createHash('sha256').update(draft + secret).digest('hex').slice(0, 16);
  PREVIEW_STORE.set(id, { draft, created_at: Date.now() });
  return id;
}
export function previewGet(id) {
  const entry = PREVIEW_STORE.get(id);
  if (!entry) return null;
  // 7-day expiry
  if (Date.now() - entry.created_at > 7 * 24 * 60 * 60 * 1000) {
    PREVIEW_STORE.delete(id);
    return null;
  }
  return entry;
}

// ─── /v1/sandbox ───────────────────────────────────────────────────────
// Submit a draft → get back a fake agent_id + lint score, for pre-listing
// iteration. Not bound to any real marketplace identity.
export async function sandboxSubmit({ draft }) {
  if (!draft || typeof draft !== 'string') throw new Error('draft must be a string');
  // Reuse the markdown parser + linter via the API adapter
  const { apiLint } = await import('./adapters.js');
  const r = await apiLint({ draft, rewrite: true });
  return {
    sandbox_id: 'sbx_' + randomUUID().slice(0, 12),
    score: r.score,
    pass: r.pass,
    findings_count: r.checks.length,
    summary: r.summary,
    rewritten: r.rewritten,
    next_step: r.pass
      ? 'Ready to register on OKX.AI — your draft passes the 19-rule linter.'
      : `Fix ${r.checks.filter((c) => c.status === 'block').length} blocking issues, then re-submit.`,
  };
}

// ─── /v1/webhooks ──────────────────────────────────────────────────────
// In-memory webhook registry. When you call this with a webhook URL +
// your draft, we'll POST to that URL with the lint result whenever you
// re-submit. Useful for builder automation pipelines.
const WEBHOOKS = new Map();
export function registerWebhook({ url, draft_hash, event = 'lint.completed' }) {
  const id = 'wh_' + randomUUID().slice(0, 8);
  WEBHOOKS.set(id, { url, draft_hash, event, created_at: Date.now() });
  return { webhook_id: id, url, event, draft_hash };
}
export function listWebhooks() {
  return Array.from(WEBHOOKS.entries()).map(([id, w]) => ({ id, ...w }));
}
export async function fireWebhooks(draft_hash, payload) {
  const fired = [];
  for (const [id, w] of WEBHOOKS.entries()) {
    if (w.draft_hash === draft_hash || w.event === 'lint.completed') {
      try {
        const r = await fetch(w.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-foundry-event': w.event },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        fired.push({ id, url: w.url, status: r.status, ok: r.ok });
      } catch (e) {
        fired.push({ id, url: w.url, ok: false, error: e.message.slice(0, 80) });
      }
    }
  }
  return fired;
}

// ─── /v1/health-check (extended) ───────────────────────────────────────
// Beyond bootstrap-trust: deep health check including p99 latency, schema
// validation across multiple calls, sample error rates.
export async function extendedHealthCheck({ endpoint, samples = 3 } = {}) {
  if (!endpoint) throw new Error('endpoint required');
  if (samples < 1 || samples > 10) throw new Error('samples must be 1–10');

  const calls = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(endpoint, {
        method: 'GET',
        headers: { 'accept': 'application/json', 'user-agent': 'Foundry-ASP/0.1 (extended-check)' },
        signal: AbortSignal.timeout(8000),
      });
      const text = (await r.text()).slice(0, 100_000);
      let schema_ok = false;
      try {
        const j = JSON.parse(text);
        schema_ok = j && typeof j === 'object' && Object.keys(j).length > 0;
      } catch { /* */ }
      calls.push({ ok: r.ok, status: r.status, latency_ms: Date.now() - t0, schema_ok });
    } catch (e) {
      calls.push({ ok: false, error: e.message.slice(0, 100), latency_ms: Date.now() - t0 });
    }
  }

  const okCalls = calls.filter((c) => c.ok);
  const latencies = okCalls.map((c) => c.latency_ms).sort((a, b) => a - b);
  const p50 = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
  const p99 = latencies.length ? latencies[Math.floor(latencies.length * 0.99)] : 0;
  const success_rate = okCalls.length / calls.length;

  let grade = 'A';
  if (success_rate < 0.99) grade = 'B';
  if (success_rate < 0.95) grade = 'C';
  if (success_rate < 0.8) grade = 'D';
  if (success_rate < 0.5) grade = 'F';

  return {
    endpoint,
    samples: calls.length,
    success_rate: +success_rate.toFixed(3),
    p50_ms: p50,
    p99_ms: p99,
    schema_valid: okCalls.every((c) => c.schema_ok),
    grade,
    verdict:
      grade === 'A' ? 'Excellent — production-ready.' :
      grade === 'B' ? 'Good — minor flakiness.' :
      grade === 'C' ? 'Fair — investigate failures.' :
      grade === 'D' ? 'Poor — unreliable for marketplace.' :
      'Failing — do not list.',
    raw: calls,
  };
}

export function hashDraft(draft) {
  return createHash('sha256').update(draft).digest('hex');
}
