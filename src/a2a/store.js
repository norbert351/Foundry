// src/a2a/store.js
// File-backed job state keeps worker restarts and duplicate marketplace events safe.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY_STATE = { jobs: {} };

export class JobStore {
  constructor(path) {
    this.path = path;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.jobs ? parsed : structuredClone(EMPTY_STATE);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY_STATE);
      throw error;
    }
  }

  async get(jobId) {
    const state = await this.read();
    return state.jobs[jobId] ?? null;
  }

  async update(jobId, mutate) {
    let result;
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      const previous = state.jobs[jobId] ?? { job_id: jobId, attempts: 0 };
      result = mutate(structuredClone(previous));
      state.jobs[jobId] = result;
      await this.write(state);
    });
    await this.writeQueue;
    return result;
  }

  async write(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporary, this.path);
  }
}
