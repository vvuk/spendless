import { getDb } from '../src/lib/server/db';
import { syncFromMonarch } from '../src/lib/server/sync/monarchMcp';
import { classifyAfterSync } from '../src/lib/server/benefits/auto';

// Usage: npm run sync [-- --since 2026-01-01]
// First run opens your browser to approve read-only access to Monarch.
const i = process.argv.indexOf('--since');
const since = i > 0 ? process.argv[i + 1] : undefined;
const r = await syncFromMonarch(getDb(), { since, interactive: process.stdout.isTTY, log: console.log });
console.log(`Synced ${r.window.start} → ${r.window.end}: fetched ${r.fetched}; inserted ${r.inserted}, updated ${r.updated}, unchanged ${r.unchanged}, removed ${r.deleted}`);
await classifyAfterSync(getDb(), console.log);
process.exit(0);
