// src/a2a/cli.js
// Narrow adapter around the official OKX CLI. Kept injectable for tests.

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export function createOnchainosClient({ binary = 'onchainos', agentId, exec = execFile } = {}) {
  async function run(args) {
    const { stdout, stderr } = await exec(binary, args, {
      timeout: 60_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const text = (stdout || '').trim();
    if (!text && stderr) {
      throw new Error(stderr.trim());
    }
    return text;
  }

  return {
    async activeTasks() {
      const output = await run(['agent', 'active-tasks', '--role', 'asp']);
      return JSON.parse(output);
    },
    async deliver({ jobId, file, message, agentId: overrideAgentId }) {
      const id = overrideAgentId || agentId;
      if (!id) throw new Error('agent id required for deliver (pass agentId or FOUNDRY_ASP_AGENT_ID)');
      return run([
        'agent', 'deliver', jobId,
        '--file', file,
        '--message', message,
        '--agent-id', String(id),
      ]);
    },
  };
}
