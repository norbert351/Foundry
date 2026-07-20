// src/config.js — env loader
import 'dotenv/config';

const required = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
};

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`,
  supabase: {
    url: required('SUPABASE_URL'),
    key: required('SUPABASE_KEY'),
  },
  xlayer: {
    rpc: process.env.X_LAYER_RPC || 'https://rpc.xlayer.tech',
    chainId: parseInt(process.env.CHAIN_ID || '196', 10),
    usdtToken: process.env.USDT_TOKEN || '0x779ded0c9e1022225f8e0630b35a9b54be713736',
    foundryWalletPk: process.env.FOUNDRY_WALLET_PK || '',
  },
  llm: {
    provider: process.env.LLM_PROVIDER || 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-5',
  },
  a2a: {
    agentId: process.env.FOUNDRY_ASP_AGENT_ID || '',
    pollMs: parseInt(process.env.FOUNDRY_A2A_POLL_MS || '20000', 10),
    dataDir: process.env.FOUNDRY_A2A_DATA_DIR || '',
    dryRun: process.env.FOUNDRY_A2A_DRY_RUN === '1',
    hermesWebhookUrl: process.env.FOUNDRY_HERMES_WEBHOOK_URL || '',
    filterAgentId: process.env.FOUNDRY_A2A_FILTER_AGENT_ID || '',
  },
  scraper: {
    marketplaceUrl: process.env.OKX_MARKETPLACE_URL || 'https://www.okx.ai',
    scrapeCron: process.env.SCRAPE_INTERVAL_CRON || '*/15 * * * *',
  },
  // dev/test bypass for x402 — DO NOT enable in prod
  bypassPayment: process.env.X_BYPASS_PAYMENT === '1',
};
