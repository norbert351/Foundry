// src/a2a/jobs.js
//
// Explicit Foundry job router for OKX.AI A2A tasks.
// A task can be automated only when it includes one of:
//   { "foundry_job": "onboard", "input": { ... } }
//   { "foundry_job": { "type": "onboard", "input": { ... } } }
// This intentionally does not guess from natural-language task descriptions.

import {
  jobListDraft, jobAudit, jobMarketplaceWatch,
  jobPortfolioReview, jobOnboard, jobSLA, jobPortfolio,
} from '../services/jobs.js';

const JOB_HANDLERS = {
  'list-draft': jobListDraft,
  audit: jobAudit,
  'marketplace-watch': jobMarketplaceWatch,
  'portfolio-review': jobPortfolioReview,
  onboard: jobOnboard,
  sla: jobSLA,
  portfolio: jobPortfolio,
};

export const SUPPORTED_A2A_JOBS = Object.freeze(Object.keys(JOB_HANDLERS));

export function extractFoundryJob(value) {
  if (!value) return null;
  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const envelope = parsed.foundry_job ?? parsed.foundryJob;
  if (typeof envelope === 'string') {
    return { type: envelope, input: parsed.input ?? parsed.params ?? {} };
  }
  if (envelope && typeof envelope === 'object') {
    return {
      type: envelope.type ?? envelope.name,
      input: envelope.input ?? envelope.params ?? parsed.input ?? parsed.params ?? {},
    };
  }
  return null;
}

export async function runFoundryJob(job) {
  if (!job?.type || !JOB_HANDLERS[job.type]) {
    const supported = SUPPORTED_A2A_JOBS.join(', ');
    throw new Error(`Unsupported foundry_job. Supported types: ${supported}`);
  }
  if (!job.input || typeof job.input !== 'object' || Array.isArray(job.input)) {
    throw new Error('foundry_job input must be an object');
  }
  return JOB_HANDLERS[job.type](job.input);
}
