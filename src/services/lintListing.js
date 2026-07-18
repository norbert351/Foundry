// src/services/lintListing.js
//
// Service 3: lint-listing
// Input:  { listing: { name, description, services: [{name, description, type, fee, endpoint?}] } }
// Output: { score, findings: [...], rewritten: {name?, description?, service_descriptions?: string[]} }
//
// This is the core of Foundry. We apply the OKX review rules we learned
// from accepted listings (PixelBrief, CoinWM, Newsliquid, Barker, ScoutGate)
// plus an LLM rewriter that fixes description issues in place.

import { supabase } from '../db/supabase.js';
import { callLLM } from '../llm/client.js';

const CELEBRITY_SUBSTRINGS = [
  'trump', 'biden', 'obama', 'musk', 'bezos', 'gates', 'zuckerberg',
  'cz', 'sbf', 'do kwon', 'vitalik', 'satoshi',
];

function str(v) { return typeof v === 'string' ? v : ''; }
function len(v) { return str(v).length; }

function checkIdentity(name, description) {
  const findings = [];
  const nm = str(name).trim();

  if (nm.length === 0) {
    findings.push({ field: 'name', code: 'NAME_EMPTY', severity: 'block', issue: 'Name is required', fix: 'Add a 3–25 char brand name' });
  } else if (nm.length < 3 || nm.length > 25) {
    findings.push({ field: 'name', code: 'NAME_LENGTH', severity: 'block', issue: `Name is ${nm.length} chars (must be 3–25)`, fix: nm.length < 3 ? `Expand to 3+ chars (e.g. "${nm} ASP")` : `Shorten to ≤25 chars` });
  }
  if (/test|demo|sample/i.test(nm)) {
    findings.push({ field: 'name', code: 'NAME_TEST_MARKER', severity: 'block', issue: 'Name contains "test/demo/sample" — OKX rejects', fix: 'Rename to a real brand' });
  }
  const nmLow = nm.toLowerCase();
  for (const celeb of CELEBRITY_SUBSTRINGS) {
    if (nmLow.includes(celeb)) {
      findings.push({ field: 'name', code: 'NAME_CELEBRITY', severity: 'block', issue: `Name contains public-figure name "${celeb}"`, fix: 'Choose a different brand name' });
      break;
    }
  }

  const desc = str(description).trim();
  if (desc.length === 0) {
    findings.push({ field: 'description', code: 'DESC_EMPTY', severity: 'block', issue: 'Description is required', fix: 'Add a 30–500 char one-line summary' });
  } else if (desc.length < 30) {
    findings.push({ field: 'description', code: 'DESC_SHORT', severity: 'block', issue: `Description is ${desc.length} chars (min 30)`, fix: 'Expand with who the agent is for and what it does' });
  } else if (desc.length > 500) {
    findings.push({ field: 'description', code: 'DESC_LONG', severity: 'block', issue: `Description is ${desc.length} chars (max 500)`, fix: 'Trim to the most important sentence' });
  }

  return findings;
}

