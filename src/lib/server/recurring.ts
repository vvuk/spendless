import type { DatabaseSync } from 'node:sqlite';
import { merchantKey } from './merchant';

export interface Charge {
	id: string;
	date: string;
	cents: number; // positive = money out
	merchant: string;
	category: string;
	categoryGroup: string;
	account: string;
	ruleId?: number | null;
}

/** A rule that says "what I match is recurring" — its matches become one series, no detection needed. */
export interface PinnedRule {
	id: number;
	kind: 'subscription' | 'bill' | 'obligation';
	cadence: Cadence['name'];
}

export const CADENCES = [
	{ name: 'weekly', days: 7, tol: 2 },
	{ name: 'biweekly', days: 14, tol: 3 },
	{ name: 'monthly', days: 30.44, tol: 5 },
	{ name: 'quarterly', days: 91.3, tol: 12 },
	{ name: 'semiannual', days: 182.6, tol: 20 },
	{ name: 'annual', days: 365.25, tol: 25 }
] as const;
export type Cadence = (typeof CADENCES)[number];
export type SeriesKind = 'subscription' | 'bill' | 'obligation' | 'other';
export type SeriesStatus = 'active' | 'late' | 'stopped';

export interface PriceChange {
	date: string;
	fromCents: number;
	toCents: number;
}

