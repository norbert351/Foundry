// src/a2a/deliverable.js — write JSON deliverables for onchainos agent deliver

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeDeliverable({
  dir,
  jobId,
  payload,
  prefix = 'foundry',
}) {
  if (!dir) throw new Error('deliverable dir required');
  if (!jobId) throw new Error('jobId required');
  await mkdir(dir, { recursive: true });
  const safeId = String(jobId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const file = join(dir, `${prefix}-${safeId}-${Date.now()}.json`);
  const body = {
    foundry_version: '0.1.0',
    job_id: jobId,
    generated_at: new Date().toISOString(),
    result: payload,
  };
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
  return file;
}
