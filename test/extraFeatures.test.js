// test/extraFeatures.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, RULE_BY_ID, RULE_CATEGORIES } from '../src/services/rules.js';
import { hashDraft, previewStore, previewGet, listWebhooks } from '../src/services/extraFeatures.js';

test('rules have unique IDs and all required fields', () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(!ids.has(r.id), `duplicate rule id: ${r.id}`);
    ids.add(r.id);
    assert.ok(['block', 'warn', 'info'].includes(r.severity));
    assert.ok(r.title && r.description);
    assert.ok(['identity', 'service', 'category', 'trust'].includes(r.category));
  }
  assert.equal(ids.size, RULES.length);
});

test('RULE_BY_ID lookup works', () => {
  assert.equal(RULE_BY_ID['NAME_CELEBRITY'].severity, 'block');
  assert.equal(RULE_BY_ID['SVC_DESC_LINKS'].category, 'service');
});

test('RULE_CATEGORIES contains all categories used in rules', () => {
  const used = new Set(RULES.map((r) => r.category));
  for (const c of used) assert.ok(RULE_CATEGORIES.includes(c), `category "${c}" missing from RULE_CATEGORIES`);
});

test('hashDraft is deterministic and 64 chars', () => {
  const h1 = hashDraft('hello');
  const h2 = hashDraft('hello');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, hashDraft('world'));
});

test('previewStore + previewGet round-trip', () => {
  const id = previewStore('# A\n\nB', 'secret1');
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 8);
  const e = previewGet(id);
  assert.ok(e);
  assert.equal(e.draft, '# A\n\nB');
});

test('previewGet returns null for unknown id', () => {
  assert.equal(previewGet('nonexistent'), null);
});

test('listWebhooks returns array', () => {
  const w = listWebhooks();
  assert.ok(Array.isArray(w));
});
