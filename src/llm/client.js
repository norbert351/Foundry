// src/llm/client.js
//
// Hybrid LLM client: Anthropic (primary, best quality) + Hermes (fallback, free).
// Other agents calling Foundry see a single reliable endpoint.
//
// Order: Anthropic first → if missing/429/5xx/error → Hermes → if both fail → stub.
// Both backends are interchangeable from the caller's perspective.

import { config } from '../config.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const HERMES_URL = process.env.HERMES_LLM_URL || 'http://localhost:11434/v1/chat';
const HERMES_MODEL = process.env.HERMES_LLM_MODEL || 'nous-hermes-2-mistral-7b';

// ─── Anthropic ──────────────────────────────────────────────────────────
async function callAnthropic({ system, user, json, maxTokens }) {
  if (!config.llm.apiKey) throw new Error('no_anthropic_key');
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.llm.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`anthropic_${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data?.content?.[0]?.text ?? '').trim();
}

// ─── Hermes (OpenAI-compatible local proxy, e.g. Ollama / llama.cpp / vLLM) ──
async function callHermes({ system, user, json, maxTokens }) {
  const r = await fetch(HERMES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`hermes_${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  // OpenAI-compatible: { choices: [{ message: { content } }] }
  return (data?.choices?.[0]?.message?.content ?? '').trim();
}

// ─── Public entry point ────────────────────────────────────────────────
export async function callLLM({ system, user, json = false, maxTokens = 500 }) {
  // 1. Try Anthropic first (best quality for the demo + production)
  if (config.llm.apiKey) {
    try {
      const t0 = Date.now();
      const text = await callAnthropic({ system, user, json, maxTokens });
      _recordLatency('anthropic', Date.now() - t0, true);
      return text;
    } catch (e) {
      _recordLatency('anthropic', 0, false);
      // Only fall through if the failure looks transient (5xx, network, missing key)
      // Don't fall through on 4xx — those are deterministic client errors
      if (!/anthropic_5\d\d|anthropic_429|no_anthropic_key|fetch failed|TypeError|Timeout/i.test(String(e.message))) {
        throw e;
      }
      // else: fall through to Hermes
      console.warn(`[llm] anthropic failed (${e.message.slice(0, 80)}), trying Hermes`);
    }
  }

  // 2. Try Hermes if available
  if (process.env.HERMES_LLM_URL || process.env.HERMES_ENABLED === '1') {
    try {
      const t0 = Date.now();
      const text = await callHermes({ system, user, json, maxTokens });
      _recordLatency('hermes', Date.now() - t0, true);
      return text;
    } catch (e) {
      _recordLatency('hermes', 0, false);
      console.warn(`[llm] hermes failed: ${e.message.slice(0, 80)}`);
    }
  }

  // 3. Stub (last resort — dev mode, no key)
  return json
    ? '{"reasoning":"LLM not configured — returning stub.","complexity":"medium"}'
    : 'LLM not configured. Set ANTHROPIC_API_KEY or HERMES_LLM_URL in env.';
}

// ─── Latency tracking (for /health) ────────────────────────────────────
const _latencies = { anthropic: { ok: 0, fail: 0, ms: 0 }, hermes: { ok: 0, fail: 0, ms: 0 } };
function _recordLatency(provider, ms, ok) {
  const b = _latencies[provider];
  if (!b) return;
  if (ok) { b.ok++; b.ms += ms; } else { b.fail++; }
}
export function getLlmStats() {
  const out = {};
  for (const [p, b] of Object.entries(_latencies)) {
    out[p] = {
      ok: b.ok,
      fail: b.fail,
      avg_ms: b.ok > 0 ? Math.round(b.ms / b.ok) : null,
    };
  }
  return out;
}
