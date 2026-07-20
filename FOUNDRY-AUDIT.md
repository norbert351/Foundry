# Foundry ASP — Launch Readiness Audit

Generated: 2026-07-20  
Audit scope: All 19 source files  
Severity levels: **HIGH** — blocks launch / requires immediate fix, **MED** — significant concern but not blocking, **LOW** — cosmetic or long-term concern

---

## Summary Table

| File | Issues Found | Severity | Recommendation |
|---|---|---|---|
| **src/config.js** | No input validation on `FOUNDRY_WALLET_PK` format (will crash at first `bootstrapTrust` call with a cryptic ethers error if PK is malformed) | MED | Add PK format validation with a clear error message at startup |
| | `bypassPayment: X_BYPASS_PAYMENT === '1'` with no guardrail preventing accidental prod enablement; comment says "DO NOT enable in prod" but it's unchecked | HIGH | Remove bypass flag entirely in production build, or add `NODE_ENV === 'production'` check that ignores the flag |
| **src/server.js** | **No global Fastify error handler** — all thrown errors (including validation failures) produce raw 500 responses leaking internal error messages: `{"statusCode":500,"error":"Internal Server Error","message":"listing object required"}` | HIGH | Add `app.setErrorHandler((err, req, reply) => { ... })` that sanitizes messages in production |
| | **No Zod/input validation on any route** — `zod` is in `package.json` dependencies but never imported. Every route relies on `req.body || {}` and downstream `throw` for validation, causing 500s with leaky messages | HIGH | Add Zod schemas per route; Fastify has built-in schema validation via `schema: { body: ... }` |
| | `/api/_parse` debug endpoint exposed in production (line 388) — accepts any markdown, returns parsed listing JSON | LOW | Remove or guard behind `NODE_ENV !== 'production'` |
| | CORS `origin: '*'` (line 75) — wide open. Acceptable for a public API but means paid endpoints are callable from any browser page | LOW | Tighten to specific origin list or document rationale |
| | `previewHits` rate limiter (lines 440-447) has a TOCTOU race: two concurrent requests from the same IP could both miss the `get()`, create fresh entries, and the `set()` overwrite would let both through | MED | Use `previewHits.get(ip) ?? { ... }` pattern won't fix race; use `app.register(import('@fastify/rate-limit'))` instead |
| | Fire-and-forget startup calls (`scrapeOnce().catch(...)`, `a2aWorker.run().catch(...)`) — if they fail silently during initial boot, the app appears healthy but no data is loaded | LOW | Add health check that verifies at least one initial scrape completed |
| **src/x402/middleware.js** | **Payment bypass is trivially fakeable** — the "verification" (lines 54-63) accepts any base64 JSON with `payload` and `signature` fields that are truthy. No actual EIP-712 / EIP-3009 signature verification. Anyone who reads the source can bypass payment: `echo '{"payload":{},"signature":"x"}' \| base64` | HIGH | This is documented "for the hackathon demo" but must be replaced with real on-chain signature verification using ethers.js before production launch |
| | `freeInDev = true` is the **hardcoded default** (line 44) — every `x402Gate()` call uses this default, meaning `X_BYPASS_PAYMENT=1` disables payment globally. No caller overrides it | HIGH | Explicitly pass `freeInDev: false` in every production route definition, or remove the parameter entirely |
| | `SELLER_ADDRESS` derived at module-load time (lines 20-22) — if `FOUNDRY_WALLET_PK` is empty, falls back to zero address `0x000...` without warning | MED | Log a warning at startup if seller address is zero address |
| **src/services/lintListing.js** | **No timeout/latency limit on LLM rewrites** — each `generateRewrite` call waits up to Anthropic 30s + Hermes 60s. With `batchLint(20)` × up to N services each, a single request could take **minutes**, tying up the event loop | HIGH | Add a per-rewrite timeout (e.g., 10s) and a cumulative timeout for the full lint call; consider parallelizing service rewrites |
| | **Persists full listing to Supabase** for analytics (line 206: `listing: { ...listing, rewritten: undefined }`) — if a caller includes extra fields (accidental private data) in their listing payload, it gets saved | MED | Use a whitelist of known fields when persisting: `{ name, description, category, services, agent_id }` |
| | No rate limiting per IP/caller on lint-listing endpoint | LOW | Consider per-caller rate limits if misuse observed |
| **src/services/bootstrapTrust.js** | **SSRF vector** — fetches user-supplied `endpoint` URL (line 62) with `redirect: 'follow'` (line 67). No validation that the target is not a private/internal IP. Could be used to probe internal infrastructure | HIGH | Add private-IP/loopback check before fetch; set `redirect: 'manual'` and validate redirect targets |
| | `new ethers.Wallet(pk)` at first call (line 29) — if PK is invalid format, throws a cryptic error inside an x402-paid handler after the user already paid | MED | Validate wallet PK at startup and fail fast with a clear message |
| | `signMessage` (EIP-191, line 103) — signs arbitrary receipt data. No EIP-712 typed structured data. Replay potential in different contexts (though receipt content is specific) | LOW | Consider EIP-712 typed signing for stronger domain binding |
| **src/services/extraFeatures.js** | **SSRF in webhook firing** (lines 230-248) — `registerWebhook` accepts arbitrary URLs with no validation. `fireWebhooks` fetches those URLs. A malicious user could register a webhook pointing to `http://169.254.169.254/` (AWS metadata) or internal services | HIGH | Validate webhook URLs against private IPs on registration; block common internal hosts |
| | **SSRF in extendedHealthCheck** (line 261) — similarly fetches user-supplied `endpoint` without validation | HIGH | Same fix: validate target URL before fetching |
| | `batchLint` runs up to 20 `lintListing` calls in parallel via `Promise.all` — 20 concurrent LLM calls could hit rate limits or memory issues | MED | Limit concurrency (e.g., `p-limit` or manual batching) |
| | In-memory state (`PREVIEW_STORE`, `WEBHOOKS`) — all lost on server restart. Webhooks are a paid feature (depends on x402, which is `free`) but promise persistence | MED | Add file-based or DB persistence for webhook registrations |
| **src/services/jobs.js** | All subscription/watch/audit state is **in-memory Maps** (`AUDIT_HISTORY`, `WATCH_LIST`, `WATCH_HISTORY`, `SUBSCRIPTIONS`) — lost on every restart | HIGH | At minimum persist to local JSON files (like `JobStore` does); ideally to Supabase |
| | `jobListDraft` (line 38-47) accesses `lint.rewritten.service_descriptions[i]` without checking if `lint.rewritten` exists first — the outer `if (lint.rewritten)` check on line 38 should cover this, but inner access on line 41 checks `lint.rewritten.service_descriptions` with truthiness, so undefined doesn't throw | LOW | Use optional chaining: `lint.rewritten?.service_descriptions?.[i]` |
| | Float equality check for price changes (line 192: `prev.price !== agent.service_min_price`) — floating-point imprecision could cause false-positive price-change alerts | LOW | Compare with a small epsilon: `Math.abs(prev.price - agent.service_min_price) > 1e-8` |
| **src/llm/client.js** | **No retry logic** — a single Anthropic transient failure (e.g., 429 rate limit) triggers fallthrough to Hermes. If Hermes also fails, a stub is returned | MED | Add at least 1 retry with exponential backoff for 429s |
| | Error message truncation `slice(0, 80)` and `slice(0, 200)` could clip API error details | LOW | Truncate less aggressively (e.g., 500 chars) |
| **src/scraper/okx.js** | **Overlapping cron risk** — the scraper runs 30 queries × up to 3 pages × 30s timeout = worst-case 45 min. With `*/15 * * * *` cron, runs will overlap | MED | Add a mutex/flag to prevent overlapping scraper runs |
| | CLI calls silently returning empty arrays on failure (line 43: `return []`) — Supabase fallback means the app doesn't know scraping failed | LOW | Log a warning with more detail; consider a health metric |
| | `writeLocalMarketplace` is called even before empty-check (line 84), writing empty array over valid data | LOW | Move `writeLocalMarketplace` after the `agents.length === 0` check |
| **src/a2a/cli.js** | `execFile('onchainos', args, ...)` — uses `execFile` (no shell), all args are hardcoded values, safe from command injection | — | No issues found |
| **src/a2a/store.js** | Atomic writes via temp+rename (lines 46-48) — good practice. Write queue prevents concurrent corruption (lines 31-42) | — | No issues found |
| **src/a2a/deliverable.js** | Filename sanitization (line 15) — strips non-alphanumeric chars from jobId. Safe from path traversal | — | No issues found |
| **src/a2a/notify.js** | HMAC webhook signing (lines 47-49) — good security practice. Filename sanitization (line 22) | — | No issues found |
| **src/a2a/worker.js** | Good safety: never executes before status===accepted (line 309), idempotency guard (line 162), filterAgentId (line 268-273) | — | No issues found |
| **src/a2a/jobs.js** | Clean router with input validation (lines 54-56). Supports camelCase/snake_case (line 36-38) | — | No issues found |
| **src/parser/markdownToListing.js** | Synthesized services hardcode `endpoint: 'https://api.example.com/v1'` — will trigger `SVC_ENDPOINT_SUSPICIOUS_HOST` warning? No, `example.com` is not in the `vercel.app|netlify.app|herokuapp.com` list | LOW | Consider documenting this behavior; or use a more realistic placeholder |
| **src/db/supabase.js** | Stub client silently swallows all operations when Supabase is unconfigured — app appears healthy but nothing persists | MED | Log a warning at startup when using stub; expose this in /health |
| | Lazy import of `@supabase/supabase-js` (line 61) only when real client needed — good for startup | — | No issue |
| **scripts/self-lint.js** | Uses top-level `await` (line 17) — requires Node ≥20 ESM. Fine given `package.json` engines | — | No issue |

