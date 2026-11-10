import { getDb } from '../src/lib/server/db';
import { localToday } from '../src/lib/server/recurring';
import { analyzeBenefits } from '../src/lib/server/benefits/analyze';
import { classifyPending, llmConfigured, llmModel } from '../src/lib/server/benefits/llm';
import { enrollmentQueue } from '../src/lib/server/benefits/enroll';

/**
 * mise run benefits                     report for the last 12 months
 * mise run benefits -- --classify       first ask the LLM about pending transactions (up to --limit, default 400)
 * mise run benefits -- --detail <id>    period-by-period for one benefit, e.g. amex-platinum/digital-entertainment
 * mise run benefits -- --json           the whole analysis as JSON
 */
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const d = getDb();
const today = opt('--today') ?? localToday();
let a = analyzeBenefits(d, today);

if (flag('--classify')) {
	const n = a.pending.reduce((s, p) => s + p.txnIds.length, 0);
	if (!llmConfigured()) console.error('OPENROUTER_API_KEY is not set; skipping classification.');
	else if (!n) console.error('Nothing to classify.');
	else {
		console.error(`Classifying ${Math.min(n, Number(opt('--limit') ?? 400))} of ${n} with ${llmModel()}…`);
		const r = await classifyPending(d, a.pending, { limit: Number(opt('--limit') ?? 400), onProgress: (x, t) => process.stderr.write(`\r  ${x}/${t}`) });
		console.error(`\n  yes ${r.yes}, no ${r.no}, unsure ${r.unsure}; ${r.calls} calls, ${r.promptTokens}+${r.completionTokens} tokens` + (r.costUsd != null ? `, $${r.costUsd.toFixed(4)}` : ''));
		for (const e of r.errors) console.error('  error:', e);
		a = analyzeBenefits(d, today);
	}
}

if (flag('--json')) {
	console.log(JSON.stringify(a, null, 2));
	process.exit(0);
}

const $ = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const rpad = (s: string, n: number) => s.padStart(n);

const detail = opt('--detail');
if (detail) {
	for (const b of a.benefits.filter((b) => b.key === detail || b.id === detail)) {
		console.log(`${b.cardName} · ${b.name} (${b.account}) · enrollment ${b.enrollment}${b.enrollmentInferred ? ' (inferred)' : ''}`);
		for (const p of b.periods) {
			console.log(
				`  ${pad(p.label, 22)} ${pad(p.status, 12)} credit ${rpad($(p.capturedCents), 5)}/${rpad($(p.amountCents), 5)}  on card ${rpad($(p.onCardCents), 6)}  elsewhere ${rpad($(p.elsewhereCents), 6)}  moveable ${rpad($(p.moveableCents), 5)}`
			);
			for (const t of p.credits) console.log(`      + ${t.date} ${rpad($(t.cents), 6)} ${t.merchant}`);
			for (const t of p.onCard.slice(0, 6)) console.log(`      · ${t.date} ${rpad($(t.cents), 6)} ${t.merchant} [${t.verdict}]`);
			for (const t of p.elsewhere.slice(0, 6)) console.log(`      ↗ ${t.date} ${rpad($(t.cents), 6)} ${t.merchant} on ${t.account} [${t.verdict}]`);
		}
	}
	process.exit(0);
}

console.log(`Credit card benefits, ${a.windowStart} → ${a.today}\n`);
for (const c of a.cards)
	console.log(
		`${pad(c.cardName, 24)} ${pad(c.account, 28)} fee ${$(c.feeCents)}  captured ${$(c.capturedCents)} of ${$(c.possibleCents)}  ` +
			`missed ${$(c.missedCents)} (spend on other cards ${$(c.moveableCents)}, not booked via portal ${$(c.opportunityCents)})  anniversary ${c.anniversary} (${c.anniversarySource})`
	);

console.log('\nBenefits');
for (const b of a.benefits) {
	const strip = b.periods
		.map((p) => ({ used: '█', likely: '▓', partial: '▒', awaiting: '◔', no_credit: '?', not_enrolled: '✗', missed: '○', paying: '$', unused: '·', open: '…' })[p.status])
		.join('');
	console.log(
		`  ${pad(b.cardName.split(' ').at(-1)!, 9)} ${pad(b.name, 36)} ${rpad($(b.annualValueCents), 6)}/yr  ${pad(strip, 14)} got ${rpad($(b.totals.capturedCents), 5)}  missed ${rpad($(b.totals.missedCents), 5)}  moveable ${rpad($(b.totals.moveableCents), 5)}` +
			(b.enrollmentRequired ? `  [${b.enrollment}]` : '') + (b.lifestyle ? '  (lifestyle)' : '')
	);
}
console.log('  █ used  ▓ likely (in-app)  ▒ partial  ◔ awaiting credit  ? spend but no credit  ✗ not enrolled  ○ spend went elsewhere  $ paying for it  · unused  … in progress');

console.log('\nWhat to do');
for (const x of a.actions.slice(0, 25))
	console.log(`  ${rpad($(x.valueCents), 6)}  ${pad(x.kind, 8)} ${x.title}${x.ongoing ? '' : ' (not recent)'}\n           ${x.detail}`);

console.log('\nStill available this period');
for (const x of a.actNow) console.log(`  ${rpad($(x.remainingCents), 5)}  ${rpad(String(x.daysLeft), 3)} days left  ${x.cardName} · ${x.name} (${x.periodLabel})`);

const q = enrollmentQueue(a);
if (q.length) {
	console.log('\nNeeds enrollment (not marked enrolled)');
	for (const t of q) console.log(`  ${pad(t.cardName + ' · ' + t.name, 50)} eligible spend ${rpad($(t.spendCents), 6)}  ${t.how}`);
}

const nPending = a.pending.reduce((s, p) => s + p.txnIds.length, 0);
if (nPending)
	console.log(`\n${nPending} transactions need an LLM judgement (${a.pending.map((p) => `${p.rubric} ${p.txnIds.length}`).join(', ')}). Run with --classify.`);