function checkService(svc, idx) {
  const findings = [];
  const sName = str(svc.name).trim();
  const sDesc = str(svc.description).trim();
  const f = `service[${idx}]`;

  if (sName.length === 0) {
    findings.push({ field: `${f}.name`, code: 'SVC_NAME_EMPTY', severity: 'block', issue: 'Service name is required', fix: 'Add a 5–30 char noun phrase' });
  } else {
    if (sName.length < 5 || sName.length > 30) {
      findings.push({ field: `${f}.name`, code: 'SVC_NAME_LENGTH', severity: 'block', issue: `Service name is ${sName.length} chars (must be 5–30)`, fix: sName.length < 5 ? 'Expand to 5+ chars' : 'Shorten to ≤30 chars' });
    }
    if (/\d+\s*usdt|\d+\s*usd|\$\d/i.test(sName)) {
      findings.push({ field: `${f}.name`, code: 'SVC_NAME_PRICE', severity: 'block', issue: 'Service name contains a price', fix: 'Remove the price from the name — fee is a separate field' });
    }
  }

  if (sDesc.length === 0) {
    findings.push({ field: `${f}.description`, code: 'SVC_DESC_EMPTY', severity: 'block', issue: 'Service description is required', fix: 'Add a 2-part description: (1) core capability + audience, (2) what the user provides' });
  } else {
    // Two-part structure check — look for "1." or "①" or newline split
    const hasPart1 = sDesc.length > 20;
    const hasPart2 = /(^|\n)\s*(1\.|①|2\.|②|[•\-\*]\s*user must|user provides|user needs|please provide|caller must|required:|输入|请提供|用户需提供)/i.test(sDesc);
    if (!hasPart2) {
      findings.push({ field: `${f}.description`, code: 'SVC_DESC_NO_INPUT_SPEC', severity: 'warn', issue: 'Missing the "what the user must provide" half of the 2-part description', fix: 'Add a second line: "1. <field> 2. <field>" or "User must provide: <field>"' });
    }
    if (sDesc.length > 400) {
      findings.push({ field: `${f}.description`, code: 'SVC_DESC_LONG', severity: 'block', issue: `Service description is ${sDesc.length} chars (max 400)`, fix: 'Trim' });
    }
    if (/github\.com|twitter\.com|\bx\.com\/[a-zA-Z0-9_]+|0x[0-9a-fA-F]{40}/i.test(sDesc)) {
      findings.push({ field: `${f}.description`, code: 'SVC_DESC_LINKS', severity: 'block', issue: 'Service description contains external links or wallet addresses', fix: 'Remove links; OKX policy disallows them' });
    }
    if (/\b(wallet\s+address|contract\s+address|CA:|token\s+address)\b/i.test(sDesc)) {
      findings.push({ field: `${f}.description`, code: 'SVC_DESC_WALLET_ADDR', severity: 'warn', issue: 'Service description mentions wallet/contract addresses', fix: 'Move address handling to a separate input field; the description should describe the service, not include addresses' });
    }
    if (/disclaimer|not financial advice|dyor|do your own research|no liability/i.test(sDesc)) {
      findings.push({ field: `${f}.description`, code: 'SVC_DESC_DISCLAIMER', severity: 'warn', issue: 'Service description contains legal disclaimer', fix: 'Move disclaimer to a separate "terms" field; OKX review prefers clean descriptions' });
    }
  }

  if (svc.type !== 'A2MCP' && svc.type !== 'A2A') {
    findings.push({ field: `${f}.type`, code: 'SVC_TYPE_INVALID', severity: 'block', issue: 'Type must be A2MCP (API service) or A2A (agent-to-agent)', fix: 'Use A2MCP for paid API services, A2A for agent-to-agent' });
  }
  if (svc.type === 'A2MCP' && (svc.fee === undefined || svc.fee === null || svc.fee === '')) {
    findings.push({ field: `${f}.fee`, code: 'SVC_FEE_REQUIRED', severity: 'block', issue: 'API service requires a fee', fix: 'Set fee as a number string, e.g. "0.01"' });
  }
  if (typeof svc.fee === 'string' && /\b(usdt|usd|usdc)\b/i.test(svc.fee)) {
    findings.push({ field: `${f}.fee`, code: 'SVC_FEE_HAS_SYMBOL', severity: 'block', issue: 'Fee value includes a currency symbol (USDT/USD/USDC)', fix: 'Send a plain number, e.g. "0.01". OKX defaults to USDT' });
  }

  if (svc.type === 'A2MCP') {
    const ep = str(svc.endpoint);
    if (ep.length === 0) {
      findings.push({ field: `${f}.endpoint`, code: 'SVC_ENDPOINT_REQUIRED', severity: 'block', issue: 'API service requires an endpoint URL', fix: 'Provide a public https:// URL' });
    } else {
      if (!/^https:\/\//.test(ep)) {
        findings.push({ field: `${f}.endpoint`, code: 'SVC_ENDPOINT_NOT_HTTPS', severity: 'block', issue: 'Endpoint must be https://', fix: 'Use https:// (not http://)' });
      }
      if (ep.length > 512) {
        findings.push({ field: `${f}.endpoint`, code: 'SVC_ENDPOINT_TOO_LONG', severity: 'block', issue: `Endpoint is ${ep.length} chars (max 512)`, fix: 'Use a shorter URL' });
      }
      if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.|\.local|\.internal/i.test(ep)) {
        findings.push({ field: `${f}.endpoint`, code: 'SVC_ENDPOINT_PRIVATE', severity: 'block', issue: 'Endpoint points to localhost or a private network', fix: 'Deploy to a public host (Render, Railway, Fly, etc.)' });
      }
      if (/vercel\.app$|netlify\.app$|herokuapp\.com$/i.test(ep)) {
        findings.push({ field: `${f}.endpoint`, code: 'SVC_ENDPOINT_SUSPICIOUS_HOST', severity: 'warn', issue: 'Endpoint uses a free hosting domain that OKX reviewers often reject', fix: 'Use a custom domain or Render/Fly' });
      }
    }
  }

  return findings;
}

