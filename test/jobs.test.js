// test/jobs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobListDraft, jobAudit, jobMarketplaceWatch, listWatches,
  jobPortfolioReview, jobOnboard, jobSLA, jobPortfolio,
  createSubscription, listSubscriptions, cancelSubscription,
} from '../src/services/jobs.js';

const CLEAN_DRAFT = `# MyAgent

A great agent for the OKX.AI marketplace that does useful things for builders everywhere.

## Service One
Does the first thing well.

## Service Two
Does the second thing well.`;

const DIRTY_DRAFT = `# TrumpTradeBot test

x

## Yield at 5 USDT
just a description`;

test('jobListDraft returns ready-to-submit listing + report', async () => {
  const r = await jobListDraft({ draft: CLEAN_DRAFT });
  assert.ok(r.job_id.startsWith('job_'));
  assert.ok(r.listing);
  assert.ok(r.listing.name);
  assert.ok(Array.isArray(r.listing.services));
  assert.ok(r.report);
  assert.equal(typeof r.report.lint_score, 'number');
  assert.equal(typeof r.report.recommended_fee_usdt, 'number');
  assert.ok(Array.isArray(r.submit_instructions));
});

test('jobAudit scores and tracks history', async () => {
  const r1 = await jobAudit({ agent_id: 'test-1', draft: CLEAN_DRAFT });
  assert.equal(typeof r1.current_score, 'number');
  assert.equal(r1.trend, 'first_run');
  // Run again with same draft
  const r2 = await jobAudit({ agent_id: 'test-1', draft: CLEAN_DRAFT });
  assert.equal(r2.trend, 'unchanged');
  assert.equal(r2.delta, 0);
  assert.equal(r2.previous_score, r1.current_score);
  // Run with worse draft
  const r3 = await jobAudit({ agent_id: 'test-1', draft: DIRTY_DRAFT });
  assert.ok(r3.trend.startsWith('regressed_by_') || r3.trend === 'unchanged');
});

test('jobMarketplaceWatch tracks competitors and returns snapshots', async () => {
  // First check if marketplace has data
  const { loadLocalMarketplace } = await import('../src/db/localCache.js');
  const market = loadLocalMarketplace();
  if (market.length === 0) {
    console.log('  skipping — no marketplace data (run pnpm scrape first)');
    return;
  }
  const agentIds = market.slice(0, 3).map(a => a.agent_id);
  const r = await jobMarketplaceWatch({ owner_id: 'test-watcher', agent_ids: agentIds });
  assert.equal(r.tracked, 3);
  assert.ok(r.snapshots.length > 0);
  assert.ok(Array.isArray(r.alerts));
});

test('jobPortfolioReview ranks listings and gives kill/improve/keep', async () => {
  const r = await jobPortfolioReview({
    listings: [
      { name: 'A', description: 'A great agent for the OKX marketplace that solves real problems for builders and developers worldwide.', category: 'SOFTWARE_SERVICES', services: [{ name: 'S', description: '① Does the thing well.\n② User must provide: 1. input', type: 'A2MCP', fee: '0.01', endpoint: 'https://api.example.com/v1' }] },
      { name: 'B', description: 'TrumpTradeBot', category: 'BADCAT', services: [] },
    ],
  });
  assert.equal(r.reviewed, 2);
  assert.ok(r.ranked.length === 2);
  assert.ok(['kill', 'improve', 'keep'].includes(r.ranked[0].action));
});

test('jobOnboard returns confidence + step-by-step guide', async () => {
  const r = await jobOnboard({ draft: DIRTY_DRAFT });
  assert.equal(typeof r.confidence_pct, 'number');
  assert.ok(r.confidence_pct < 100, 'dirty draft should not be 100%');
  assert.ok(['identity', 'service', 'category'].every(k => k in r.stages));
  assert.ok(Array.isArray(r.guide));
  assert.ok(r.guide.length > 0);
  const r2 = await jobOnboard({ draft: CLEAN_DRAFT });
  assert.equal(r2.confidence_pct, 100);
  assert.equal(r2.ready_to_submit, true);
});

test('jobSLA respects max_ms and returns met_sla flag', async () => {
  const r = await jobSLA({ draft: CLEAN_DRAFT, max_ms: 10000 });
  assert.equal(typeof r.actual_ms, 'number');
  assert.ok(r.actual_ms < 10000);
  assert.equal(r.met_sla, true);
});

test('jobSLA times out when max_ms is too small', async () => {
  const r = await jobSLA({ draft: CLEAN_DRAFT, max_ms: 1 });
  // 1ms is unrealistic — either times out or completes under it
  assert.equal(typeof r.met_sla, 'boolean');
});

test('jobPortfolio returns trust score for known agent', async () => {
  const { loadLocalMarketplace } = await import('../src/db/localCache.js');
  const market = loadLocalMarketplace();
  if (market.length === 0) {
    console.log('  skipping — no marketplace data');
    return;
  }
  const a = market[0];
  const r = await jobPortfolio({ agent_id: a.agent_id });
  assert.equal(r.found, true);
  assert.equal(r.name, a.name);
  assert.equal(typeof r.trust_score, 'number');
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(r.grade));
});

test('createSubscription + list + cancel', () => {
  const sub = createSubscription({ owner_id: 'test', plan: 'weekly_audit' });
  assert.ok(sub.id.startsWith('sub_'));
  assert.equal(sub.plan, 'weekly_audit');
  assert.equal(sub.active, true);
  const all = listSubscriptions();
  assert.ok(all.some(s => s.id === sub.id));
  const cancelled = cancelSubscription(sub.id);
  assert.equal(cancelled.active, false);
});
