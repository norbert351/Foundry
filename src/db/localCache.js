// src/db/localCache.js
//
// Read-only local snapshot of the marketplace, written by the scraper and
// used as a fallback when Supabase is not configured. Enables the rest of
// the app to function in dev without a DB.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '..', '..', '.cache', 'marketplace-latest.json');

let _cache = null;
let _cacheMtime = 0;

function read() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return [];
    const stat = fs.statSync(CACHE_PATH);
    if (stat.mtimeMs === _cacheMtime && _cache) return _cache;
    _cacheMtime = stat.mtimeMs;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    return [];
  }
}

export function loadLocalMarketplace() {
  return read();
}

export function writeLocalMarketplace(agents) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(agents, null, 2));
  _cache = agents;
  _cacheMtime = Date.now();
}