export interface Series {
	key: string;
	merchant: string;
	merchantKey: string;
	category: string;
	categoryGroup: string;
	account: string;
	kind: SeriesKind;
	cadence: Cadence['name'];
	cadenceDays: number;
	charges: { id: string; date: string; cents: number }[];
	firstDate: string;
	lastDate: string;
	nextDate: string;
	currentCents: number;
	variable: boolean; // amount varies (utility-style bill)
	annualCents: number; // projected cost of the next 12 months at the current price
	trailing12Cents: number; // actually paid in the last 365 days
	status: SeriesStatus;
	priceChanges: PriceChange[];
	confidence: number; // 0..1
	siblings: number; // other active series at the same merchant (possible duplicate)
	ruleId?: number; // set when a rule declares this series
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const days = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
const addDays = (d: string, n: number) => new Date(t(d) + Math.round(n) * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const OBLIGATION = new Set(['Mortgage', 'Rent', 'Auto Payment', 'Loan Repayment', 'Student Loans', 'Insurance', 'Child Care']);
const BILL_GROUPS = new Set(['Bills & Utilities']);
// Never recurring in a meaningful sense even if they look periodic.
const SKIP_CATEGORIES = new Set(['Transfer', 'Credit Card Payment', 'Balance Adjustments', 'Taxes', 'Cash & ATM']);

const OBLIGATION_GROUPS = new Set<string>();
// Everyday spending where two similar visits months apart are coincidence, not a subscription.
const EVERYDAY = new Set(['Restaurants & Bars', 'Coffee Shops', 'Groceries', 'Gas', 'Taxi & Ride Shares', 'Parking & Tolls', 'Public Transit', 'Travel & Vacation', 'Shopping', 'Amazon', 'Clothing']);
// Stores and app platforms bill for many unrelated things; two series there aren't an "overlap".
const PLATFORMS = new Set(['apple', 'amazon', 'google', 'paypal', 'patreon', 'kindle', 'steam', 'nintendo', 'microsoft', 'venmo']);
const VARIABLE_BILLS = new Set(['Gas & Electric', 'Water', 'Garbage']);

/**
 * Walk forward from each unused charge, hopping to the charge closest to one billing period later
 * (or two, to tolerate a missed/merged charge). Charges that don't land on the beat are left alone,
 * so a monthly plan buried among one-off purchases at the same merchant still surfaces, and two
 * overlapping plans become two chains.
 */
function findChains(pool: Charge[], c: Cadence): Charge[][] {
	const sorted = [...pool].sort((a, b) => a.date.localeCompare(b.date));
	const ts = sorted.map((x) => t(x.date));
	const used = new Uint8Array(sorted.length);
	const out: Charge[][] = [];
	const minCount = c.days >= 180 ? 2 : 3;

	for (let s = 0; s < sorted.length; s++) {
		if (used[s]) continue;
		const chain = [s];
		const inChain = new Set(chain);
		let prev = s;
		let skips = 0;
		for (;;) {
			let next = -1;
			for (const k of [1, 2]) {
				const target = ts[prev] + k * c.days * DAY;
				const tol = c.tol * k * DAY;
				let best = Infinity;
				for (let j = prev + 1; j < sorted.length && ts[j] <= target + tol; j++) {
					if (used[j] || inChain.has(j)) continue;
					const dd = Math.abs(ts[j] - target);
					if (dd <= tol && dd < best) { best = dd; next = j; }
				}
				if (next >= 0) { if (k === 2) skips++; break; }
			}
			if (next < 0) break;
			chain.push(next);
			inChain.add(next);
			prev = next;
		}
		if (chain.length < minCount || skips > (chain.length - 1) / 3) continue;

		// Reject chains that are just a busy merchant (rides, takeout) happening to land on the beat:
		// within the chain's span, off-beat charges must not outnumber on-beat ones.
		const lo = ts[chain[0]], hi = ts[chain[chain.length - 1]];
		let offBeat = 0;
		for (let j = 0; j < sorted.length; j++) if (!inChain.has(j) && ts[j] >= lo && ts[j] <= hi) offBeat++;
		if (offBeat > chain.length) continue;

		for (const i of chain) used[i] = 1;
		out.push(chain.map((i) => sorted[i]));
	}
	return out;
}

interface Run { charges: Charge[]; cadence: Cadence }

function plausible(run: Run, busy: boolean): boolean {
	const cs = run.charges;
	const everyday = cs.some((c) => EVERYDAY.has(c.category));
	// Large exact payments (rent over Venmo, a mortgage) or obligation categories don't repeat by
	// coincidence, so three on the beat is enough even at a busy merchant.
	const weighty = cs.every((c) => OBLIGATION.has(c.category)) || cs.every((c) => c.cents >= 50_000 && c.cents === cs[0].cents);
	if (weighty && run.cadence.days >= 28) return cs.length >= (run.cadence.days >= 180 ? 2 : 3);
	// At merchants you use constantly (Amazon, rideshare, delivery) or in everyday categories, an exact
	// price landing on a beat 3 times is coincidence; want 4+ hits and no weekly/biweekly "plans".
	if ((busy || everyday) && (cs.length < 4 || run.cadence.days < 28)) return false;
	if (cs.length > 2) return true;
	// Two charges is thin evidence (only allowed for semiannual/annual): demand near-identical amounts.
	const [a, b] = cs.map((c) => c.cents);
	return Math.abs(a - b) <= Math.max(a, b) * 0.02;
}

/** Find recurring runs for one merchant: exact-amount chains first, then tolerance bands for leftovers. */
function merchantRuns(charges: Charge[]): Run[] {
	const runs: Run[] = [];
	const left = new Set(charges);
	// "busy" = more than ~3 charges a month on average over the last year at this merchant
	const lastDate = charges.reduce((m, c) => (c.date > m ? c.date : m), '');
	const busy = charges.filter((c) => days(c.date, lastDate) <= 365).length > 40;

	const take = (pool: Charge[]) => {
		for (const cadence of CADENCES) {
			const avail = pool.filter((c) => left.has(c));
			if (avail.length < 2) break;
			for (const ch of findChains(avail, cadence)) {
				const run = { charges: ch, cadence };
				if (!plausible(run, busy)) continue;
				runs.push(run);
				for (const c of ch) left.delete(c);
			}
		}
	};

	// 1. exact amounts (most subscriptions)
	const exact = new Map<number, Charge[]>();
	for (const c of charges) (exact.get(c.cents) ?? exact.set(c.cents, []).get(c.cents)!).push(c);
	for (const group of exact.values()) if (group.length >= 2) take(group);

	// 2. near amounts (FX, tax, usage-based) — or the whole merchant for utilities whose bills swing.
	//    Skipped for busy merchants and everyday categories, where near-amount beats are noise.
	if (busy) return runs;
	const rest = [...left].filter((c) => !EVERYDAY.has(c.category)).sort((a, b) => a.cents - b.cents);
	if (rest.some((c) => VARIABLE_BILLS.has(c.category))) take(rest);
	else {
		const bands: Charge[][] = [];
		for (const c of rest) {
			const band = bands[bands.length - 1];
			if (band && c.cents <= band[0].cents * 1.15 + 50) band.push(c);
			else bands.push([c]);
		}
		for (const b of bands) if (b.length >= 2) take(b);
	}
	return runs;
}

/** Stitch runs that hand off to each other at the same cadence — that's a price change, not a new plan. */
function stitch(runs: Run[]): Run[] {
	runs.sort((a, b) => a.charges[0].date.localeCompare(b.charges[0].date));
	const out: Run[] = [];
	for (const r of runs) {
		const first = r.charges[0];
		let best: Run | undefined;
		let bestOff = Infinity;
		for (const p of out) {
			if (p.cadence.name !== r.cadence.name) continue;
			const last = p.charges[p.charges.length - 1];
			if (last.date >= first.date) continue;
			const gap = days(last.date, first.date);
			const ratio = first.cents / last.cents;
			if (gap < r.cadence.days * 0.5 || gap > r.cadence.days * 1.6 || ratio > 2.2 || ratio < 0.45) continue;
			const off = Math.abs(gap - r.cadence.days);
			if (off < bestOff) { bestOff = off; best = p; }
		}
		if (best) best.charges.push(...r.charges);
		else out.push({ cadence: r.cadence, charges: [...r.charges] });
	}
	return out;
}

function kindOf(category: string, group: string, variable: boolean): SeriesKind {
	if (OBLIGATION.has(category) || OBLIGATION_GROUPS.has(group)) return 'obligation';
	if (category === 'Subscriptions') return 'subscription';
	if (BILL_GROUPS.has(group)) return 'bill';
	return variable ? 'other' : 'subscription';
}

const mode = <T,>(xs: T[]) => {
	const m = new Map<T, number>();
	for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
	return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

/** Describe one series of charges at a known cadence: price, status, next date, price changes, cost. */
function describeSeries(mKey: string, charges: Charge[], cadence: Cadence, today: string): Series {
	const cs = charges.sort((a, b) => a.date.localeCompare(b.date));
	const last = cs[cs.length - 1];
	const recent = cs.slice(-6);
	const amounts = recent.map((c) => c.cents);
	const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
	const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
	const moves = amounts.slice(1).filter((a, i) => Math.abs(a - amounts[i]) > amounts[i] * 0.01).length;
	const variable = sd / mean > 0.08 && moves >= 3;

	const priceChanges: PriceChange[] = [];
	if (!variable) {
		for (let i = 1; i < cs.length; i++) {
			const a = cs[i - 1].cents;
			const b = cs[i].cents;
			// a change counts only once the next charge confirms it (filters proration / one-off blips)
			const confirmed = i === cs.length - 1 || Math.abs(cs[i + 1].cents - b) <= b * 0.01;
			if (Math.abs(b - a) > Math.max(a * 0.02, 50) && confirmed)
				priceChanges.push({ date: cs[i].date, fromCents: a, toCents: b });
		}
	}

	const currentCents = variable ? Math.round(median(amounts)) : last.cents;
	const since = days(last.date, today);
	const grace = cadence.tol * 1.5 + 3;
	const status: SeriesStatus =
		since <= cadence.days + grace ? 'active'
		: since <= cadence.days + Math.max(2 * grace, cadence.days * 0.25) ? 'late'
		: 'stopped';
	const trailing12Cents = cs.filter((c) => days(c.date, today) <= 365).reduce((a, c) => a + c.cents, 0);
	const category = mode(recent.map((c) => c.category));
	const group = recent.find((c) => c.category === category)!.categoryGroup;
	const steps = cs.length - 1;

	return {
		key: `${mKey}|${cadence.name}|${cs[0].id}`,
		merchant: last.merchant,
		merchantKey: mKey,
		category,
		categoryGroup: group,
		account: last.account,
		kind: kindOf(category, group, variable),
		cadence: cadence.name,
		cadenceDays: cadence.days,
		charges: cs.map((c) => ({ id: c.id, date: c.date, cents: c.cents })),
		firstDate: cs[0].date,
		lastDate: last.date,
		nextDate: addDays(last.date, cadence.days),
		currentCents,
		variable,
		annualCents: status === 'stopped' ? 0 : Math.round((currentCents * 365.25) / cadence.days),
		trailing12Cents,
		status,
		priceChanges,
		confidence: Math.min(1, Math.min(1, steps / 5) * (variable ? 0.85 : 1)),
		siblings: 0
	};
}

export function detectRecurring(all: Charge[], today: string, pinned: PinnedRule[] = []): Series[] {
	const out: Series[] = [];

	// Rule-declared series first; their charges are then kept out of detection so nothing shows twice.
	const pins = new Map(pinned.map((p) => [p.id, p]));
	const byRule = new Map<number, Charge[]>();
	for (const c of all) if (c.ruleId != null && pins.has(c.ruleId) && c.cents > 0) (byRule.get(c.ruleId) ?? byRule.set(c.ruleId, []).get(c.ruleId)!).push(c);
	for (const [id, cs] of byRule) {
		const pin = pins.get(id)!;
		const s = describeSeries(merchantKey(cs[cs.length - 1].merchant), cs, CADENCES.find((c) => c.name === pin.cadence)!, today);
		out.push({ ...s, key: `rule:${id}`, kind: pin.kind, ruleId: id, confidence: 1 });
	}

	const byMerchant = new Map<string, Charge[]>();
	for (const c of all) {
		if (c.ruleId != null && pins.has(c.ruleId)) continue;
		if (c.cents <= 0 || SKIP_CATEGORIES.has(c.category)) continue;
		const k = merchantKey(c.merchant);
		if (!k) continue;
		(byMerchant.get(k) ?? byMerchant.set(k, []).get(k)!).push(c);
	}

	for (const [mKey, charges] of byMerchant) {
		if (charges.length < 2) continue;
		for (const r of stitch(merchantRuns(charges))) out.push(describeSeries(mKey, r.charges, r.cadence, today));
	}

	// Two live plans at one merchant, same cadence and similar price (two Netflix accounts) are worth a look.
	const live = out.filter((s) => s.status !== 'stopped');
	for (const s of live)
		s.siblings = PLATFORMS.has(s.merchantKey)
			? 0
			: live.filter(
					(o) => o !== s && o.merchantKey === s.merchantKey && o.cadence === s.cadence &&
						Math.max(o.currentCents, s.currentCents) <= 2 * Math.min(o.currentCents, s.currentCents)
				).length;

	return out.sort((a, b) => b.annualCents - a.annualCents || b.trailing12Cents - a.trailing12Cents);
}

export function loadCharges(d: DatabaseSync, sinceDate: string): Charge[] {
	return d
		.prepare(
			`SELECT id, date, -amount_cents AS cents, merchant, category, category_group AS categoryGroup, account, rule_id AS ruleId
			 FROM txns WHERE date >= ? AND excluded = 0 AND pending = 0
			   AND (kind = 'expense' OR rule_id IN (SELECT id FROM rules WHERE recurring_kind IS NOT NULL AND enabled = 1))`
		)
		.all(sinceDate) as unknown as Charge[];
}

export type Mark = 'keep' | 'cancel' | 'cancelled' | 'not_recurring';
export type KindOverride = 'subscription' | 'bill' | 'obligation';

export function getRecurring(d: DatabaseSync, today = localToday()) {
	const since = new Date(Date.parse(today) - 3 * 365 * DAY).toISOString().slice(0, 10);
	const pinned = d
		.prepare(`SELECT id, recurring_kind AS kind, recurring_cadence AS cadence FROM rules WHERE recurring_kind IS NOT NULL AND enabled = 1`)
		.all() as unknown as PinnedRule[];
	const series = detectRecurring(loadCharges(d, since), today, pinned);
	const marks = new Map(
		(d.prepare(`SELECT series_key, status, kind, note FROM recurring_marks`).all() as { series_key: string; status: Mark | null; kind: KindOverride | null; note: string | null }[]).map(
			(m) => [m.series_key, m]
		)
	);
	return series
		.map((s) => {
			const m = marks.get(s.key);
			return { ...s, detectedKind: s.kind, kind: (m?.kind ?? s.kind) as SeriesKind, kindSet: !!m?.kind, mark: m?.status ?? null, note: m?.note ?? null };
		})
		.filter((s) => s.mark !== 'not_recurring');
}

export function localToday() {
	const n = new Date();
	return new Date(n.getTime() - n.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
