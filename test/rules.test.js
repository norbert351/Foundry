// test/rules.test.js — verify the rule book has all the codes the linter uses
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, RULE_BY_ID } from '../src/services/rules.js';
import { lintListing } from '../src/services/lintListing.js';

const CODES_USED_BY_LINTER = [
  'NAME_EMPTY', 'NAME_LENGTH', 'NAME_TEST_MARKER', 'NAME_CELEBRITY',
  'DESC_EMPTY', 'DESC_SHORT', 'DESC_LONG',
  'SVC_NAME_EMPTY', 'SVC_NAME_LENGTH', 'SVC_NAME_PRICE',
  'SVC_DESC_EMPTY', 'SVC_DESC_NO_INPUT_SPEC', 'SVC_DESC_LONG', 'SVC_DESC_LINKS', 'SVC_DESC_WALLET_ADDR', 'SVC_DESC_DISCLAIMER',
  'SVC_TYPE_INVALID', 'SVC_FEE_REQUIRED', 'SVC_FEE_HAS_SYMBOL',
  'SVC_ENDPOINT_REQUIRED', 'SVC_ENDPOINT_NOT_HTTPS', 'SVC_ENDPOINT_TOO_LONG', 'SVC_ENDPOINT_PRIVATE', 'SVC_ENDPOINT_SUSPICIOUS_HOST',
  'CATEGORY_MISSING', 'CATEGORY_INVALID',
];

test('every linter code is documented in the rule book', () => {
  for (const c of CODES_USED_BY_LINTER) {
    assert.ok(RULE_BY_ID[c], `code "${c}" used by linter but not in /v1/rules — judges will see it flagged without context`);
  }
});

test('lintListing output codes are all in the rule book', async () => {
  // Trigger every code on purpose with a maximally bad listing
  const r = await lintListing({
    listing: {
      name: 'TrumpTradeBot test',
      description: 'x',
      category: 'BADCAT',
      services: [{
        name: 'Yield at 5 USDT',
        description: 'just a description with https://github.com/x and not financial advice and wallet address 0x1234567890123456789012345678901234567890',
        type: 'NOPE',
        fee: '0.01 USDT',
        endpoint: 'http://localhost:3000/api',
      }],
    },
    rewrite: false,
  });
  for (const f of r.findings) {
    assert.ok(RULE_BY_ID[f.code], `finding code "${f.code}" not in rule book — /v1/rules won't show context for it`);
  }
});
