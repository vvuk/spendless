import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/lib/server/db';
import { importMonarchCsv } from '../src/lib/server/import/csv';

// Usage: npm run import:csv [path]   (default: newest *.csv in data/)
let path = process.argv[2];
if (!path) {
	const csvs = readdirSync('data')
		.filter((f) => f.toLowerCase().endsWith('.csv'))
		.map((f) => join('data', f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	if (!csvs.length) throw new Error('No CSV found in data/. Export from Monarch: Transactions → ⋯ → Download.');
	path = csvs[0];
}
const r = importMonarchCsv(getDb(), path);
console.log(`Imported ${path}: ${r.rows} rows (${r.window.start} → ${r.window.end})`);
console.log(`  inserted ${r.inserted}, updated ${r.updated}, unchanged ${r.unchanged}, marked deleted ${r.deleted}`);