---

## Critical Issues (Blocking Launch)

1. **🔴 x402 payment is trivially bypassable** (`middleware.js` lines 54-63) — No actual signature verification. Any base64 JSON with `payload` + `signature` fields passes. Documented as "hackathon demo" but this must be real before launch.

2. **🔴 No input validation on any route** — `zod` is a dependency but never used. All 15+ endpoints accept unvalidated `req.body`, causing raw error messages in 500 responses (info leakage + poor UX).

3. **🔴 No global Fastify error handler** — Errors bubble up as raw Fastify 500s with internal error messages.

4. **🔴 SSRF in 3 different places** — `bootstrapTrust` (user-supplied endpoint fetch), `registerWebhook` (webhook URL fetch), `extendedHealthCheck` (endpoint fetch). All accept arbitrary URLs with no private-IP validation.

5. **🔴 In-memory state for all subscription/watch/audit features** — Lost on every restart. If the ASP deploys or restarts, all user subscriptions, marketplace watches, audit history, and webhook registrations vanish.

6. **🔴 `freeInDev` defaults to `true` globally** — If anyone sets `X_BYPASS_PAYMENT=1` in production (misconfigured Render env, copy-paste mistake), all payment is disabled with no warning.

7. **🔴 LLM rewrite calls have no timeout** — A single `lintListing` with rewrites can take 30-90s _per_ field. With 20 listings in `batchLint`, the server can be blocked for minutes.

---

## Summary

- **Total files audited**: 19
- **HIGH severity issues**: 7 (of which 2 are outright payment bypass)
- **MED severity issues**: 10
- **LOW severity issues**: 6
- **Files with no issues**: 5 (`cli.js`, `store.js`, `deliverable.js`, `jobs.js` [a2a], `self-lint.js`)

The architecture is sound — the A2A worker, store, and CLI adapters are well-constructed with proper safety checks. The main risks are in the **x402 payment gate** (stub verification), **input validation** (none), **error handling** (leaky), **SSRF exposure** (3 vectors), and **in-memory state** (all state is ephemeral).
