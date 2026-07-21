// src/services/listingReadiness.js
//
// Listing Readiness Report — runs the three OKX.AI reviewer checks against
// an ASP endpoint and returns a pass/fail report with specific fixes.
//
// Input:  { endpoint: string, service_name?: string }
// Output: { verdict, checks: { x402, reachability, self_test }, ready_to_list, next_steps }

import { x402Check } from './x402Check.js';
import { validatePublicUrl } from './validateUrl.js';

const TIMEOUT_MS = 12000;

export async function listingReadiness({ endpoint, service_name, method = 'POST' }) {
  if (!endpoint) {
    return { verdict: 'MISSING_ENDPOINT', message: 'Provide your ASP endpoint URL to check.' };
  }

  try { validatePublicUrl(endpoint); } catch (e) {
    return { verdict: 'INVALID_URL', message: e.message };
  }

  const report = {
    endpoint,
    service_name: service_name || null,
    checked_at: new Date().toISOString(),
    checks: {},
    ready_to_list: false,
    blockers: [],
    warnings: [],
    next_steps: [],
  };

  // ── Check 1: x402 Compliance ──────────────────────────────────────
  const x402 = await x402Check({ endpoint, method: 'POST' });
  report.checks.x402 = x402;
  if (!x402.passed) {
    report.blockers.push(...x402.issues);
  }

  // ── Check 2: Endpoint reachability (probe with same method) ─────────
  let reachable = false;
  let healthStatus = 0;
  let healthLatency = 0;
  let healthBody = null;
  const t0 = Date.now();
  const probeMethod = method === 'GET' || method === 'HEAD' ? method : 'POST';
  const probeBody = probeMethod === 'POST' ? JSON.stringify({ test: 'reachability' }) : undefined;
  try {
    const r = await fetch(endpoint, {
      method: probeMethod,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Foundry-Readiness/0.1' },
      body: probeBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    healthStatus = r.status;
    healthLatency = Date.now() - t0;
    const text = (await r.text()).slice(0, 50_000);
    try { healthBody = JSON.parse(text); } catch { healthBody = null; }
    reachable = healthStatus >= 200 && healthStatus < 500 && healthStatus !== 404;
  } catch (e) {
    healthStatus = 0;
    healthLatency = Date.now() - t0;
  }

  report.checks.reachability = {
    passed: reachable,
    http_status: healthStatus,
    latency_ms: healthLatency,
    has_json_response: healthBody !== null,
    detail: reachable
      ? `Reachable (HTTP ${healthStatus}, ${healthLatency}ms)`
      : `Unreachable or returned ${healthStatus}`,
  };

  if (!reachable) {
    report.blockers.push(
      `Endpoint unreachable (HTTP ${healthStatus || 'connection failed'}). Reviewers will reject unreachable endpoints.`
    );
    report.warnings.push(
      'Deploy your service to a public HTTPS URL before listing. Render, Railway, Fly.io, and Vercel all offer free tiers.'
    );
  }

  // ── Check 3: Self-test readiness ──────────────────────────────────
  report.checks.self_test = {
    passed: reachable && x402.passed,
    steps: [
      {
        step: 1,
        title: 'Register a user agent',
        command: 'onchainos agent pre-check --role user && onchainos agent create --role user --name "QA Tester" --description "Testing my ASP before listing."',
        note: 'Creates a lightweight user identity on X Layer so you can call your own ASP.',
      },
      {
        step: 2,
        title: 'Test x402 payment flow',
        command: `onchainos payment quote '${endpoint}' --method POST`,
        note: 'Probes your endpoint, decodes the 402 challenge, and prepares a payment. Must see "needsConfirm: true" with your token and amount.',
      },
      {
        step: 3,
        title: 'Complete a payment (optional but recommended)',
        command: 'onchainos payment pay --payment-id <id> --selected-index 0 --yes',
        note: 'Actually pays and replays the request. Costs ~0.005 USDT on X Layer. Confirms end-to-end flow works.',
      },
      {
        step: 4,
        title: 'Run Foundry smoke test',
        command: 'bash scripts/smoke-listing.sh',
        note: '20 automated checks: health, rules, instant-ship, scoreboard, competitors, x402 402 + challenge decode.',
      },
    ],
  };

  // ── Final verdict ─────────────────────────────────────────────────
  report.ready_to_list = report.blockers.length === 0;

  if (report.ready_to_list) {
    report.verdict = 'READY — all three reviewer checks pass. Submit your listing.';
    report.next_steps = [
      '1. Submit your listing via the OKX.AI marketplace.',
      '2. Monitor the review queue — approval typically takes 1-3 days.',
      '3. If rejected, run this check again after fixing the cited issue.',
    ];
  } else {
    report.verdict = `NOT READY — ${report.blockers.length} blocker(s) must be fixed first.`;
    report.next_steps = [
      `1. Fix the ${report.blockers.length} blocker(s) listed above.`,
      '2. Re-run listing-readiness after fixes.',
      '3. Do NOT submit until ready_to_list is true.',
    ];
  }

  // Add warnings about things we can't auto-check
  if (report.ready_to_list) {
    report.warnings.push(
      'x402 header compliance was checked via body fields only. Verify the PAYMENT-REQUIRED header with: curl -sS -D- -X POST <your-endpoint> | grep payment-required'
    );
    report.warnings.push(
      'Services must have descriptions that are clear, scoped, and free of placeholder text. OKX reviewers flag vague descriptions.'
    );
  }

  return report;
}
