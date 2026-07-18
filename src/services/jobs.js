// src/services/jobs.js
//
// "Hireable" features — services designed for the OKX.AI Task Marketplace.
// Other agents and users hire Foundry via onchainos create-task + set-asp
// (or directly via x402). Each job is a multi-step, value-add workflow
// that the marketplace-style x402 endpoints don't naturally support.

import { createHash, randomUUID } from 'node:crypto';
import { lintListing } from './lintListing.js';
import { bootstrapTrust } from './bootstrapTrust.js';
import { validateIdea } from './validateIdea.js';
import { priceEstimator } from './priceEstimator.js';
import { compareListings, batchLint, hashDraft } from './extraFeatures.js';
import { loadLocalMarketplace } from '../db/localCache.js';
import { callLLM } from '../llm/client.js';

// ─── 1. /v1/jobs/list-draft-as-job ──────────────────────────────────────
// One-shot "launch my new ASP" pipeline:
//   1. parse markdown
//   2. lint → fix issues
//   3. price → recommend
//   4. validate-idea → market fit
//   5. sign trust receipt (if endpoint declared)
//   6. return: ready-to-submit listing JSON + report
//
// Usage: hireable as a Task Marketplace "Launch my new ASP" job.
export async function jobListDraft({ draft, signing_wallet }) {
  if (!draft) throw new Error('draft required');
  const t0 = Date.now();

  // 1. Parse
  const { listing, markdown } = await import('../parser/markdownToListing.js')
    .then(m => m.markdownToListing(draft));

  // 2. Lint (with rewrites)
  const lint = await lintListing({ listing, rewrite: true });
  const finalListing = JSON.parse(JSON.stringify(listing));
  if (lint.rewritten) {
    if (lint.rewritten.name) finalListing.name = lint.rewritten.name;
    if (lint.rewritten.description) finalListing.description = lint.rewritten.description;
    if (lint.rewritten.service_descriptions && Array.isArray(finalListing.services)) {
      for (let i = 0; i < lint.rewritten.service_descriptions.length; i++) {
        const d = lint.rewritten.service_descriptions[i];
        if (d && finalListing.services[i]) finalListing.services[i].description = d;
      }
    }
  }

  // 3. Price
  const price = await priceEstimator({
    category: finalListing.category,
    idea: finalListing.description,
    expected_volume_per_day: 50,
  });

  // 4. Validate
  const validation = await validateIdea({
    idea: finalListing.description,
    category: finalListing.category,
  });

  // 5. Trust receipt (if endpoint declared)
  let trust = null;
  const primary = finalListing.services?.[0]?.endpoint;
  if (primary && /^https:\/\//.test(primary) && !primary.includes('example.com')) {
    try {
      trust = await bootstrapTrust({ endpoint: primary, service_name: finalListing.services[0].name, caller_wallet: signing_wallet || 'foundry-job' });
    } catch (e) {
      trust = { error: e.message };
    }
  }

  // 6. Compose ready-to-submit payload
  const jobId = 'job_' + randomUUID().slice(0, 12);
  return {
    job_id: jobId,
    job_type: 'list-draft-as-job',
    duration_ms: Date.now() - t0,
    listing: finalListing,        // ready for onchainos agent create
    report: {
      lint_score: lint.score,
      lint_pass: lint.pass,
      findings_count: lint.findings.length,
      recommended_fee_usdt: price.recommended_fee,
      market_median_usdt: price.distribution?.median,
      market_validation: validation.verdict,
      demand_score: validation.demand_score,
      trust_verdict: trust?.foundry_verdict || 'not_checked',
      trust_signature: trust?.signature || null,
    },
    submit_instructions: [
      'onchainos agent pre-check --role asp',
      'onchainos agent upload --file ./logo.png',
      'onchainos agent create --role asp --name "..." --description "..." --picture <cdn-url>',
      'then add services via the in-Telegram identity-register flow',
    ],
    next_step: lint.pass
      ? 'Ready to submit. Follow the submit_instructions above.'
      : `Fix ${lint.findings.filter(f => f.severity === 'block').length} blocking issues, then re-run.`,
  };
}

