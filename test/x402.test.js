// test/x402.test.js — middleware gate behavior
// We run each test in a fresh process by re-importing the module via a
// dynamic specifier + cache-bust. For simplicity here we test the gate
// behavior by setting the env BEFORE first import (the file is loaded
// fresh by node --test per file).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force a known state — the .env file in the repo sets X_BYPASS_PAYMENT=1
// for the dev workflow. We override it per-test by using process.env.
const ORIGINAL_BYPASS = process.env.X_BYPASS_PAYMENT;
const ORIGINAL_PK = process.env.FOUNDRY_WALLET_PK;

// Need a deterministic foundry wallet for the gate's payTo address
process.env.FOUNDRY_WALLET_PK = '0x' + '1'.repeat(64);
process.env.X_BYPASS_PAYMENT = '0';

// Dynamic import to pick up the env we just set
const { x402Gate } = await import('../src/x402/middleware.js');
const { config } = await import('../src/config.js');

function fakeReq(headers = {}) { return { headers, url: '/v1/test' }; }

function fakeReply() {
  const r = {
    code(c) { r._code = c; return r; },
    header(k, v) { r._headers = r._headers || {}; r._headers[k] = v; return r; },
    send(b) { r._body = b; return r; },
  };
  return r;
}

test('returns 402 + PAYMENT-REQUIRED when no X-PAYMENT header', async () => {
  const gate = x402Gate({ amount: 0.01 });
  const reply = fakeReply();
  const req = fakeReq();
  const result = await gate(req, reply);
  assert.equal(reply._code, 402);
  assert.ok(reply._headers?.['PAYMENT-REQUIRED']);
  const decoded = JSON.parse(Buffer.from(reply._headers['PAYMENT-REQUIRED'], 'base64').toString());
  assert.equal(decoded.x402Version, 2);
  assert.ok(Array.isArray(decoded.accepts));
  assert.equal(decoded.accepts[0].scheme, 'exact');
  assert.ok(decoded.accepts[0].amount.length > 0);
  assert.equal(decoded.accepts[0].network, 'x-layer');
  assert.equal(decoded.accepts[0].chainId, 196);
});

test('returns 402 with malformed X-PAYMENT', async () => {
  const gate = x402Gate({ amount: 0.01 });
  const reply = fakeReply();
  const req = fakeReq({ 'x-payment': 'not-base64-junk' });
  await gate(req, reply);
  assert.equal(reply._code, 402);
  assert.equal(reply._body?.error, 'invalid_payment');
});

// Restore env so other tests/files aren't affected
process.env.X_BYPASS_PAYMENT = ORIGINAL_BYPASS;
process.env.FOUNDRY_WALLET_PK = ORIGINAL_PK;