function checkCategory(cat) {
  const findings = [];
  const valid = ['FINANCE', 'SOFTWARE_SERVICES', 'LIFESTYLE', 'ART_CREATION', 'EDUCATION', 'PRODUCTIVITY', 'SOCIAL'];
  if (!cat) {
    findings.push({ field: 'category', code: 'CATEGORY_MISSING', severity: 'block', issue: 'Category is required', fix: `Pick one of: ${valid.join(', ')}` });
  } else if (!valid.includes(String(cat).toUpperCase())) {
    findings.push({ field: 'category', code: 'CATEGORY_INVALID', severity: 'block', issue: `Unknown category "${cat}"`, fix: `Use one of: ${valid.join(', ')}` });
  }
  return findings;
}

function computeScore(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'block') score -= 15;
    else if (f.severity === 'warn') score -= 5;
  }
  return Math.max(0, score);
}

async function generateRewrite(field, value, findings) {
  const issues = findings.map((f) => `- ${f.code}: ${f.issue} → fix: ${f.fix}`).join('\n');
  const out = await callLLM({
    system: `You rewrite OKX.AI listing fields to pass review. Given the current value and the list of issues, return STRICT JSON: {"${field}": "<rewritten value>"}. Rules: ${field === 'name' ? '3-25 chars, brand name, no celebrities/test markers' : '≤500 chars for identity, ≤400 chars for service, no external links, no disclaimers'}. Do not invent claims. Keep the same intent.`,
    user: `Field: ${field}\nCurrent value: ${value}\n\nIssues to fix:\n${issues}\n\nReturn only the JSON.`,
    json: true,
    maxTokens: 600,
  });
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export async function lintListing({ listing, rewrite = true }) {
  if (!listing || typeof listing !== 'object') throw new Error('listing object required');

  const findings = [
    ...checkIdentity(listing.name, listing.description),
    ...checkCategory(listing.category),
    ...((listing.services || []).flatMap((s, i) => checkService(s, i))),
  ];

  const score = computeScore(findings);

  const rewritten = {};
  if (rewrite) {
    const identityFindings = findings.filter((f) => ['name', 'description'].includes(f.field));
    if (identityFindings.length > 0 && str(listing.name).length > 0) {
      const r = await generateRewrite('name', str(listing.name), identityFindings.filter((f) => f.field === 'name'));
      if (r?.name) rewritten.name = r.name;
    }
    if (identityFindings.some((f) => f.field === 'description') && str(listing.description).length > 0) {
      const r = await generateRewrite('description', str(listing.description), identityFindings.filter((f) => f.field === 'description'));
      if (r?.description) rewritten.description = r.description;
    }
    const svcFindings = findings.filter((f) => f.field.startsWith('service[') && f.field.endsWith('.description'));
    if (svcFindings.length > 0 && Array.isArray(listing.services)) {
      rewritten.service_descriptions = [];
      for (let i = 0; i < listing.services.length; i++) {
        const sDesc = str(listing.services[i].description);
        if (!sDesc) { rewritten.service_descriptions.push(null); continue; }
        const myFindings = findings.filter((f) => f.field === `service[${i}].description`);
        if (myFindings.length === 0) { rewritten.service_descriptions.push(null); continue; }
        const r = await generateRewrite('description', sDesc, myFindings);
        rewritten.service_descriptions.push(r?.description || null);
      }
    }
  }

  // Persist for analytics
  try {
    await supabase.from('lint_runs').insert({
      agent_id: listing.agent_id || null,
      listing: { ...listing, rewritten: undefined },
      score,
      findings,
      rewritten,
    });
  } catch (e) {
    // Don't fail the request if persistence fails
    console.warn('[lint] persist failed:', e.message);
  }

  return {
    score,
    pass: score >= 85 && !findings.some((f) => f.severity === 'block'),
    findings,
    rewritten,
    summary: {
      block_count: findings.filter((f) => f.severity === 'block').length,
      warn_count: findings.filter((f) => f.severity === 'warn').length,
      next_step:
        score >= 95 ? 'Ship it. Listing is review-ready.' :
        score >= 85 ? 'Apply the rewrites below and resubmit.' :
        score >= 60 ? 'Significant issues. Apply all rewrites and rerun lint.' :
        'Listing has structural problems. Rebuild from scratch using an accepted listing as a template.',
    },
  };
}
