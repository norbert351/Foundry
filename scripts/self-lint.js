// scripts/self-lint.js — run lint-listing on Foundry's own draft
//
// This is the dog-fooding demo: the linter that scores other listings scores
// its own listing, and we ship the result as marketing.

import fs from 'node:fs';
import { lintListing } from '../src/services/lintListing.js';

const draft = JSON.parse(fs.readFileSync(new URL('../listing-draft.json', import.meta.url), 'utf8'));
const listing = {
  name: draft.name,
  description: draft.description,
  category: 'SOFTWARE_SERVICES',
  services: draft.services,
};

const result = await lintListing({ listing, rewrite: true });

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  FOUNDRY SELF-LINT');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`  Score: ${result.score}/100  ·  ${result.pass ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Blocks: ${result.summary.block_count}  ·  Warns: ${result.summary.warn_count}`);
console.log(`  Next: ${result.summary.next_step}`);
console.log('───────────────────────────────────────────────────────────────');
if (result.findings.length === 0) {
  console.log('  No issues found.');
} else {
  for (const f of result.findings) {
    const icon = f.severity === 'block' ? '🛑' : f.severity === 'warn' ? '⚠️ ' : 'ℹ️ ';
    console.log(`  ${icon} [${f.code}] ${f.field}: ${f.issue}`);
    console.log(`     → ${f.fix}`);
  }
}
if (Object.keys(result.rewritten).length > 0) {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Suggested rewrites:');
  for (const [k, v] of Object.entries(result.rewritten)) {
    if (k === 'service_descriptions') {
      v.forEach((d, i) => {
        if (d) console.log(`    service[${i}].description: ${d}`);
      });
    } else if (v) {
      console.log(`    ${k}: ${v}`);
    }
  }
}
console.log('═══════════════════════════════════════════════════════════════════\n');

// Exit non-zero if it doesn't pass — useful for CI gating
process.exit(result.pass ? 0 : 1);
