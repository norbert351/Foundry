// src/a2a/notify.js — hand agent-phase jobs to Hermes (webhook + local queue)

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';

/**
 * Persist a Hermes work item + optionally POST a Hermes webhook.
 * Hermes (via okx-a2a gateway plugin + cron watcher) owns agent-phase execution.
 */
export async function notifyHermes({
  queueDir,
  webhookUrl,
  webhookSecret,
  item,
  fetchImpl = globalThis.fetch,
}) {
  if (!queueDir) throw new Error('queueDir required');
  await mkdir(queueDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jobKey = String(item.job_id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const file = join(queueDir, `${stamp}-${jobKey}.json`);
  const envelope = {
    source: 'foundry-a2a-worker',
    phase: 'agent',
    created_at: new Date().toISOString(),
    ...item,
  };
  await writeFile(file, JSON.stringify(envelope, null, 2), 'utf8');

  // Append to a simple inbox index Hermes cron can tail.
  await appendFile(
    join(queueDir, 'inbox.jsonl'),
    `${JSON.stringify({ file, job_id: item.job_id, at: envelope.created_at })}\n`,
    'utf8',
  );

  let webhook = { attempted: false, ok: false };
  if (webhookUrl) {
    webhook.attempted = true;
    const body = JSON.stringify(envelope);
    const headers = {
      'content-type': 'application/json',
      'x-foundry-event': 'a2a.needs_hermes',
    };
    if (webhookSecret) {
      const sig = createHmac('sha256', webhookSecret).update(body).digest('hex');
      headers['x-hub-signature-256'] = `sha256=${sig}`;
    }
    try {
      const res = await fetchImpl(webhookUrl, { method: 'POST', headers, body });
      webhook.ok = res.ok;
      webhook.status = res.status;
    } catch (err) {
      webhook.ok = false;
      webhook.error = err.message;
    }
  }

  return { file, webhook };
}
