# Foundry A2A — two-phase hire handler

## What this is

When someone **hires** Foundry on the OKX.AI Task Marketplace, a durable worker
must respond. Foundry uses a **two-phase** model:

| Phase | When | Who runs | What happens |
|---|---|---|---|
| **API** | Task is `accepted` AND payload has explicit `foundry_job` | Foundry worker | Calls the same job handlers as `/v1/jobs/*`, writes JSON deliverable, `onchainos agent deliver` |
| **Agent** | Task is `accepted` but no `foundry_job` | **Hermes** (this agent) | Worker queues the job + optional webhook; Hermes loads `okx-ai`, runs `next-action`, does the work, delivers |

### Hard gates
- Status `created` (0) → **wait**. Client must `confirm-accept` first (`job_accepted`).
- Never guess a job type from natural language.
- Deliver only after successful execution.
- Deliveries are idempotent (duplicate accepted events do not double-submit).

## Explicit API job payload (clients should send this)

```json
{
  "foundry_job": "onboard",
  "input": { "draft": "# My ASP\n\n..." }
}
```

or

```json
{
  "foundry_job": { "type": "list-draft", "input": { "draft": "..." } }
}
```

Supported types: `list-draft`, `audit`, `marketplace-watch`, `portfolio-review`, `onboard`, `sla`, `portfolio`.

## Local 24/7

```bash
# Web API
systemctl --user enable --now foundry-asp.service

# Marketplace worker
systemctl --user enable --now foundry-a2a-worker.service

# Already required:
# - okx-a2a.service (daemon + Hermes routing)
# - hermes gateway (Telegram + okx-a2a plugin)
```

```bash
pnpm worker          # long-running poll loop
pnpm worker:once     # single tick
pnpm worker:dry      # single tick, no on-chain deliver
```

## Env

See `.env.example`. Critical:

- `FOUNDRY_ASP_AGENT_ID` — Foundry's ASP agent id after marketplace registration
- `FOUNDRY_A2A_FILTER_AGENT_ID` — optional filter (recommended once Foundry is listed, so ForgeVault tasks are not mixed in)
- `FOUNDRY_HERMES_WEBHOOK_URL` — optional Hermes webhook for agent-phase wakeups
- `FOUNDRY_A2A_DATA_DIR` — durable state + hermes-queue + deliverables

## Health

- `GET /health` → includes `a2a` block
- `GET /v1/a2a/health` → worker mode + env readiness
- Worker state: `$FOUNDRY_A2A_DATA_DIR/jobs.json`
- Hermes inbox: `$FOUNDRY_A2A_DATA_DIR/hermes-queue/`

## Hermes agent-phase watcher

A Hermes cron (`Foundry A2A agent-phase watcher`) polls the hermes-queue and
active ASP tasks. When a `needs_hermes` item appears, Hermes:

1. Loads okx-ai skill
2. Runs `onchainos agent next-action --role auto ...`
3. Executes the returned script / does the work
4. Delivers via `onchainos agent deliver`

Live A2A system events are also pushed into Hermes by the `okx-a2a` daemon
plugin when the Hermes gateway is up — the queue is the safety net.
