// test/a2a-worker.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWorker,
  STATUS,
  extractFoundryJob,
  findFoundryJobInTask,
  JobStore,
} from '../src/a2a/index.js';

describe('extractFoundryJob', () => {
  it('parses string envelope', () => {
    const job = extractFoundryJob(JSON.stringify({
      foundry_job: 'onboard',
      input: { draft: '# My ASP' },
    }));
    assert.equal(job.type, 'onboard');
    assert.equal(job.input.draft, '# My ASP');
  });

  it('parses nested object envelope', () => {
    const job = extractFoundryJob({
      foundry_job: { type: 'audit', input: { agent_id: '1', draft: 'x' } },
    });
    assert.equal(job.type, 'audit');
    assert.equal(job.input.agent_id, '1');
  });

  it('returns null for natural language', () => {
    assert.equal(extractFoundryJob('please lint my listing'), null);
  });
});

describe('findFoundryJobInTask', () => {
  it('finds job in description JSON', () => {
    const task = {
      jobId: '0xabc',
      description: JSON.stringify({ foundry_job: 'list-draft', input: { draft: 'hi' } }),
    };
    const job = findFoundryJobInTask(task);
    assert.equal(job.type, 'list-draft');
  });
});

describe('A2A worker two-phase flow', () => {
  let dir;
  let deliveries;
  let hermesNotices;
  let runCalls;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'foundry-a2a-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeWorker(tasks) {
    deliveries = [];
    hermesNotices = [];
    runCalls = [];
    return createWorker({
      agentId: '9999',
      dataDir: dir,
      dryRun: false,
      once: true,
      pollMs: 10,
      filterAgentId: '',   // test isolation — don't inherit from real env
      logger: { info() {}, error() {}, warn() {} },
      cli: {
        async activeTasks() {
          return { ok: true, data: { tasks } };
        },
        async deliver(args) {
          deliveries.push(args);
          return 'ok';
        },
      },
      runJob: async (job) => {
        runCalls.push(job);
        return { ok: true, type: job.type, echo: job.input };
      },
      notify: async (opts) => {
        hermesNotices.push(opts.item);
        // minimal real notify path using filesystem
        const { notifyHermes } = await import('../src/a2a/notify.js');
        return notifyHermes({
          queueDir: join(dir, 'hermes-queue'),
          item: opts.item,
        });
      },
    });
  }

  it('waits on created tasks and does not execute', async () => {
    const storePath = join(dir, 'jobs-created.json');
    const worker = createWorker({
      agentId: '9999',
      dataDir: dir,
      store: new JobStore(storePath),
      once: true,
      filterAgentId: '',   // test isolation
      logger: { info() {}, error() {} },
      cli: {
        async activeTasks() {
          return {
            data: {
              tasks: [{
                jobId: '0xcreated1',
                status: 'created',
                statusCode: 0,
                title: 'Optimize vault',
                myAgentId: '9999',
              }],
            },
          };
        },
        async deliver() { throw new Error('should not deliver'); },
      },
      runJob: async () => { throw new Error('should not run'); },
      notify: async () => { throw new Error('should not notify'); },
    });

    await worker.tick();
    const row = await worker.store.get('0xcreated1');
    assert.equal(row.status, STATUS.WAITING_FOR_ACCEPTANCE);
    assert.match(row.note, /confirm-accept/i);
  });

  it('API phase: accepted + foundry_job → run once → deliver', async () => {
    const jobId = '0xapi1';
    const worker = makeWorker([{
      jobId,
      status: 'accepted',
      statusCode: 1,
      title: 'Onboard me',
      myAgentId: '9999',
      description: JSON.stringify({
        foundry_job: 'onboard',
        input: { draft: '# Hello ASP' },
      }),
    }]);

    await worker.tick();
    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0].type, 'onboard');
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].jobId, jobId);
    assert.ok(deliveries[0].file);

    const row = await worker.store.get(jobId);
    assert.equal(row.status, STATUS.DELIVERED);
    assert.equal(row.phase, 'api');

    // idempotent: second tick must not re-run
    await worker.tick();
    assert.equal(runCalls.length, 1);
    assert.equal(deliveries.length, 1);
  });

  it('Agent phase: accepted without foundry_job → needs_hermes, no deliver', async () => {
    const jobId = '0xagent1';
    const worker = makeWorker([{
      jobId,
      status: 'accepted',
      statusCode: 1,
      title: 'Help me redesign my vault fees in plain English',
      myAgentId: '9999',
      description: 'Please advise on fee structure',
    }]);

    await worker.tick();
    assert.equal(runCalls.length, 0);
    assert.equal(deliveries.length, 0);
    assert.equal(hermesNotices.length, 1);
    assert.equal(hermesNotices[0].job_id, jobId);

    const row = await worker.store.get(jobId);
    assert.equal(row.status, STATUS.NEEDS_HERMES);
    assert.equal(row.phase, 'agent');
    assert.ok(row.hermes_queue_file);

    const queued = JSON.parse(await readFile(row.hermes_queue_file, 'utf8'));
    assert.equal(queued.phase, 'agent');
    assert.match(queued.instruction, /okx-ai/i);

    // second tick does not re-notify
    await worker.tick();
    assert.equal(hermesNotices.length, 1);
  });

  it('duplicate accepted events do not double-deliver', async () => {
    const jobId = '0xdup1';
    const tasks = [{
      jobId,
      status: 'accepted',
      statusCode: 1,
      myAgentId: '9999',
      content: { foundry_job: { type: 'portfolio', input: { agent_id: '42' } } },
    }];
    const worker = makeWorker(tasks);
    await worker.tick();
    await worker.tick();
    await worker.tick();
    assert.equal(runCalls.length, 1);
    assert.equal(deliveries.length, 1);
    const row = await worker.store.get(jobId);
    assert.equal(row.status, STATUS.DELIVERED);
  });
});
