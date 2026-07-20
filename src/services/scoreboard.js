// src/services/scoreboard.js
//
// Public Foundry Verified scoreboard.
// Lists all ASPs that have been trust-verified via bootstrap-trust.
//
// Endpoints:
//   GET /v1/verified            — top verified ASPs
//   GET /v1/verified/:agentId   — check specific agent

import { supabase } from '../db/supabase.js';
import { loadLocalMarketplace } from '../db/localCache.js';
import { config } from '../config.js';

export async function getScoreboard({ limit = 20, min_score = 50 } = {}) {
  let data;
  try {
    const { data: rows } = await supabase
      .from('trust_receipts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
    if (rows && rows.length > 0) data = rows;
  } catch { /* fall through */ }

  if (!data || data.length === 0) {
    // No Supabase data — return empty with instructions
    return {
      ok: true,
      count: 0,
      verified: [],
      note: 'Supabase not configured or no receipts yet. Run bootstrap-trust on an endpoint to appear here.',
    };
  }

  const marketplace = loadLocalMarketplace();
  const agentMap = new Map((marketplace || []).map(a => [a.agent_id, a]));

  const verified = data
    .filter(r => r.schema_valid && r.http_ok)
    .slice(0, limit)
    .map((r, i) => {
      const agent = agentMap.get(r.caller_wallet) || {};
      return {
        rank: i + 1,
        agent_id: r.caller_wallet || r.agent_id || 'unknown',
        name: agent.name || r.service_name || 'Unknown',
        endpoint: r.endpoint,
        service: r.service_name,
        verified_at: r.created_at || r.signed_at,
        latency_ms: r.latency_ms,
        schema_valid: r.schema_valid,
        http_ok: r.http_ok,
        badge_url: `${config.publicUrl}/v1/badge/${r.id || 'pending'}.svg`,
      };
    });

  return { ok: true, count: verified.length, verified };
}

export async function checkAgent({ agentId }) {
  if (!agentId) throw new Error('agentId required');

  let data;
  try {
    const { data: rows } = await supabase
      .from('trust_receipts')
      .select('*')
      .eq('caller_wallet', agentId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (rows && rows.length > 0) data = rows;
  } catch { /* fall through */ }

  if (!data || data.length === 0) {
    return {
      ok: true,
      agent_id: agentId,
      verified: false,
      message: 'This agent has no Foundry Verified receipts. They can run bootstrap-trust to get verified.',
    };
  }

  const latest = data[0];
  return {
    ok: true,
    agent_id: agentId,
    verified: latest.schema_valid && latest.http_ok,
    foundry_verdict: latest.schema_valid && latest.http_ok
      ? 'VERIFIED'
      : latest.http_ok
      ? 'REACHABLE'
      : 'UNREACHABLE',
    endpoint: latest.endpoint,
    service: latest.service_name,
    verified_at: latest.created_at || latest.signed_at,
    latency_ms: latest.latency_ms,
    schema_valid: latest.schema_valid,
    receipts_count: data.length,
    badge_url: `${config.publicUrl}/v1/badge/${latest.id || 'pending'}.svg`,
  };
}
