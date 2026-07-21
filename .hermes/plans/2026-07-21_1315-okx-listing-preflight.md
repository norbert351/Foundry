# OKX listing preflight hardening

## Goal
Implement and verify the three reviewer-facing checks: x402 discovery data for X Layer, public endpoint reachability, and a registered-user self-test runbook.

## Scope
1. Advertise CAIP-2 `eip155:196` in the x402 v2 `accepts` object while retaining explicit `chainId: 196`.
2. Add tests that decode and assert the live protocol shape.
3. Add a non-payment, production-safe smoke-test script for public routes and 402 challenge headers.
4. Correct the Render blueprint public URL and remove obsolete Anthropic env declarations.
5. Create an internal reusable skill with the exact pre-listing checks.

## Acceptance criteria
- `pnpm test` passes.
- Smoke test proves `/health`, public endpoints, `POST /v1/instant-ship`, and protected `POST /v1/validate-idea` behavior.
- x402 challenge includes `x402Version: 2`, `network: eip155:196`, `chainId: 196`, X Layer USDT asset, amount, and payTo.
- `render.yaml` points at the actual Render URL.
- Procedure saved as a reusable skill.
