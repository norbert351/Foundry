// src/services/competitors.js
//
// Competitor Radar — free public endpoint.
// Returns top competitors in any category with similarity analysis.
//
// Input:  { category: string, limit?: number }
// Output: { category, seller_count, competitors: [...], insights }

import { loadLocalMarketplace } from '../db/localCache.js';

function tokens(s) {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function getCompetitors({ category, limit = 20, sortBy = 'sold' } = {}) {
  if (!category || typeof category !== 'string') {
    throw new Error('category required (e.g. FINANCE, SOFTWARE_SERVICES, ART_CREATION)');
  }

  const agents = loadLocalMarketplace();
  if (!agents || agents.length === 0) {
    return {
      error: 'no_data',
      message: 'Marketplace snapshot is empty. Run `pnpm scrape` first.',
      category,
    };
  }

  const cat = category.toUpperCase();
  const inCategory = agents.filter(a => (a.category || '').toUpperCase() === cat);
  const categoryTokens = tokens(cat);

  // Score each competitor
  const scored = inCategory
    .filter(a => a.name && a.service_min_price > 0)
    .map(a => {
      const nameSim = jaccard(categoryTokens, tokens(a.name));
      const descSim = jaccard(categoryTokens, tokens(a.description || ''));
      const relevance = Math.round(Math.max(nameSim, descSim) * 100);
      return {
        agent_id: a.agent_id,
        name: a.name,
        description: (a.description || '').slice(0, 200),
        category: a.category,
        fee: a.service_min_price,
        sold: a.sold_count || 0,
        rating: a.rating || null,
        online: a.online_status === 1,
        relevance_pct: relevance,
      };
    })
    .sort((a, b) => {
      if (sortBy === 'relevance') return b.relevance_pct - a.relevance_pct;
      if (sortBy === 'fee') return a.fee - b.fee;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return (b.sold || 0) - (a.sold || 0); // default: sold count
    })
    .slice(0, limit);

  const totalSold = inCategory.reduce((s, a) => s + (a.sold_count || 0), 0);
  const avgSold = inCategory.length > 0 ? Math.round(totalSold / inCategory.length) : 0;
  const prices = inCategory.map(a => a.service_min_price).filter(p => p > 0).sort((a, b) => a - b);
  const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0;

  return {
    category: cat,
    total_sellers: inCategory.length,
    total_sold: totalSold,
    avg_sold_per_seller: avgSold,
    median_fee_usdt: medianPrice,
    sort_by: sortBy,
    competitors: scored,
    tips: [
      scored.length === 0
        ? `No competitors found in "${cat}". This could be an untapped category — BUILD!`
        : scored.length < 5
        ? `Only ${scored.length} sellers in "${cat}" — low saturation, good entry point.`
        : `${scored.length} sellers in "${cat}". Median fee is ${medianPrice} USDT.`,
      avgSold > 0
        ? `Top sellers average ${avgSold} sales each.`
        : 'Few sales across this category — early mover advantage available.',
      scored[0]
        ? `Top competitor: "${scored[0].name}" at ${scored[0].fee} USDT, ${scored[0].sold} sales.`
        : 'No direct competitors yet.',
    ],
  };
}
