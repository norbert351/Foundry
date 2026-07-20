// src/a2a/worker.js
//
// Two-phase Foundry marketplace worker:
//   Phase API   — explicit { foundry_job } payload → run local service → deliver
//   Phase Agent — free-form / unsupported task → queue for Hermes + notify
//
// Safety:
//   - Never execute or deliver before status === accepted (job_accepted)
//   - Never auto-map natural language to a job type
//   - Idempotent: delivered / processing jobs are not re-run

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JobStore } from './store.js';
import { createOnchainosClient } from './cli.js';
import { extractFoundryJob, runFoundryJob, SUPPORTED_A2A_JOBS } from './jobs.js';
import { writeDeliverable } from './deliverable.js';
import { notifyHermes } from './notify.js';

export const STATUS = Object.freeze({
  RECEIVED: 'received',
  WAITING_FOR_ACCEPTANCE: 'waiting_for_acceptance',
  PROCESSING: 'processing',
  DELIVERED: 'delivered',
  NEEDS_HERMES: 'needs_hermes',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const TERMINAL = new Set([
  STATUS.DELIVERED,
  STATUS.NEEDS_HERMES,
  STATUS.FAILED,
  STATUS.SKIPPED,
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeTasks(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.data?.tasks)) return payload.data.tasks;
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  return [];
}

function taskStatusCode(task) {
  if (typeof task.statusCode === 'number') return task.statusCode;
  if (typeof task.status_code === 'number') return task.status_code;
  const s = String(task.status || '').toLowerCase();
  const map = {
    draft: -1,
    created: 0,
    accepted: 1,
    submitted: 2,
    rejected: 3,
    refused: 3,
    disputed: 4,
    complete: 6,
    closed: 7,
    close: 7,
    expired: 8,
    failed: 9,
  };
  if (s in map) return map[s];
  const n = Number(task.status);
  return Number.isFinite(n) ? n : null;
}

function collectSearchBlobs(task) {
  const blobs = [];
  for (const key of [
    'content', 'description', 'title', 'taskContent', 'task_content',
    'deliverable', 'requirement', 'requirements', 'payload', 'input',
    'message', 'detail', 'raw',
  ]) {
    if (task[key] != null) blobs.push(task[key]);
  }
  // Nested common shapes
  if (task.job) blobs.push(task.job);
  if (task.meta) blobs.push(task.meta);
  return blobs;
}

export function findFoundryJobInTask(task) {
  for (const blob of collectSearchBlobs(task)) {
    const found = extractFoundryJob(blob);
    if (found?.type) return found;
  }
  // Whole task object as last resort (when client embeds foundry_job at top-level)
  return extractFoundryJob(task);
}

export function createWorker(options = {}) {
  const {
    agentId = process.env.FOUNDRY_ASP_AGENT_ID || '',
    pollMs = Number(process.env.FOUNDRY_A2A_POLL_MS || 20_000),
    dataDir = process.env.FOUNDRY_A2A_DATA_DIR || join(process.cwd(), '.data', 'a2a'),
    dryRun = process.env.FOUNDRY_A2A_DRY_RUN === '1',
    once = false,
    logger = console,
    cli,
    store,
    runJob = runFoundryJob,
    notify = notifyHermes,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    webhookUrl = process.env.FOUNDRY_HERMES_WEBHOOK_URL || '',
    webhookSecret = process.env.FOUNDRY_HERMES_WEBHOOK_SECRET || '',
    filterAgentId = process.env.FOUNDRY_A2A_FILTER_AGENT_ID || '',
  } = options;

  const resolvedStore = store || new JobStore(join(dataDir, 'jobs.json'));
  const deliverableDir = join(dataDir, 'deliverables');
  const hermesQueueDir = join(dataDir, 'hermes-queue');
  const resolvedCli = cli || createOnchainosClient({ agentId });

  let stopped = false;
  let lastTick = null;
  let ticks = 0;
  let inFlight = false;

  async function ensureDirs() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(deliverableDir, { recursive: true });
    await mkdir(hermesQueueDir, { recursive: true });
  }

  async function mark(jobId, mutate) {
    return resolvedStore.update(jobId, (prev) => {
      const next = mutate({
        ...prev,
        job_id: jobId,
        updated_at: nowIso(),
      });
      return next;
    });
  }

  async function handleCreated(task, existing) {
    if (existing && TERMINAL.has(existing.status)) return existing;
    if (existing?.status === STATUS.WAITING_FOR_ACCEPTANCE) return existing;
    return mark(task.jobId, (prev) => ({
      ...prev,
      status: STATUS.WAITING_FOR_ACCEPTANCE,
      phase: null,
      title: task.title || prev.title || null,
      my_agent_id: task.myAgentId || prev.my_agent_id || null,
      counterparty_agent_id: task.counterpartyAgentId || prev.counterparty_agent_id || null,
      token_amount: task.tokenAmount || prev.token_amount || null,
      token_symbol: task.tokenSymbol || prev.token_symbol || null,
      raw_status: task.status,
      status_code: taskStatusCode(task),
      received_at: prev.received_at || nowIso(),
      note: 'Waiting for client confirm-accept (job_accepted). No work until accepted.',
    }));
  }

  async function handleAccepted(task, existing) {
    if (existing?.status === STATUS.DELIVERED) return existing;
    if (existing?.status === STATUS.PROCESSING) return existing;
    if (existing?.status === STATUS.NEEDS_HERMES && existing.hermes_notified_at) return existing;

    const foundryJob = findFoundryJobInTask(task);

    // ── Phase API: explicit foundry_job ──────────────────────────────
    if (foundryJob?.type) {
      await mark(task.jobId, (prev) => ({
        ...prev,
        status: STATUS.PROCESSING,
        phase: 'api',
        foundry_job: foundryJob,
        title: task.title || prev.title || null,
        my_agent_id: task.myAgentId || prev.my_agent_id || null,
        attempts: (prev.attempts || 0) + 1,
        processing_at: nowIso(),
      }));

      try {
        const result = await runJob(foundryJob);
        const file = await writeDeliverable({
          dir: deliverableDir,
          jobId: task.jobId,
          payload: {
            phase: 'api',
            foundry_job: foundryJob.type,
            result,
          },
        });

        const message = `Foundry API job "${foundryJob.type}" completed. Deliverable attached as JSON.`;
        if (!dryRun) {
          await resolvedCli.deliver({
            jobId: task.jobId,
            file,
            message,
            agentId: task.myAgentId || agentId,
          });
        }

        return mark(task.jobId, (prev) => ({
          ...prev,
          status: STATUS.DELIVERED,
          phase: 'api',
          deliverable_file: file,
          delivered_at: nowIso(),
          dry_run: dryRun,
          result_summary: {
            job_type: foundryJob.type,
            keys: result && typeof result === 'object' ? Object.keys(result).slice(0, 12) : [],
          },
        }));
      } catch (err) {
        logger.error?.('[foundry-a2a] API phase failed', { jobId: task.jobId, err: err.message });
        return mark(task.jobId, (prev) => ({
          ...prev,
          status: STATUS.FAILED,
          phase: 'api',
          error: err.message,
          failed_at: nowIso(),
        }));
      }
    }

    // ── Phase Agent: Hermes owns free-form / marketplace chat work ──
    const notifyResult = await notify({
      queueDir: hermesQueueDir,
      webhookUrl,
      webhookSecret,
      item: {
        job_id: task.jobId,
        title: task.title || null,
        my_agent_id: task.myAgentId || agentId || null,
        counterparty_agent_id: task.counterpartyAgentId || null,
        token_amount: task.tokenAmount || null,
        token_symbol: task.tokenSymbol || null,
        status: task.status,
        status_code: taskStatusCode(task),
        supported_api_jobs: SUPPORTED_A2A_JOBS,
        instruction:
          'OKX.AI ASP hire accepted. Load okx-ai skill (task-core + task-asp). '
          + 'Run onchainos agent next-action --role auto for this job, execute the returned script, '
          + 'do the real work, then deliver only after job_accepted. '
          + 'If the client provides a foundry_job JSON payload, re-queue for the Foundry API worker.',
        task,
      },
    });

    return mark(task.jobId, (prev) => ({
      ...prev,
      status: STATUS.NEEDS_HERMES,
      phase: 'agent',
      title: task.title || prev.title || null,
      my_agent_id: task.myAgentId || prev.my_agent_id || null,
      hermes_queue_file: notifyResult.file,
      hermes_webhook: notifyResult.webhook,
      hermes_notified_at: nowIso(),
      note: 'No explicit foundry_job payload — handed to Hermes agent phase.',
    }));
  }

  async function processTask(task) {
    const jobId = task.jobId || task.job_id || task.id;
    if (!jobId) return null;

    if (filterAgentId) {
      const mine = String(task.myAgentId || task.my_agent_id || '');
      if (mine && mine !== String(filterAgentId)) {
        return null;
      }
    }

    const code = taskStatusCode(task);
    const existing = await resolvedStore.get(jobId);

    // Track first sighting
    if (!existing) {
      await mark(jobId, (prev) => ({
        ...prev,
        status: STATUS.RECEIVED,
        title: task.title || null,
        my_agent_id: task.myAgentId || null,
        counterparty_agent_id: task.counterpartyAgentId || null,
        received_at: nowIso(),
        status_code: code,
        raw_status: task.status,
      }));
    }

    const current = existing || (await resolvedStore.get(jobId));

    // Already terminal — skip
    if (current && TERMINAL.has(current.status) && code !== 1) {
      // Allow re-processing only if newly accepted and previously waiting
      if (!(code === 1 && current.status === STATUS.WAITING_FOR_ACCEPTANCE)) {
        if (current.status === STATUS.DELIVERED || current.status === STATUS.NEEDS_HERMES) {
          return current;
        }
      }
    }

    if (code === 0) {
      return handleCreated(task, current);
    }

    if (code === 1) {
      // If already delivered, never re-deliver
      if (current?.status === STATUS.DELIVERED) return current;
      return handleAccepted(task, current);
    }

    // submitted / disputed / etc — track only
    if (code === 2) {
      return mark(jobId, (prev) => ({
        ...prev,
        status: prev.status === STATUS.DELIVERED ? STATUS.DELIVERED : STATUS.SKIPPED,
        raw_status: task.status,
        status_code: code,
        note: prev.note || 'Task already submitted on-chain.',
      }));
    }

    return mark(jobId, (prev) => ({
      ...prev,
      status: prev.status || STATUS.SKIPPED,
      raw_status: task.status,
      status_code: code,
      note: prev.note || `No action for status_code=${code}`,
    }));
  }

  async function tick() {
    if (inFlight) return lastTick;
    inFlight = true;
    const started = Date.now();
    const summary = {
      at: nowIso(),
      ok: true,
      seen: 0,
      acted: 0,
      errors: [],
      by_status: {},
    };
    try {
      await ensureDirs();
      const raw = await resolvedCli.activeTasks();
      const tasks = normalizeTasks(raw);
      summary.seen = tasks.length;

      for (const task of tasks) {
        try {
          const result = await processTask(task);
          if (result?.status) {
            summary.by_status[result.status] = (summary.by_status[result.status] || 0) + 1;
            if ([STATUS.DELIVERED, STATUS.NEEDS_HERMES, STATUS.PROCESSING, STATUS.FAILED].includes(result.status)
              && result.updated_at && Date.now() - Date.parse(result.updated_at) < pollMs * 2) {
              summary.acted += 1;
            }
          }
        } catch (err) {
          summary.errors.push({ jobId: task.jobId, error: err.message });
          logger.error?.('[foundry-a2a] task error', { jobId: task.jobId, err: err.message });
        }
      }
    } catch (err) {
      summary.ok = false;
      summary.errors.push({ error: err.message });
      logger.error?.('[foundry-a2a] tick failed', err.message);
    } finally {
      summary.duration_ms = Date.now() - started;
      ticks += 1;
      lastTick = summary;
      inFlight = false;
    }
    return summary;
  }

  async function run() {
    await ensureDirs();
    logger.info?.('[foundry-a2a] worker starting', {
      agentId: agentId || '(per-task myAgentId)',
      pollMs,
      dataDir,
      dryRun,
      supportedJobs: SUPPORTED_A2A_JOBS,
      filterAgentId: filterAgentId || '(all ASP tasks on this wallet)',
    });

    if (once) {
      const summary = await tick();
      logger.info?.('[foundry-a2a] once tick complete', summary);
      return summary;
    }

    while (!stopped) {
      await tick();
      if (stopped) break;
      await sleep(pollMs);
    }
    logger.info?.('[foundry-a2a] worker stopped');
  }

  function stop() {
    stopped = true;
  }

  function health() {
    return {
      running: !stopped,
      in_flight: inFlight,
      ticks,
      last_tick: lastTick,
      agent_id: agentId || null,
      dry_run: dryRun,
      poll_ms: pollMs,
      data_dir: dataDir,
      supported_api_jobs: SUPPORTED_A2A_JOBS,
      phases: ['api', 'agent'],
    };
  }

  return { run, stop, tick, health, store: resolvedStore };
}

// CLI entry: node src/a2a/worker.js [--once] [--dry-run]
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/src/a2a/worker.js')
  || process.argv[1].endsWith('\\src\\a2a\\worker.js')
);

if (isMain) {
  const once = process.argv.includes('--once');
  const dryRun = process.argv.includes('--dry-run') || process.env.FOUNDRY_A2A_DRY_RUN === '1';
  const worker = createWorker({ once, dryRun });
  const shutdown = () => {
    worker.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  worker.run().catch((err) => {
    console.error('[foundry-a2a] fatal', err);
    process.exit(1);
  });
}
