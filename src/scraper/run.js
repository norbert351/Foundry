// src/scraper/run.js — scrape once, or on a cron
import cron from 'node-cron';
import { scrapeAll, persistSnapshot } from './okx.js';
import { config } from '../config.js';

let _scraping = false;

export async function scrapeOnce() {
  if (_scraping) { console.log('[scraper] skip — already running'); return; }
  _scraping = true;
  const t0 = Date.now();
  try {
    const agents = await scrapeAll();
    const { inserted, latest } = await persistSnapshot(agents);
    const ms = Date.now() - t0;
    console.log(`[scraper] done in ${ms}ms — ${agents.length} agents, ${inserted} snapshots, ${latest} latest`);
    return { agents, inserted, latest, ms };
  } finally {
    _scraping = false;
  }
}

export function startScraperCron() {
  if (!config.scraper.scrapeCron) return;
  console.log(`[scraper] cron schedule: ${config.scraper.scrapeCron}`);
  cron.schedule(config.scraper.scrapeCron, async () => {
    try {
      await scrapeOnce();
    } catch (e) {
      console.error('[scraper] cron error:', e.message);
    }
  });
}

// CLI entry: `node src/scraper/run.js`  → scrape once and exit
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeOnce()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