// ─── 2. /v1/jobs/audit ──────────────────────────────────────────────────
// Recurring audit: "score me now + monitor for changes"
// Returns: current score + a comparison to the previous run (stored in-memory).
const AUDIT_HISTORY = new Map();
export async function jobAudit({ agent_id, draft, listing }) {
  if (!agent_id) throw new Error('agent_id required');
  if (!draft && !listing) throw new Error('draft or listing required');

  // Lint
  let parsed = listing;
  if (!parsed && draft) {
    const { markdownToListing } = await import('../parser/markdownToListing.js');
    parsed = markdownToListing(draft).listing;
  }
  const current = await lintListing({ listing: parsed, rewrite: false });

  // Compare to history
  const prev = AUDIT_HISTORY.get(agent_id);
  let trend = 'first_run';
  let delta = 0;
  if (prev) {
    delta = current.score - prev.score;
    if (delta > 0) trend = `improved_by_${delta}`;
    else if (delta < 0) trend = `regressed_by_${Math.abs(delta)}`;
    else trend = 'unchanged';
  }
  AUDIT_HISTORY.set(agent_id, { score: current.score, at: new Date().toISOString() });

  return {
    job_type: 'audit',
    agent_id,
    current_score: current.score,
    pass: current.pass,
    trend,
    delta,
    previous_score: prev?.score ?? null,
    checked_at: new Date().toISOString(),
    findings: current.findings,
    summary: current.summary,
    recommendations: current.findings
      .filter(f => f.severity === 'block')
      .slice(0, 3)
      .map(f => `${f.field}: ${f.fix}`),
    next_audit_due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ─── 3. /v1/jobs/marketplace-watch ─────────────────────────────────────
// Track your competitors' pricing + sales over time.
// Returns: snapshots of your tracked competitors + alerts on changes.
const WATCH_LIST = new Map();  // owner_id -> [agent_ids]
const WATCH_HISTORY = new Map();  // agent_id -> [{price, sold, at}]

export async function jobMarketplaceWatch({ owner_id, agent_ids }) {
  if (!owner_id) throw new Error('owner_id required');
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    throw new Error('agent_ids must be a non-empty array');
  }
  if (agent_ids.length > 20) throw new Error('max 20 competitors per watch');

  const market = loadLocalMarketplace();
  const now = new Date().toISOString();
  const alerts = [];
  const snapshots = [];

  for (const id of agent_ids) {
    const agent = market.find(a => String(a.agent_id) === String(id));
    if (!agent) {
      snapshots.push({ agent_id: id, found: false });
      continue;
    }
    const history = WATCH_HISTORY.get(String(id)) || [];
    const prev = history[history.length - 1];
    const snapshot = {
      agent_id: id,
      name: agent.name,
      price: agent.service_min_price,
      sold: agent.sold_count,
      rating: agent.rating,
      category: agent.category,
      at: now,
    };
    snapshots.push(snapshot);

    // Diff vs last
    if (prev) {
      if (prev.price !== agent.service_min_price) {
        alerts.push({ agent_id: id, type: 'price_change', from: prev.price, to: agent.service_min_price, at: now });
      }
      if (prev.sold !== agent.sold_count && (agent.sold_count - prev.sold) > 50) {
        alerts.push({ agent_id: id, type: 'volume_spike', delta: agent.sold_count - prev.sold, at: now });
      }
    }

    history.push({ price: agent.service_min_price, sold: agent.sold_count, at: now });
    if (history.length > 100) history.shift();
    WATCH_HISTORY.set(String(id), history);
  }

  WATCH_LIST.set(owner_id, agent_ids);

  return {
    job_type: 'marketplace-watch',
    owner_id,
    tracked: agent_ids.length,
    found: snapshots.filter(s => s.found !== false).length,
    snapshots,
    alerts,
    next_poll: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export function listWatches() {
  return Array.from(WATCH_LIST.entries()).map(([k, v]) => ({ owner_id: k, tracking: v }));
}

// ─── 4. /v1/jobs/portfolio-review ───────────────────────────────────────
// "Here's my N listings across my portfolio. Rank them. Tell me which to kill."
export async function jobPortfolioReview({ listings, agent_ids }) {
  let input = [];
  if (Array.isArray(listings) && listings.length > 0) {
    input = listings;
  } else if (Array.isArray(agent_ids) && agent_ids.length > 0) {
    const market = loadLocalMarketplace();
    for (const id of agent_ids) {
      const a = market.find(m => String(m.agent_id) === String(id));
      if (a) {
        input.push({
          name: a.name,
          description: a.description || '',
          category: a.category || 'SOFTWARE_SERVICES',
          services: [{
            name: a.name,
            description: '① Existing service.\n② User must provide: 1. input',
            type: 'A2MCP',
            fee: String(a.service_min_price || '0.01'),
            endpoint: 'https://example.com/v1',
          }],
        });
      }
    }
  }
  if (input.length === 0) throw new Error('listings or agent_ids required');
  if (input.length > 20) throw new Error('max 20 listings per portfolio review');

  const batch = await batchLint({ listings: input, sortBy: 'score' });

  // Categorize
  const kills = batch.results.filter(r => r.score < 60);
  const keep = batch.results.filter(r => r.score >= 85);
  const improve = batch.results.filter(r => r.score >= 60 && r.score < 85);

  return {
    job_type: 'portfolio-review',
    reviewed: input.length,
    summary: {
      kill_count: kills.length,
      improve_count: improve.length,
      keep_count: keep.length,
      portfolio_score: batch.avg_score,
    },
    recommendation:
      kills.length > 0
        ? `Kill or rebuild: ${kills.map(k => k.name).slice(0, 3).join(', ')}.`
        : improve.length > 0
        ? `Improve: ${improve.map(k => k.name).slice(0, 3).join(', ')}.`
        : 'Portfolio is healthy. Focus on growth, not fixes.',
    ranked: batch.results.map(r => ({ name: r.name, score: r.score, action: r.score < 60 ? 'kill' : r.score < 85 ? 'improve' : 'keep' })),
  };
}

// ─── 5. /v1/jobs/onboard ───────────────────────────────────────────────
// "I'm new to OKX.AI. Help me not get rejected on my first listing."
// Analyzes the draft + simulates the OKX review process + gives a confidence
// score + step-by-step "do this before you submit" guide.
export async function jobOnboard({ draft }) {
  if (!draft) throw new Error('draft required');

  const { markdownToListing } = await import('../parser/markdownToListing.js');
  const { listing } = markdownToListing(draft);
  const lint = await lintListing({ listing, rewrite: false });

  // Simulate the 3 review stages OKX runs
  const stages = {
    identity: { passed: true, issues: [] },
    service: { passed: true, issues: [] },
    category: { passed: true, issues: [] },
  };
  for (const f of lint.findings) {
    if (f.severity !== 'block') continue;
    if (['NAME_EMPTY', 'NAME_LENGTH', 'NAME_TEST_MARKER', 'NAME_CELEBRITY', 'DESC_EMPTY', 'DESC_SHORT', 'DESC_LONG'].includes(f.code)) {
      stages.identity.issues.push(f);
      stages.identity.passed = false;
    } else if (f.code.startsWith('SVC_')) {
      stages.service.issues.push(f);
      stages.service.passed = false;
    } else if (f.code.startsWith('CATEGORY')) {
      stages.category.issues.push(f);
      stages.category.passed = false;
    }
  }

  const passedCount = Object.values(stages).filter(s => s.passed).length;
  const confidence = Math.round((passedCount / 3) * 100);

  // Step-by-step guide
  const guide = [];
  if (!stages.identity.passed) {
    guide.push({
      step: 1,
      title: 'Fix identity',
      commands: [`# Edit name: 3-25 chars, no celebrity/test markers`, `# Edit description: 30-500 chars`],
    });
  }
  if (!stages.service.passed) {
    guide.push({
      step: guide.length + 1,
      title: 'Fix service',
      commands: lint.findings.filter(f => f.severity === 'block' && f.code.startsWith('SVC_')).map(f => `# ${f.field}: ${f.fix}`),
    });
  }
  if (!stages.category.passed) {
    guide.push({
      step: guide.length + 1,
      title: 'Fix category',
      commands: [`# Use one of: FINANCE, SOFTWARE_SERVICES, LIFESTYLE, ART_CREATION, EDUCATION, PRODUCTIVITY, SOCIAL`],
    });
  }
  if (guide.length === 0) {
    guide.push({ step: 1, title: 'Submit', commands: ['onchainos agent pre-check --role asp', 'onchainos agent create --role asp ...'] });
  }

  return {
    job_type: 'onboard',
    confidence_pct: confidence,
    stages,
    blocker_count: lint.summary.block_count,
    warn_count: lint.summary.warn_count,
    ready_to_submit: passedCount === 3,
    estimated_first_review_chance: `${confidence}%`,
    guide,
    message:
      confidence === 100 ? 'Your listing is review-ready. Submit with confidence.' :
      confidence >= 66 ? 'A few fixes needed. Follow the guide below, then re-run /v1/jobs/onboard.' :
      'Significant issues. Re-draft your listing before submitting — see the guide below.',
  };
}

// ─── 6. /v1/jobs/subscribe ──────────────────────────────────────────────
// Recurring subscription. Other agents can "hire Foundry" on a schedule.
const SUBSCRIPTIONS = new Map();
export function createSubscription({ owner_id, plan, callback_url, draft }) {
  if (!owner_id || !plan) throw new Error('owner_id and plan required');
  const id = 'sub_' + randomUUID().slice(0, 8);
  const sub = {
    id,
    owner_id,
    plan,                    // 'weekly_audit' | 'daily_stats' | 'rule_alerts'
    callback_url,
    draft_hash: draft ? hashDraft(draft) : null,
    created_at: new Date().toISOString(),
    active: true,
    next_run_at: nextRunFor(plan),
  };
  SUBSCRIPTIONS.set(id, sub);
  return sub;
}
function nextRunFor(plan) {
  const now = Date.now();
  if (plan === 'daily_stats') return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (plan === 'weekly_audit') return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (plan === 'rule_alerts') return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  return new Date(now + 24 * 60 * 60 * 1000).toISOString();
}
export function listSubscriptions() {
  return Array.from(SUBSCRIPTIONS.values());
}
export function cancelSubscription(id) {
  const sub = SUBSCRIPTIONS.get(id);
  if (!sub) return null;
  sub.active = false;
  SUBSCRIPTIONS.set(id, sub);
  return sub;
}

// ─── 7. /v1/jobs/sla ────────────────────────────────────────────────────
// Guaranteed-turnaround job: "score + rewrite my listing in under N seconds"
export async function jobSLA({ draft, max_ms = 5000 }) {
  if (!draft) throw new Error('draft required');
  const t0 = Date.now();
  const { markdownToListing } = await import('../parser/markdownToListing.js');
  const { listing } = markdownToListing(draft);

  // Race the linter against the deadline
  const lintPromise = lintListing({ listing, rewrite: true });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SLA timeout')), max_ms)
  );

  let result, timedOut = false;
  try {
    result = await Promise.race([lintPromise, timeoutPromise]);
  } catch (e) {
    timedOut = true;
    // Try to return a partial result
    result = { score: 0, pass: false, findings: [], rewritten: {}, summary: { block_count: 0, warn_count: 0, next_step: 'SLA timeout — increase max_ms or simplify draft' } };
  }
  const elapsed = Date.now() - t0;

  return {
    job_type: 'sla',
    sla_max_ms: max_ms,
    actual_ms: elapsed,
    met_sla: !timedOut && elapsed <= max_ms,
    score: result.score,
    pass: result.pass,
    rewritten: result.rewritten,
    findings_count: result.findings?.length || 0,
    next_step: timedOut ? 'Re-submit with a higher max_ms or simpler draft.' : 'Done.',
  };
}

// ─── 8. /v1/jobs/portfolio — public trust profile ───────────────────────
// "What's the trust score of agent #N?" — pulls from the live marketplace
// + your past lint history (if any).
export async function jobPortfolio({ agent_id }) {
  if (!agent_id) throw new Error('agent_id required');
  const market = loadLocalMarketplace();
  const agent = market.find(a => String(a.agent_id) === String(agent_id));
  if (!agent) {
    return { job_type: 'portfolio', agent_id, found: false, message: 'Agent not in current marketplace snapshot. Run pnpm scrape first.' };
  }

  // Build a trust score 0-100
  const priceScore = agent.service_min_price > 0 && agent.service_min_price <= 0.05 ? 25 :
                     agent.service_min_price <= 0.2 ? 18 : 10;
  const volumeScore = Math.min(35, Math.round(Math.log10(agent.sold_count + 1) * 13));
  const ratingScore = agent.rating ? Math.min(25, Math.round(agent.rating / 4)) : 12;
  const presenceScore = agent.online_status ? 10 : 0;
  const trust = priceScore + volumeScore + ratingScore + presenceScore;

  let grade = 'A';
  if (trust < 80) grade = 'B';
  if (trust < 60) grade = 'C';
  if (trust < 40) grade = 'D';
  if (trust < 20) grade = 'F';

  // Pull audit history if exists
  const audit = AUDIT_HISTORY.get(String(agent_id));

  return {
    job_type: 'portfolio',
    agent_id,
    found: true,
    name: agent.name,
    category: agent.category,
    description: agent.description,
    trust_score: trust,
    grade,
    breakdown: { price: priceScore, volume: volumeScore, rating: ratingScore, presence: presenceScore },
    metrics: {
      price_usdt: agent.service_min_price,
      total_sales: agent.sold_count,
      avg_rating: agent.rating,
      services_count: agent.total_service_count,
      online: !!agent.online_status,
    },
    foundry_audit: audit || null,
    verdict:
      grade === 'A' ? 'Highly trusted. Safe to call.' :
      grade === 'B' ? 'Reputable. Standard due diligence recommended.' :
      grade === 'C' ? 'Mixed signals. Verify before paying high fees.' :
      grade === 'D' ? 'Low trust. Proceed with caution.' :
      'High risk. Do not pay large amounts without escrow.',
    recompute_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}
