// src/db/supabase.js
//
// Supabase client. If URL/KEY are placeholders, return a stub that yields
// empty data so the rest of the app still boots in dev.

import { config } from '../config.js';

const isPlaceholder = (v) => !v || v.includes('placeholder') || v.includes('your-');

function makeQueryChain() {
  const chainable = {
    select() { return chainable; },
    insert() { return chainable; },
    upsert() { return chainable; },
    update() { return chainable; },
    delete() { return chainable; },
    eq() { return chainable; },
    order() { return chainable; },
    limit() { return chainable; },
    gt() { return chainable; },
    single() { return Promise.resolve({ data: null, error: null }); },
    async then(resolve) {
      return Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
    },
  };
  // Make every property access return a thenable that resolves to { data, error }
  return new Proxy(chainable, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Any unknown property (like 'insert' chained then 'select' chained then 'single')
      // returns a thenable that resolves to empty
      return function () {
        return new Proxy(function () {}, {
          get(_, p) {
            if (p === 'then') return (resolve) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
            return undefined;
          },
        });
      };
    },
  });
}

function makeStub() {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'from') return () => makeQueryChain();
      if (prop === 'rpc') return () => Promise.resolve({ data: null, error: null });
      return undefined;
    },
  });
}

let _client = null;
export async function getSupabase() {
  if (_client) return _client;
  if (isPlaceholder(config.supabase.url) || isPlaceholder(config.supabase.key)) {
    if (!_client) _client = makeStub();
    return _client;
  }
  const { createClient } = await import('@supabase/supabase-js');
  _client = createClient(config.supabase.url, config.supabase.key, {
    auth: { persistSession: false },
  });
  return _client;
}

// Synchronous proxy that resolves the real client lazily
export const supabase = new Proxy({}, {
  get(_, prop) {
    if (prop === 'from') {
      return (table) => {
        const chain = makeQueryChain();
        // Return a proxy that awaits getSupabase() before delegating calls
        return new Proxy(chain, {
          get(target, subprop) {
            if (subprop === 'then') return target.then;
            // For chaining methods that need to hit the real client, we
            // return a function that does the async lookup
            return async (...args) => {
              const c = await getSupabase();
              const realChain = c.from(table);
              const realMethod = realChain[subprop];
              if (typeof realMethod === 'function') {
                return realMethod.apply(realChain, args);
              }
              return realChain;
            };
          },
        });
      };
    }
    if (prop === 'rpc') {
      return async (...args) => {
        const c = await getSupabase();
        return c.rpc(...args);
      };
    }
    return undefined;
  },
});
