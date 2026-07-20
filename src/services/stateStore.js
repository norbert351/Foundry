// src/services/stateStore.js — File-backed KV store for durable state
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DATA_DIR = process.env.FOUNDRY_DATA_DIR || join(process.cwd(), '.data');

export async function initStore() { await mkdir(DATA_DIR, { recursive: true }); }

export class FileStore {
  constructor(name, { ttlMs = 0 } = {}) {
    this.path = join(DATA_DIR, `${name}.json`);
    this.ttlMs = ttlMs;
    this._cache = null;
    this._writeQ = Promise.resolve();
  }
  async _load() {
    if (this._cache) return this._cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      this._cache = new Map(Object.entries(parsed));
    } catch { this._cache = new Map(); }
    return this._cache;
  }
  async _save() {
    if (!this._cache) return;
    const obj = Object.fromEntries(this._cache);
    const tmp = this.path + '.' + process.pid + '.tmp';
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tmp, JSON.stringify(obj), 'utf8');
    await rename(tmp, this.path);
  }
  async _enqueue() {
    this._writeQ = this._writeQ.then(() => this._save());
    return this._writeQ;
  }
  async get(key) {
    const m = await this._load();
    const entry = m.get(key);
    if (!entry) return null;
    if (this.ttlMs && Date.now() - entry._ts > this.ttlMs) { m.delete(key); this._enqueue(); return null; }
    return entry;
  }
  async set(key, value) {
    const m = await this._load();
    m.set(key, { ...value, _ts: Date.now() });
    await this._enqueue();
  }
  async delete(key) {
    const m = await this._load();
    m.delete(key);
    await this._enqueue();
  }
  async all() {
    const m = await this._load();
    return Array.from(m.entries()).map(([k, v]) => ({ id: k, ...v, _ts: undefined }));
  }
  async sweep() {
    if (!this.ttlMs) return 0;
    const m = await this._load();
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of m) { if (now - v._ts > this.ttlMs) { m.delete(k); removed++; } }
    if (removed) await this._enqueue();
    return removed;
  }
}
