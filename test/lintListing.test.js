// test/lintListing.test.js — no LLM, no Supabase
import { test } from 'node:test';
import assert from 'node:assert/strict';

// We import the linting service but stub the LLM client so it returns deterministic
// text. This lets us exercise the rule engine.
import { lintListing } from '../src/services/lintListing.js';

// Stub: no LLM, just call lintListing with rewrite:false
test('rejects empty name', async () => {
  const r = await lintListing({
    listing: { name: '', description: 'A'.repeat(40), category: 'SOFTWARE_SERVICES', services: [] },
    rewrite: false,
  });
  assert.equal(r.score < 100, true);
  assert.ok(r.findings.some((f) => f.code === 'NAME_EMPTY'));
});

test('rejects http (non-https) endpoint', async () => {
  const r = await lintListing({
    listing: {
      name: 'MyAgent',
      description: 'A'.repeat(40),
      category: 'SOFTWARE_SERVICES',
      services: [{
        name: 'Service One',
        description: '① A test service.\n② User must provide: 1. query',
        type: 'A2MCP',
        fee: '0.01',
        endpoint: 'http://example.com/api',
      }],
    },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'SVC_ENDPOINT_NOT_HTTPS'));
});

test('rejects localhost endpoint', async () => {
  const r = await lintListing({
    listing: {
      name: 'MyAgent',
      description: 'A'.repeat(40),
      category: 'SOFTWARE_SERVICES',
      services: [{
        name: 'Service One',
        description: '① A test service.\n② User must provide: 1. query',
        type: 'A2MCP',
        fee: '0.01',
        endpoint: 'https://localhost:3000/api',
      }],
    },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'SVC_ENDPOINT_PRIVATE'));
});

test('rejects fee with currency symbol', async () => {
  const r = await lintListing({
    listing: {
      name: 'MyAgent',
      description: 'A'.repeat(40),
      category: 'SOFTWARE_SERVICES',
      services: [{
        name: 'Service One',
        description: '① A test service.\n② User must provide: 1. query',
        type: 'A2MCP',
        fee: '0.01 USDT',
        endpoint: 'https://api.example.com/v1',
      }],
    },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'SVC_FEE_HAS_SYMBOL'));
});

test('rejects celebrity name', async () => {
  const r = await lintListing({
    listing: { name: 'TrumpTradeBot', description: 'A'.repeat(40), category: 'FINANCE', services: [] },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'NAME_CELEBRITY'));
});

test('rejects test marker', async () => {
  const r = await lintListing({
    listing: { name: 'MyTestAgent', description: 'A'.repeat(40), category: 'FINANCE', services: [] },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'NAME_TEST_MARKER'));
});

test('rejects price in service name', async () => {
  const r = await lintListing({
    listing: {
      name: 'MyAgent',
      description: 'A'.repeat(40),
      category: 'FINANCE',
      services: [{
        name: 'Yield at 5 USDT',
        description: '① A yield service.\n② User must provide: 1. amount',
        type: 'A2MCP',
        fee: '0.05',
        endpoint: 'https://api.example.com/v1',
      }],
    },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'SVC_NAME_PRICE'));
});

test('rejects service description with external links', async () => {
  const r = await lintListing({
    listing: {
      name: 'MyAgent',
      description: 'A'.repeat(40),
      category: 'FINANCE',
      services: [{
        name: 'Service One',
        description: '① A test service. See https://github.com/x/y\n② User must provide: 1. query',
        type: 'A2MCP',
        fee: '0.01',
        endpoint: 'https://api.example.com/v1',
      }],
    },
    rewrite: false,
  });
  assert.ok(r.findings.some((f) => f.code === 'SVC_DESC_LINKS'));
});

test('clean listing passes', async () => {
  const r = await lintListing({
    listing: {
      name: 'Foundry ASP',
      description: 'Pre-flight to post-flight for OKX.AI Agent Service Providers. Validates ideas, prices services, lints listings, and bootstraps trust.',
      category: 'SOFTWARE_SERVICES',
      services: [{
        name: 'Validate Idea',
        description: '① Checks if your ASP idea is worth building by scoring demand and mapping competitors.\n② User must provide: 1. idea 2. optional category',
        type: 'A2MCP',
        fee: '0.005',
        endpoint: 'https://foundry-asp.onrender.com/v1/validate-idea',
      }],
    },
    rewrite: false,
  });
  // We still might have some warns (e.g. expected_volume guidance) but no blocks
  const blocks = r.findings.filter((f) => f.severity === 'block');
  assert.equal(blocks.length, 0, `unexpected blocks: ${JSON.stringify(blocks)}`);
  assert.ok(r.score >= 85, `expected ≥85, got ${r.score}`);
});
