// test/adapters.test.js — smoke test the frontend adapter shapes
import { test } from 'node:test';
import assert from 'node:assert/strict';

const DRAFT = `# MyAgent

An AI agent that does useful things for builders on the OKX.AI marketplace.

## Service One
Does the first thing.

## Service Two
Does the second thing.`;

test('apiLint returns frontend-shaped response', async () => {
  const { apiLint } = await import('../src/services/adapters.js');
  const r = await apiLint({ draft: DRAFT });
  assert.equal(typeof r.score, 'number');
  assert.equal(typeof r.summary, 'string');
  assert.ok(Array.isArray(r.checks));
  assert.equal(typeof r.rewritten, 'string');
  // Every check has the required fields
  for (const c of r.checks) {
    assert.ok(c.id && c.category && c.status && c.rule && c.message);
    assert.ok(['pass', 'warn', 'block'].includes(c.status));
  }
});

test('apiValidate returns ValidationData shape', async () => {
  const { apiValidate } = await import('../src/services/adapters.js');
  const r = await apiValidate({ draft: DRAFT });
  assert.equal(typeof r.demandScore, 'number');
  assert.ok(['Low', 'Medium', 'High'].includes(r.riskLevel));
  assert.equal(typeof r.marketFitSummary, 'string');
  assert.ok(Array.isArray(r.targetDemographics));
  assert.ok(Array.isArray(r.keyRisks));
  assert.ok(Array.isArray(r.growthOpportunities));
});

test('apiPrice returns PricingData shape', async () => {
  const { apiPrice } = await import('../src/services/adapters.js');
  const r = await apiPrice({ draft: DRAFT });
  assert.equal(typeof r.modelType, 'string');
  assert.ok(Array.isArray(r.suggestedPricingTiers));
  assert.ok(r.suggestedPricingTiers.length >= 1);
  for (const t of r.suggestedPricingTiers) {
    assert.ok(t.name && t.price && Array.isArray(t.features));
  }
  assert.ok(Array.isArray(r.monetizationStreams));
  assert.equal(typeof r.strategicJustification, 'string');
});

test('apiTrust (no endpoint) returns synthesis', async () => {
  const { apiTrust } = await import('../src/services/adapters.js');
  const r = await apiTrust({ draft: DRAFT });
  assert.ok(Array.isArray(r.trustBadges));
  assert.ok(r.trustBadges.length >= 1);
  assert.equal(typeof r.securityDeclaration, 'string');
  assert.ok(Array.isArray(r.faqs));
  assert.ok(r.faqs.length >= 1);
});
