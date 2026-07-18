// src/services/validateIdea.js
//
// Service 1: validate-idea
// Input:  { idea: string, category?: string }
// Output: { verdict: 'BUILD'|'MAYBE'|'KILL', demand_score, competition_map, rationale }

import { supabase } from '../db/supabase.js';
import { loadLocalMarketplace } from '../db/localCache.js';
import { callLLM } from '../llm/client.js';

const SIMILARITY_STOP = new Set([
  'a', 'an', 'and', 'or', 'the', 'for', 'to', 'of', 'in', 'on', 'at',
  'with', 'is', 'it', 'this', 'that', 'be', 'as', 'by', 'an', 'agent', 'asp', 'service',
]);

function tokens(s) {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !SIMILARITY_STOP.has(t))
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function validateIdea({ idea, category }) {
  if (!idea || typeof idea !== 'string' || idea.trim().length < 5) {
    throw new Error('idea must be a non-empty string (≥5 chars)');
  }

  // Try Supabase first; fall back to local cache from scraper
  let agents = [];
  let dataSource = 'no_data';
  try {
    const table = await supabase.from('latest_marketplace');
    const { data } = await table
      .select('agent_id, name, category, description, service_min_price, sold_count, rating')
      .limit(500);
    if (data && data.length > 0) {
      agents = data;
      dataSource = 'marketplace_snapshot';
    }
  } catch { /* fall through to local */ }
  if (agents.length === 0) {
    const local = loadLocalMarketplace();
    if (local.length > 0) {
      agents = local;
      dataSource = 'local_cache';
    }
  }

  const ideaTokens = tokens(idea);
  const inCategory = category
    ? agents.filter((a) => (a.category || '').toUpperCase() === category.toUpperCase())
    : agents;

  const scored = inCategory
    .map((a) => ({
      ...a,
      _sim: Math.max(jaccard(ideaTokens, tokens(a.name)), jaccard(ideaTokens, tokens(a.description))),
    }))
    .sort((a, b) => b._sim - a._sim)
    .slice(0, 5);

  const sellerCount = inCategory.length;
  const totalSold = inCategory.reduce((s, a) => s + (a.sold_count || 0), 0);
  const avgSoldPerSeller = sellerCount > 0 ? Math.round(totalSold / sellerCount) : 0;
  const priceStats = inCategory
    .map((a) => a.service_min_price)
    .filter((p) => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b);
  const medianPrice = priceStats.length ? priceStats[Math.floor(priceStats.length / 2)] : 0;

  const gap = Math.max(0, 100 - Math.min(sellerCount * 4, 100));
  const activity = Math.min(30, Math.round(avgSoldPerSeller / 10));
  const saturation = Math.min(30, Math.round(scored[0]?._sim * 100));
  const demandScore = Math.min(100, Math.round(gap * 0.5 + activity * 0.3 + saturation * 0.2));

  let verdict = 'BUILD';
  if (demandScore < 25) verdict = 'KILL';
  else if (demandScore < 55) verdict = 'MAYBE';

  // LLM rationale
  const llmOut = await callLLM({
    system:
      'You are an OKX.AI marketplace analyst. Given a new ASP idea, the closest existing sellers, and category stats, return STRICT JSON: {"novelty": "high|medium|low", "reasoning": "<= 240 chars", "risks": ["<short>"], "next_steps": ["<short>"]}. No prose outside the JSON.',
    user: JSON.stringify({
      idea,
      category: category || 'unspecified',
      sellerCount,
      medianPrice,
      avgSoldPerSeller,
      top3_competitors: scored.slice(0, 3).map((s) => ({
        name: s.name,
        description: (s.description || '').slice(0, 120),
        sold: s.sold_count,
        price: s.service_min_price,
        similarity: Math.round(s._sim * 100),
      })),
    }),
    json: true,
    maxTokens: 400,
  });

  let llm = {};
  try { llm = JSON.parse(llmOut); } catch { llm = { reasoning: llmOut.slice(0, 240) }; }

  return {
    verdict,
    demand_score: demandScore,
    category: category || null,
    market: {
      seller_count: sellerCount,
      total_sold: totalSold,
      avg_sold_per_seller: avgSoldPerSeller,
      median_price_usdt: medianPrice,
      data_source: dataSource,
    },
    competition_map: scored.map((s) => ({
      agent_id: s.agent_id,
      name: s.name,
      description: (s.description || '').slice(0, 200),
      sold_count: s.sold_count,
      min_price: s.service_min_price,
      similarity_pct: Math.round(s._sim * 100),
    })),
    llm: {
      novelty: llm.novelty || 'unknown',
      reasoning: llm.reasoning || '',
      risks: llm.risks || [],
      next_steps: llm.next_steps || [],
    },
    foundry_recommendation:
      sellerCount === 0
        ? 'No marketplace data yet. Run `pnpm scrape` to populate the snapshot, then re-run validate-idea for a real verdict.'
        : verdict === 'BUILD'
        ? `Build it. ${sellerCount} sellers, ${avgSoldPerSeller} avg sales/seller. Ship in the next 5 days.`
        : verdict === 'MAYBE'
        ? `Reposition before building. ${sellerCount} sellers and ${scored[0]?.name || 'top competitor'} are already in this lane.`
        : `Skip it. ${sellerCount} sellers and saturation=${Math.round(scored[0]?._sim * 100)}%. Find a different angle.`,
  };
}
