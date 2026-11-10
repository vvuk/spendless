import { getDb } from '../src/lib/server/db';
import { getRecurring } from '../src/lib/server/recurring';

const $ = (c: number) => (c / 100).toFixed(2).padStart(9);
const rows = getRecurring(getDb());
const show = process.argv.includes('--all') ? rows : rows.filter((s) => s.status !== 'stopped');
for (const s of show)
	console.log(
		[s.status.padEnd(7), s.kind.padEnd(12), s.cadence.padEnd(10), $(s.currentCents), $(s.annualCents), $(s.trailing12Cents),
		 String(s.charges.length).padStart(3), s.lastDate, (s.variable ? '~' : ' ') + (s.siblings ? 'D' : ' '),
		 s.priceChanges.length ? `↑${s.priceChanges.map((p) => `${$(p.fromCents).trim()}→${$(p.toCents).trim()}@${p.date}`).join(',')}` : '',
		 s.merchant, '·', s.category].join(' ')
	);
const live = rows.filter((s) => s.status !== 'stopped');
console.log(`\n${live.length} live series, ${rows.length - live.length} stopped. Annualized live: $${(live.reduce((a, s) => a + s.annualCents, 0) / 100).toFixed(0)}`);
