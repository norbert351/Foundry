-- src/db/schema.sql — Supabase Postgres schema
-- Run this in Supabase SQL editor (or via supabase CLI) before starting the server.

create table if not exists marketplace_snapshot (
  id bigserial primary key,
  scraped_at timestamptz not null default now(),
  agent_id text not null,
  name text not null,
  category text,
  description text,
  service_min_price numeric,
  total_service_count int,
  sold_count int default 0,
  rating numeric,
  online_status int,
  raw jsonb
);

create index if not exists idx_snapshot_agent_time on marketplace_snapshot(agent_id, scraped_at desc);
create index if not exists idx_snapshot_category on marketplace_snapshot(category);
create index if not exists idx_snapshot_scraped on marketplace_snapshot(scraped_at desc);

create table if not exists latest_marketplace (
  agent_id text primary key,
  name text not null,
  category text,
  description text,
  service_min_price numeric,
  total_service_count int,
  sold_count int,
  rating numeric,
  online_status int,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_latest_category on latest_marketplace(category);
create index if not exists idx_latest_price on latest_marketplace(service_min_price);

create table if not exists lint_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  agent_id text,            -- optional, if caller is checking their own draft
  caller_wallet text,       -- who paid for the lint
  listing jsonb not null,   -- the draft listing
  score int not null,
  findings jsonb not null,  -- [{field, severity, code, issue, fix}]
  rewritten jsonb,          -- {name, description} if rewrites were applied
  fee_paid numeric
);

create index if not exists idx_lint_agent on lint_runs(agent_id, created_at desc);
create index if not exists idx_lint_created on lint_runs(created_at desc);

create table if not exists trust_receipts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  endpoint text not null,
  caller_wallet text,
  service_name text,
  response_hash text not null,  -- keccak256 of response body
  latency_ms int,
  schema_valid boolean,
  signature text not null,      -- EIP-191 sig from Foundry wallet
  receipt_uri text,             -- public URL if seller chose to publish
  fee_paid numeric
);

create index if not exists idx_receipts_endpoint on trust_receipts(endpoint, created_at desc);
create index if not exists idx_receipts_caller on trust_receipts(caller_wallet, created_at desc);

-- Seed: OKX review rules learned from accepted listings
create table if not exists review_rules (
  id serial primary key,
  category text not null,         -- 'identity.name' / 'service.description' / etc
  rule text not null,
  severity text not null,         -- 'block' | 'warn' | 'info'
  source text,                    -- which accepted listing we learned this from
  created_at timestamptz not null default now()
);

insert into review_rules (category, rule, severity, source) values
  ('identity.name', 'Length: 3-25 chars for EN, 2-12 for CJK', 'block', 'PixelBrief/CoinWM/Newsliquid'),
  ('identity.name', 'No celebrity / public-figure names (substring match)', 'block', 'OKX policy'),
  ('identity.name', 'No "test" / "demo" markers', 'block', 'OKX policy'),
  ('identity.description', 'Length: 30-500 chars', 'block', 'PixelBrief/CoinWM'),
  ('identity.description', 'Should describe what the agent does and who for', 'warn', 'Newsliquid'),
  ('service.name', 'Length: 5-30 chars, noun phrase', 'block', 'OKX policy'),
  ('service.name', 'No price in the name (e.g. "0.01 USDT")', 'block', 'OKX policy'),
  ('service.name', 'No tech-stack details in name', 'warn', 'Newsliquid'),
  ('service.description', 'Two-part structure required: (1) core capability + audience, (2) what user provides', 'block', 'OKX policy'),
  ('service.description', 'Length: 50-400 CJK chars or equivalent EN', 'block', 'OKX policy'),
  ('service.description', 'No GitHub / wallet / external links', 'block', 'OKX policy'),
  ('service.description', 'No legal disclaimers', 'warn', 'Newsliquid'),
  ('service.fee', 'Required, numeric, ≤6 decimals', 'block', 'OKX policy'),
  ('service.fee', 'Currency defaults to USDT; do not include symbol in value', 'block', 'OKX policy'),
  ('service.type', 'A2MCP (API service) required; A2A optional', 'block', 'OKX policy'),
  ('service.endpoint', 'Required for A2MCP; must be https://, public, no localhost / private IPs / .local', 'block', 'OKX policy'),
  ('service.endpoint', 'Length ≤512 chars', 'block', 'OKX policy'),
  ('category', 'Must match a real OKX.AI category: FINANCE / SOFTWARE_SERVICES / LIFESTYLE / ART_CREATION / EDUCATION / PRODUCTIVITY / SOCIAL', 'block', 'OKX policy'),
  ('example-prompts', 'Service description should implicitly cover example use cases', 'warn', 'CoinWM')
on conflict do nothing;
