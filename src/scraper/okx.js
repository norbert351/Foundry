// src/scraper/okx.js — scrape OKX.AI marketplace listings via onchainos CLI
//
// We use the `onchainos agent search` CLI (the same one yieldguard uses)
// instead of fabricating HTTP endpoints. The CLI handles auth, pagination,
// and rate-limiting for us. The output is parsed into the same shape the
// downstream services expect.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase } from '../db/supabase.js';
import { writeLocalMarketplace } from '../db/localCache.js';

const exec = promisify(execFile);

const CATEGORIES = [
  'FINANCE', 'SOFTWARE_SERVICES', 'LIFESTYLE', 'ART_CREATION',
  'EDUCATION', 'PRODUCTIVITY', 'SOCIAL',
];

// We don't need a query — pass empty string and filter by category on our side.
// A single `search` with no query returns the most recent / popular agents
// across all categories. To get good coverage we do N searches: one empty +
// one per category keyword.
// Skip the empty-string query — onchainos rejects it.
const SEARCH_QUERIES = [
  'agent', 'service', 'api', 'data', 'analysis', 'yield', 'price', 'image',
  'finance', 'crypto', 'stock', 'news', 'sentiment', 'translation',
  'invoice', 'payroll', 'receipt', 'wallet', 'nft', 'art', 'music',
  'ai', 'bot', 'chart', 'trade', 'swap', 'bridge', 'mint', 'deploy',
];

async function searchOnce(query, page = 1, pageSize = 50) {
  try {
    const args = ['agent', 'search', '--query', query, '--page', String(page), '--page-size', String(pageSize)];
    const { stdout } = await exec('onchainos', args, { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 });
    const data = JSON.parse(stdout);
    if (data?.data?.list) return data.data.list;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.warn(`[scraper] search "${query}" p${page} failed: ${e.message.slice(0, 100)}`);
    return [];
  }
}

function normalizeAgent(raw) {
  return {
    agent_id: String(raw.agentId ?? raw.id ?? ''),
    name: raw.name ?? '',
    category: (raw.categoryCode?.[0] ?? raw.category ?? '').toString(),
    description: raw.profileDescription ?? raw.description ?? '',
    service_min_price: parseFloat(raw.serviceMinPrice ?? raw.lowestFee ?? 0) || 0,
    total_service_count: raw.totalServiceCount ?? raw.services?.length ?? 0,
    sold_count: raw.soldCount ?? 0,
    rating: raw.feedbackRate ?? null,
    online_status: raw.onlineStatus ?? 0,
    raw,
  };
}

export async function scrapeAll() {
  const seen = new Map();
  for (const q of SEARCH_QUERIES) {
    let page = 1;
    while (page <= 3) {
      const list = await searchOnce(q, page, 50);
      if (list.length === 0) break;
      for (const r of list) {
        const n = normalizeAgent(r);
        if (n.agent_id && !seen.has(n.agent_id)) seen.set(n.agent_id, n);
      }
      if (list.length < 50) break;
      page++;
    }
  }
  const agents = Array.from(seen.values());
  console.log(`[scraper] collected ${agents.length} unique agents across ${SEARCH_QUERIES.length} queries`);
  return agents;
}

export async function persistSnapshot(agents) {
  // Always write to local cache so the rest of the app works without a DB
  if (agents.length > 0) writeLocalMarketplace(agents);
  if (agents.length === 0) return { inserted: 0, latest: 0, skipped: 'empty' };
  const scrapedAt = new Date().toISOString();
  try {
    const { error: snapErr } = await supabase
      .from('marketplace_snapshot')
      .insert(agents.map((a) => ({ ...a, scraped_at: scrapedAt })));
    if (snapErr) throw new Error(`snapshot: ${snapErr.message}`);
    const latestRows = agents.map((a) => ({
      agent_id: a.agent_id, name: a.name, category: a.category,
      description: a.description, service_min_price: a.service_min_price,
      total_service_count: a.total_service_count, sold_count: a.sold_count,
      rating: a.rating, online_status: a.online_status, raw: a.raw,
      updated_at: scrapedAt,
    }));
    const { error: latestErr } = await supabase
      .from('latest_marketplace')
      .upsert(latestRows, { onConflict: 'agent_id' });
    if (latestErr) throw new Error(`latest: ${latestErr.message}`);
    return { inserted: agents.length, latest: agents.length };
  } catch (e) {
    console.warn(`[scraper] Supabase persist skipped (local cache still written): ${e.message.slice(0, 120)}`);
    return { inserted: agents.length, latest: agents.length, db_skipped: true };
  }
}
