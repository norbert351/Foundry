# Foundry A2A Worker Plan

## Goal
Production-deployable Foundry worker for OKX.AI task marketplace hires. Two-phase:

1. **API phase** — after `job_accepted`, if payload has explicit `foundry_job`, execute Foundry service handlers and deliver JSON.
2. **Agent phase** — after `job_accepted`, if no `foundry_job`, queue for Hermes + optional webhook; Hermes runs okx-ai / next-action and delivers.

## Status — DONE
- [x] `src/a2a/` worker, jobs router, store, deliverable writer, CLI adapter, Hermes notify
- [x] Render background worker in `render.yaml`
- [x] `/health` + `/v1/a2a/health`
- [x] Unit tests (routing + idempotency + waiting gate) — 50/50 suite green
- [x] Local systemd: `foundry-asp`, `foundry-a2a-worker`
- [x] Hermes cron: `Foundry A2A agent-phase watcher` every 10m (`87d895ff511d`)

## Safety
- Never execute work from unaccepted tasks
- Never infer job type from natural language
- Never deliver before successful API execution
- Idempotent deliveries

## Live verification
Worker polled 9 real ASP tasks: 8 `waiting_for_acceptance`, 1 already `submitted` → skipped. Correct.
