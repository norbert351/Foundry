// src/services/instantShip.js
//
// Instant Ship — one draft → ready-to-submit listing + CLI command.
// Runs : parse → validate → price → lint → trust → compose
//
// Input:  { draft: string, language?: string, endpoint?: string, fee?: string }
// Output: { listing, cli_command, verdict, recommended_fee, lint_score, trust_badge }

import { markdownToListing } from '../parser/markdownToListing.js';
import { lintListing } from './lintListing.js';
import { priceEstimator } from './priceEstimator.js';
import { validateIdea } from './validateIdea.js';
import { bootstrapTrust } from './bootstrapTrust.js';
import { callLLM } from '../llm/client.js';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

async function translateToEnglish(text, sourceLanguage) {
  if (!sourceLanguage || sourceLanguage.toLowerCase() === 'english' || sourceLanguage.toLowerCase() === 'en') {
    return text;
  }
  const out = await callLLM({
    system: 'You are a translator. Translate the following ASP (Agent Service Provider) idea to English while keeping all technical details, service names, and pricing information intact. Return ONLY the translated text, no commentary.',
    user: `Translate this ASP listing idea from ${sourceLanguage} to English:\n\n${text}`,
    maxTokens: 1000,
  });
  return out || text;
}

function buildCLICommands(listing, fee) {
  const name = (listing.name || 'MyAgent').replace(/[^a-zA-Z0-9 _-]/g, '');
  const desc = (listing.description || '').slice(0, 500);
  const services = (listing.services || []).map((s, i) => ({
    name: s.name || `Service ${i + 1}`,
    description: s.description || '',
    type: 'A2MCP',
    fee: fee || '0.01',
    endpoint: s.endpoint || '',
  }));

  return {
    pre_check: `onchainos agent pre-check --role asp`,
    upload_avatar: `onchainos agent upload --file ./logo.png`,
    create:
      `onchainos agent create --role asp --name "${name}" --description "${desc}"` +
      (services[0]?.endpoint ? ` --service-endpoint "${services[0].endpoint}"` : ''),
    service_add_commands: services.map((s, i) =>
      `Service ${i + 1}: "${s.name}" — ${s.description.slice(0, 80)} (fee: ${s.fee} USDT)`
    ),
    self_lint: `curl -X POST ${config.publicUrl}/v1/bootstrap-trust -H "Content-Type: application/json" -d '{"endpoint":"${services[0]?.endpoint || 'https://your-domain.com/v1/service'}","service_name":"${services[0]?.name || 'My Service'}"}'`,
  };
}

function buildHTMLBadge(agentId) {
  const badgeUrl = `${config.publicUrl}/v1/badge/${agentId}.svg`;
  return `<a href="${config.publicUrl}/v1/verified/${agentId}" target="_blank"><img src="${badgeUrl}" alt="Foundry Verified" height="44"/></a>`;
}

export async function instantShip({ draft, language, endpoint, fee }) {
  if (!draft || typeof draft !== 'string' || draft.trim().length < 5) {
    throw new Error('draft must be a non-empty string (≥5 chars)');
  }

  const t0 = Date.now();
  const results = {};

  // Step 0: Translate if needed
  const englishDraft = language ? await translateToEnglish(draft, language) : draft;
  results.original_language = language || 'english';
  results.translated = englishDraft !== draft ? englishDraft : undefined;

  // Step 1: Parse markdown → listing
  let parsed;
  try {
    parsed = await markdownToListing(englishDraft);
  } catch (e) {
    // If parse fails, treat raw draft as a fresh idea
    parsed = { listing: { name: 'MyASP', description: englishDraft.slice(0, 500), category: 'SOFTWARE_SERVICES', services: [] } };
  }
  const listing = parsed.listing;
  const finalPrice = fee || listing.services?.[0]?.fee || '0.01';

  // Step 2: Validate idea (non-blocking)
  try {
    results.validation = await validateIdea({ idea: listing.description || englishDraft, category: listing.category });
  } catch {
    results.validation = { verdict: 'BUILD', demand_score: 50, error: 'validation skipped' };
  }

  // Step 3: Price estimate
  try {
    results.pricing = await priceEstimator({ category: listing.category, idea: listing.description || englishDraft });
  } catch {
    results.pricing = { recommended_fee: 0.05, distribution: { median: 0.05 } };
  }

  // Step 4: Lint + auto-fix
  try {
    const lintResult = await lintListing({ listing, rewrite: true });
    results.lint = lintResult;
    if (lintResult.rewritten) {
      if (lintResult.rewritten.name) listing.name = lintResult.rewritten.name;
      if (lintResult.rewritten.description) listing.description = lintResult.rewritten.description;
    }
  } catch (e) {
    results.lint = { score: 50, pass: false, error: e.message };
  }

  // Step 5: Trust (optional — only if endpoint provided)
  if (endpoint) {
    try {
      results.trust = await bootstrapTrust({ endpoint, service_name: listing.services?.[0]?.name || listing.name, caller_wallet: 'instant-ship' });
    } catch (e) {
      results.trust = { error: e.message, foundry_verdict: 'NOT_CHECKED' };
    }
  }

  const shipId = createHash('sha256').update(draft + Date.now()).digest('hex').slice(0, 12);
  const recommendedFee = results.pricing?.recommended_fee || finalPrice;
  const cli = buildCLICommands(listing, recommendedFee);

  // Build the badge if trust was verified
  let badgeHTML = null;
  if (results.trust?.signature) {
    badgeHTML = buildHTMLBadge(shipId);
  }

  return {
    ship_id: shipId,
    duration_ms: Date.now() - t0,
    verdict: results.validation?.verdict || 'BUILD',
    demand_score: results.validation?.demand_score || 50,
    lint_score: results.lint?.score ?? 50,
    lint_pass: results.lint?.pass ?? false,
    recommended_fee: recommendedFee,
    trust_verdict: results.trust?.foundry_verdict || null,
    badge_html: badgeHTML,
    listing,
    cli_commands: cli,
    next_step: results.lint?.pass
      ? 'Your listing is ready. Run the pre-check, upload an avatar, then execute the create command above.'
      : `Fix ${results.lint?.findings?.filter(f => f.severity === 'block').length || 0} blocking issues, then re-run.`,
    services: (listing.services || []).map(s => ({
      name: s.name,
      fee: s.fee || recommendedFee,
      endpoint: s.endpoint || null,
      description: (s.description || '').slice(0, 200),
    })),
  };
}
