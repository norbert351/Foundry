// test/priceEstimator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const idx = Math.min(arr.length - 1, Math.floor((arr.length - 1) * p));
  return arr[idx];
}

test('percentiles are bounded and monotonic', () => {
  const arr = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.5, 1.0];
  assert.ok(pct(arr, 0.25) <= pct(arr, 0.5));
  assert.ok(pct(arr, 0.5) <= pct(arr, 0.75));
  assert.equal(pct(arr, 0), arr[0]);
  assert.equal(pct(arr, 1), arr[arr.length - 1]);
});

test('empty array returns 0', () => {
  assert.equal(pct([], 0.5), 0);
});
