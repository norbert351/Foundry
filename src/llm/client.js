// src/llm/client.js — minimal Anthropic wrapper
//
// We deliberately use a tiny client (no SDK) so the build is self-contained
// and we can swap providers (OpenAI, xAI) with one config change.

import { config } from '../config.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export async function callLLM({ system, user, json = false, maxTokens = 500 }) {
  if (!config.llm.apiKey) {
    // No key in dev: return a deterministic stub so the rest of the pipeline runs.
    return json
      ? '{"reasoning":"LLM key not configured — returning stub.","complexity":"medium"}'
      : 'LLM key not configured. Set ANTHROPIC_API_KEY in .env.';
  }
  if (config.llm.provider !== 'anthropic') {
    return `[unconfigured provider: ${config.llm.provider}]`;
  }

  const body = {
    model: config.llm.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (json) {
    // Anthropic doesn't have a strict json mode; we instruct in the system prompt.
    // The downstream JSON.parse handles partial JSON defensively.
  }

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.llm.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Anthropic ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  const text = data?.content?.[0]?.text ?? '';
  return text.trim();
}
