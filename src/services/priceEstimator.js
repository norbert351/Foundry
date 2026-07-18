// src/services/priceEstimator.js
//
// Service 2: price-estimator
// Input:  { category?: string, idea?: string, expected_volume_per_day?: number }
// Output: { p25, median, p75, min, max, sample_size, recommended_fee, rationale }

import { supabase } from '../db/supabase.js';
import { loadLocalMarketplace } from '../db/localCache.js';
import { callLLM } from '../llm/client.js';

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const idx = Math.min(arr.length - 1, Math.floor((arr.length - 1) * p));
  return arr[idx];
}

export async function priceEstimator({ category, idea, expected_volume_per_day }) {
  let data = [];
  let dataSource = 'no_data';
  try {
    const table = await supabase.from('latest_marketplace');
    const { data: rows } = await table
      .select('agent_id, name, category, service_min_price, sold_count, total_service_count')
      .gt('service_min_price', 0)
      .limit(1000);
    if (rows && rows.length > 0) { data = rows; dataSource = 'marketplace_snapshot'; }
  } catch { /* fall through */ }
  if (data.length === 0) {
    const local = loadLocalMarketplace();
    if (local.length > 0) { data = local; dataSource = 'local_cache'; }
  }

  let all = data;
  if (category) {
    const filtered = all.filter((a) => (a.category || '').toUpperCase() === category.toUpperCase());
    if (filtered.length >= 5) all = filtered;
  }

  const prices = all.map((a) => a.service_min_price).sort((a, b) => a - b);
  if (prices.length === 0) {
    return {
      error: 'no_marketplace_data',
      message: 'Marketplace snapshot is empty. Run `pnpm scrape` to seed.',
      sample_size: 0,
      foundry_recommendation: 'Once data is in, this returns p25/median/p75 + a recommended fee for your service.',
    };
  }

  const p25 = +pct(prices, 0.25).toFixed(4);
  const median = +pct(prices, 0.5).toFixed(4);
  const p75 = +pct(prices, 0.75).toFixed(4);
  const min = prices[0];
  const max = prices[prices.length - 1];

  let complexity = 'medium';
  if (idea) {
    const out = await callLLM({
      system: 'You are a pricing analyst. Given an ASP idea, judge its complexity for pricing purposes. Return JSON: {"complexity": "low|medium|high", "rationale": "<= 160 chars"}. No prose outside JSON.',
      user: idea,
      json: true,
      maxTokens: 200,
    });
    try {
      const j = JSON.parse(out);
      complexity = j.complexity || 'medium';
    } catch { /* ignore */ }
  }

  let recommended = median;
  let rationale = `At market median (${median} USDT).`;
  if (complexity === 'high' && idea) {
    recommended = p75;
    rationale = `High-complexity idea at p75 (${p75} USDT). Buyers pay a premium for reasoning services.`;
  } else if (complexity === 'low' && idea) {
    recommended = Math.max(p25, 0.001);
    rationale = `Low-complexity idea at p25 (${p25} USDT). Compete on volume, not price.`;
  } else if (expected_volume_per_day && expected_volume_per_day >= 100) {
    recommended = p25;
    rationale = `High-volume service (${expected_volume_per_day}/day) at p25 (${p25} USDT). Optimize for call count.`;
  } else if (expected_volume_per_day && expected_volume_per_day < 5) {
    recommended = Math.min(median * 1.5, max);
    rationale = `Low-volume service — price at 1.5× median (${recommended} USDT) to compensate.`;
  }

  let projection = null;
  if (expected_volume_per_day) {
    projection = {
      calls_per_day: expected_volume_per_day,
      gross_per_day_usdt: +(recommended * expected_volume_per_day).toFixed(4),
      gross_per_month_usdt: +(recommended * expected_volume_per_day * 30).toFixed(2),
    };
  }

  return {
    sample_size: prices.length,
    category: category || 'all',
    data_source: dataSource,
    distribution: { min: +min.toFixed(4), p25, median, p75, max: +max.toFixed(4) },
    recommended_fee: +recommended.toFixed(4),
    complexity,
    rationale,
    revenue_projection: projection,
    nearest_competitors: all
      .map((a) => ({ name: a.name, price: a.service_min_price, sold: a.sold_count }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 3),
  };
}
