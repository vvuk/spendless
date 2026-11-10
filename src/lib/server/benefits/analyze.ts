import type { DatabaseSync } from 'node:sqlite';
import type { BenefitDef, CardDef } from './types';
import { CARDS, cardById } from './cards/index';
import { type BTxn, type Labels, type Verdict, judge, counts, labelsFrom, matches } from './match';
import { type Period, periodsBetween, addDays, daysBetween, PERIODS_PER_YEAR } from './periods';
import { merchantKey } from '../merchant';

/* ───────────────────────── accounts → cards ───────────────────────── */

export interface CardAccount {
	account: string;
	card: CardDef;
	anniversary: string; // MM-DD
	anniversarySource: 'manual' | 'fee' | 'default';
	mapping: 'manual' | 'detected';
}

export interface AccountChoice {
	account: string;
	institution: string | null;
	type: string | null;
	cardId: string | null;
	mapping: 'manual' | 'detected' | 'none';
	anniversary: string | null;
	anniversarySource: CardAccount['anniversarySource'] | null;
}

interface AccountRow { name: string; type: string | null; institution: string | null }
interface MappingRow { account: string; card_id: string | null; anniversary: string | null }

/** Which synced accounts are which cards. A row in card_accounts wins; otherwise each card's `detect` rules decide. */
export function mapCardAccounts(d: DatabaseSync, txns: BTxn[]): { cards: CardAccount[]; choices: AccountChoice[] } {
	const accts = d.prepare(`SELECT name, type, institution FROM accounts`).all() as unknown as AccountRow[];
	const seen = new Set(accts.map((a) => a.name));
	for (const t of txns) if (!seen.has(t.account)) (seen.add(t.account), accts.push({ name: t.account, type: null, institution: null }));
	const manual = new Map((d.prepare(`SELECT account, card_id, anniversary FROM card_accounts`).all() as unknown as MappingRow[]).map((m) => [m.account, m]));

	const byAccount = new Map<string, BTxn[]>();
	for (const t of txns) (byAccount.get(t.account) ?? byAccount.set(t.account, []).get(t.account)!).push(t);

	const cards: CardAccount[] = [];
	const choices: AccountChoice[] = [];
	for (const a of accts) {
		const m = manual.get(a.name);
		const own = byAccount.get(a.name) ?? [];
		let card: CardDef | undefined;
		let mapping: AccountChoice['mapping'] = 'none';
		if (m) {
			card = m.card_id ? cardById(m.card_id) : undefined;
			mapping = 'manual';
		} else {
			card = CARDS.find((c) => detects(c, a, own));
			if (card) mapping = 'detected';
		}
		let anniversary: string | null = null;
		let anniversarySource: CardAccount['anniversarySource'] | null = null;
		if (card) {
			const fee = own.filter((t) => !t.inflow && card!.detect.annualFee && matches(card!.detect.annualFee, t)).map((t) => t.date).sort().at(-1);
			if (m?.anniversary) [anniversary, anniversarySource] = [m.anniversary, 'manual'];
			else if (fee) [anniversary, anniversarySource] = [fee.slice(5), 'fee'];
			else [anniversary, anniversarySource] = ['01-01', 'default'];
			cards.push({ account: a.name, card, anniversary, anniversarySource, mapping: mapping as CardAccount['mapping'] });
		}
		if (card || /credit/i.test(a.type ?? '') || m)
			choices.push({ account: a.name, institution: a.institution, type: a.type, cardId: card?.id ?? null, mapping, anniversary, anniversarySource });
	}
	return { cards, choices };
}

function detects(c: CardDef, a: AccountRow, own: BTxn[]) {
	const { institution, accountName, annualFee } = c.detect;
	if (!institution && !accountName && !annualFee) return false;
	if (institution && !new RegExp(institution, 'i').test(a.institution ?? '')) return false;
	if (accountName && !new RegExp(accountName, 'i').test(a.name)) return false;
	if (annualFee && !accountName && !own.some((t) => !t.inflow && matches(annualFee, t))) return false;
	return true;
}

/* ───────────────────────── loading ───────────────────────── */

interface TxnRow {
	id: string; date: string; amount_cents: number; account: string; merchant: string; monarch_merchant: string | null;
	statement: string | null; category: string; kind: string;
}

export function loadBenefitTxns(d: DatabaseSync, since: string): BTxn[] {
	const rows = d
		.prepare(
			`SELECT id, date, amount_cents, account, merchant, monarch_merchant, statement, category, kind
			 FROM txns WHERE date >= ? AND kind != 'transfer' AND amount_cents != 0 AND pending = 0 ORDER BY date`
		)
		.all(since) as unknown as TxnRow[];
	return rows.map((r) => ({
		id: r.id,
		date: r.date,
		cents: Math.abs(r.amount_cents),
		inflow: r.amount_cents > 0,
		account: r.account,
		merchant: r.merchant,
		statement: r.statement ?? '',
		category: r.category,
		text: [r.merchant, r.monarch_merchant, r.statement].filter(Boolean).join(' · ')
	}));
}

/* ───────────────────────── results ───────────────────────── */

export type Status =
	| 'used' // credit fully posted / membership active
	| 'likely' // in-app credit with qualifying use on the card; can't see it, assume applied
	| 'partial' // some credit posted, not all
	| 'awaiting' // qualifying spend on the card, credit not posted yet
	| 'no_credit' // qualifying spend on the card but no credit ever posted: probably not enrolled
	| 'not_enrolled'
	| 'missed' // qualifying spend went on other cards
	| 'paying' // paying for a membership the card includes
	| 'unused' // no qualifying spend anywhere
	| 'open'; // period still running, nothing used yet

export interface TxnRef { id: string; date: string; cents: number; merchant: string; account: string; verdict: Verdict }

export interface PeriodResult {
	key: string;
	label: string;
	start: string;
	end: string;
	open: boolean;
	daysLeft: number | null;
	amountCents: number;
	creditedCents: number;
	capturedCents: number;
	/** Credit you should get for spend already on the card (statement credits not posted yet). */
	expectedCents: number;
	onCardCents: number;
	elsewhereCents: number;
	status: Status;
	missedCents: number;
	moveableCents: number;
	opportunityCents: number;
	onCard: TxnRef[];
	elsewhere: TxnRef[];
	credits: TxnRef[];
}

export interface BenefitResult {
	key: string; // "<card>/<benefit>"
	account: string;
	cardId: string;
	cardName: string;
	id: string;
	name: string;
	amountCents: number;
	period: BenefitDef['period'];
	annualValueCents: number;
	redemption: BenefitDef['redemption']['type'];
	channel: string | null;
	enrollmentRequired: boolean;
	enrollHow: string | null;
	enrollUrl: string | null;
	automation: string | null;
	enrollment: 'enrolled' | 'not_enrolled' | 'unknown';
	enrollmentInferred: boolean;
	notes: string | null;
	lifestyle: boolean;
	periods: PeriodResult[];
	/** Closed periods in the window. moveable + opportunity is the part of missed you could have had. */
	totals: { possibleCents: number; capturedCents: number; missedCents: number; moveableCents: number; opportunityCents: number };
}

export interface Move {
	txn: TxnRef;
	fromAccount: string;
	fromCard: string | null;
	toAccount: string;
	toCard: string;
	benefitKey: string;
	benefitName: string;
	periodLabel: string;
	open: boolean;
	gainCents: number;
	pointsCostCents: number;
	benefitLossCents: number;
	lostBenefits: string[];
	netCents: number;
}

export interface Action {
	kind: 'move' | 'book' | 'activate' | 'enroll' | 'use';
	benefitKey: string;
	account: string;
	cardName: string;
	title: string;
	detail: string;
	/** Value over the analysis window (≈ a year), net of points lost. */
	valueCents: number;
	ongoing: boolean;
	merchants: string[];
	moves?: Move[];
	/** The purchases behind an enroll / activate / book recommendation, newest first. */
	txns?: TxnRef[];
}

export interface CardSummary {
	account: string;
	cardId: string;
	cardName: string;
	feeCents: number;
	anniversary: string;
	anniversarySource: CardAccount['anniversarySource'];
	possibleCents: number;
	capturedCents: number;
	missedCents: number;
	moveableCents: number;
	opportunityCents: number;
	lifestyleUnusedCents: number;
}

export interface Analysis {
	today: string;
	windowStart: string;
	/** Recommendations count purchases from this date (Jan 1 of the current year). */
	yearStart: string;
	cards: CardSummary[];
	benefits: BenefitResult[];
	actions: Action[];
	/** Credits with value left in the current period. */
	actNow: { benefitKey: string; account: string; cardName: string; name: string; remainingCents: number; daysLeft: number; periodLabel: string; how: string; status: Status }[];
	pending: { rubric: string; txnIds: string[] }[];
	accounts: AccountChoice[];
}

/* ───────────────────────── analysis ───────────────────────── */

const GRACE_DAYS = 10; // statement credits can post a few days after the qualifying charge
const UNTRACKED_CARD_RATE = 0.01; // assumed rewards on credit cards without a definition
const CAPTURING: Status[] = ['used', 'likely', 'partial', 'awaiting'];

export interface AnalyzeOptions {
	/** Analysis window in days, ending today. */
	days?: number;
}

export function analyzeBenefits(d: DatabaseSync, today: string, opts: AnalyzeOptions = {}): Analysis {
	const windowStart = addDays(today, -(opts.days ?? 365) + 1);
	const loadFrom = addDays(today, -4 * 366 - 400); // four-year credits + fee history for anniversaries
	const all = loadBenefitTxns(d, loadFrom);
	const { cards: cardAccts, choices } = mapCardAccounts(d, all);
	const cardOf = new Map(cardAccts.map((c) => [c.account, c]));
	const acctType = new Map(choices.map((c) => [c.account, c.type]));

	const labels: Labels = labelsFrom(d.prepare(`SELECT rubric, txn_id, rubric_hash, label FROM llm_labels`).all() as never);
	const overrides = new Map(
		(d.prepare(`SELECT benefit_id, txn_id, eligible FROM benefit_txn_overrides`).all() as { benefit_id: string; txn_id: string; eligible: number }[]).map(
			(o) => [`${o.benefit_id}|${o.txn_id}`, !!o.eligible]
		)
	);
	const enrollment = new Map(
		(d.prepare(`SELECT account, benefit_id, status FROM benefit_enrollment`).all() as { account: string; benefit_id: string; status: string }[]).map(
			(e) => [`${e.account}|${e.benefit_id}`, e.status as 'enrolled' | 'not_enrolled']
		)
	);

	const outflows = all.filter((t) => !t.inflow);
	const inflows = all.filter((t) => t.inflow);
	const pending = new Map<string, Set<string>>();
	const ref = (t: BTxn, verdict: Verdict): TxnRef => ({ id: t.id, date: t.date, cents: t.cents, merchant: t.merchant, account: t.account, verdict });

	const benefits: BenefitResult[] = [];
	const verdictCache = new Map<string, Verdict>();
	const verdictOf = (key: string, b: BenefitDef, t: BTxn, spec = b.eligible, tag = 'e') => {
		const k = `${tag}|${key}|${t.id}`;
		let v = verdictCache.get(k);
		if (v == null) {
			v = judge(spec, t, labels, tag === 'e' ? overrides.get(`${key}|${t.id}`) : undefined);
			verdictCache.set(k, v);
			if (v === 'pending' && t.date >= windowStart) {
				const r = spec!.llm!.rubric;
				(pending.get(r) ?? pending.set(r, new Set()).get(r)!).add(t.id);
			}
		}
		return v;
	};

	for (const ca of cardAccts) {
		for (const b of ca.card.benefits) {
			const key = `${ca.card.id}/${b.id}`;
			const from = b.from && b.from > windowStart ? b.from : windowStart;
			const until = b.until && b.until < today ? b.until : today;
			if (from > until && b.period !== 'four_years') continue;
			// A period counts if the benefit existed for at least half of it (a refresh mid-period doesn't owe a full credit).
			const half = (p: Period) => addDays(p.start, Math.floor(daysBetween(p.start, p.end) / 2));
			const periods = periodsBetween(b.period, from, until, ca.anniversary).filter(
				(p) => p.end > windowStart && (!b.from || b.from <= half(p)) && (!b.until || b.until >= half(p))
			);
			if (b.period === 'four_years' && b.until && b.until < today) continue;
			if (!periods.length) continue;

			const spanStart = periods[0].start;
			const spanEnd = periods.at(-1)!.end;
			const inSpan = (t: BTxn) => t.date >= spanStart && t.date < addDays(spanEnd, GRACE_DAYS);
			const eligibleOut = outflows.filter((t) => t.date >= spanStart && t.date < spanEnd).map((t) => [t, verdictOf(key, b, t)] as const).filter(([, v]) => v !== 'no');
			const opp = b.channel?.opportunity;
			const oppOut = opp
				? outflows.filter((t) => t.date >= spanStart && t.date < spanEnd).map((t) => [t, verdictOf(key, b, t, opp, 'o')] as const).filter(([, v]) => counts(v))
				: [];

			// statement credits on this card that belong to this benefit
			const red = b.redemption;
			const maxAmt = Math.max(b.amountCents, ...Object.values(b.amountByMonth ?? {}));
			const credits =
				red.type === 'statement_credit'
					? inflows.filter(
							(t) =>
								t.account === ca.account &&
								inSpan(t) &&
								(matches(red.credit, t) || (!!red.creditUnderMerchantName && matches(b.eligible, t) && t.cents <= maxAmt * 1.05))
						)
					: [];
			const everCredited =
				red.type === 'statement_credit' &&
				inflows.some((t) => t.account === ca.account && matches(red.credit, t));

			const enr0 = enrollment.get(`${ca.account}|${key}`);
			const enrolledState: BenefitResult['enrollment'] = enr0 ?? (everCredited || credits.length ? 'enrolled' : 'unknown');

			// attribute each credit to one period
			const creditBy = new Map<string, BTxn[]>();
			const spendOnCardBy = new Map<string, BTxn[]>();
			for (const [t, v] of eligibleOut) {
				if (!counts(v) || t.account !== ca.account) continue;
				const p = periods.find((p) => t.date >= p.start && t.date < p.end);
				if (p) (spendOnCardBy.get(p.key) ?? spendOnCardBy.set(p.key, []).get(p.key)!).push(t);
			}
			// A credit belongs to the period it posts in, except one posting in the first days of a period for a
			// purchase made at the end of the previous one (no qualifying purchase yet in the new period).
			const creditedSoFar = new Map<string, number>();
			for (const c of credits) {
				let i = periods.findIndex((p) => c.date >= p.start && c.date < p.end);
				if (i < 0) {
					if (c.date < spanEnd) continue;
					i = periods.length - 1; // posted just after the last period ended
				} else if (i > 0 && daysBetween(periods[i].start, c.date) < GRACE_DAYS) {
					const prev = periods[i - 1];
					const prevSpend = spendOnCardBy.get(prev.key) ?? [];
					const hereSpendBefore = (spendOnCardBy.get(periods[i].key) ?? []).some((t) => t.date <= c.date);
					if (prevSpend.length && !hereSpendBefore && (creditedSoFar.get(prev.key) ?? 0) < b.amountCents) i--;
				}
				const p = periods[i];
				creditedSoFar.set(p.key, (creditedSoFar.get(p.key) ?? 0) + c.cents);
				(creditBy.get(p.key) ?? creditBy.set(p.key, []).get(p.key)!).push(c);
			}

			const results: PeriodResult[] = periods.map((p) => periodResult(p, b, ca, today, enrolledState, eligibleOut, oppOut, creditBy.get(p.key) ?? [], ref));
			const closed = results.filter((r) => !r.open);
			const sum = (f: (r: PeriodResult) => number, rs = closed) => rs.reduce((a, r) => a + f(r), 0);
			benefits.push({
				key,
				account: ca.account,
				cardId: ca.card.id,
				cardName: ca.card.name,
				id: b.id,
				name: b.name,
				amountCents: b.amountCents,
				period: b.period,
				annualValueCents: Math.round(
					b.period === 'month' && b.amountByMonth
						? Array.from({ length: 12 }, (_, i) => b.amountByMonth![i + 1] ?? b.amountCents).reduce((a, x) => a + x, 0)
						: b.amountCents * PERIODS_PER_YEAR[b.period]
				),
				redemption: red.type,
				channel: b.channel?.how ?? null,
				enrollmentRequired: !!b.enrollment?.required,
				enrollHow: b.enrollment?.how ?? null,
				enrollUrl: b.enrollment?.url ?? null,
				automation: b.enrollment?.automation ?? null,
				enrollment: enrolledState,
				enrollmentInferred: !enr0 && enrolledState === 'enrolled',
				notes: b.notes ?? null,
				lifestyle: !!b.lifestyle,
				periods: results,
				totals: {
					possibleCents: sum((r) => r.amountCents),
					capturedCents: sum((r) => r.capturedCents),
					missedCents: sum((r) => r.missedCents),
					moveableCents: sum((r) => r.moveableCents),
					opportunityCents: sum((r) => r.opportunityCents)
				}
			});
		}
	}

	/* moves: purchases on other accounts that would have earned an unused credit on this card */
	const byKeyAcct = new Map(benefits.map((b) => [`${b.account}|${b.key}`, b]));
	const earnValue = (account: string, t: BTxn) => {
		const ca = cardOf.get(account);
		if (!ca) return /credit/i.test(acctType.get(account) ?? '') ? t.cents * UNTRACKED_CARD_RATE : 0;
		const rule = ca.card.earn.find((e) => (!e.from || t.date >= e.from) && (!e.until || t.date <= e.until) && matches(e.match, t));
		return (t.cents * (rule?.multiplier ?? ca.card.baseMultiplier) * ca.card.pointValueCents) / 100;
	};
	/** What moving `t` off its card would cost in that card's own credits. */
	const benefitLoss = (t: BTxn) => {
		const ca = cardOf.get(t.account);
		if (!ca) return { cents: 0, names: [] as string[] };
		let cents = 0;
		const names: string[] = [];
		for (const b of ca.card.benefits) {
			const key = `${ca.card.id}/${b.id}`;
			const res = byKeyAcct.get(`${ca.account}|${key}`);
			if (!res || b.channel || res.redemption === 'free_membership') continue;
			const p = res.periods.find((p) => t.date >= p.start && t.date < p.end);
			if (!p || !CAPTURING.includes(p.status) || !p.onCard.some((x) => x.id === t.id)) continue;
			const before = Math.max(p.capturedCents, p.expectedCents);
			const spendLeft = Math.max(0, p.onCardCents - t.cents);
			const after = res.redemption === 'in_app' ? (spendLeft > 0 ? p.amountCents : 0) : Math.min(p.amountCents, spendLeft);
			const loss = Math.max(0, before - after);
			if (loss > 0) (cents += loss), names.push(b.name);
		}
		return { cents, names };
	};

	const txnById = new Map(all.map((t) => [t.id, t]));
	const moves: Move[] = [];
	for (const b of benefits) {
		if (b.channel || b.redemption === 'free_membership') continue;
		const ca = cardOf.get(b.account)!;
		const def = ca.card.benefits.find((x) => x.id === b.id)!;
		for (const p of b.periods) {
			let remaining = p.moveableCents;
			if (remaining <= 0) continue;
			const cands = [...p.elsewhere].sort((a, z) => z.cents - a.cents);
			for (const r of cands) {
				if (remaining <= 0) break;
				const t = txnById.get(r.id)!;
				const gain = Math.min(remaining, t.cents, def.maxPerTxnCents ?? Infinity);
				const pointsCost = Math.round(earnValue(t.account, t) - earnValue(b.account, t));
				const loss = benefitLoss(t);
				const net = gain - pointsCost - loss.cents;
				if (net <= 0) continue;
				remaining -= gain;
				moves.push({
					txn: r,
					fromAccount: t.account,
					fromCard: cardOf.get(t.account)?.card.name ?? null,
					toAccount: b.account,
					toCard: b.cardName,
					benefitKey: b.key,
					benefitName: b.name,
					periodLabel: p.label,
					open: p.open,
					gainCents: gain,
					pointsCostCents: pointsCost,
					benefitLossCents: loss.cents,
					lostBenefits: loss.names,
					netCents: net
				});
			}
		}
	}

	const actions = buildActions(benefits, moves, today);
	const actNow = benefits
		.flatMap((b) => {
			const p = b.periods.find((p) => p.open);
			if (!p || b.lifestyle || b.redemption === 'free_membership' || b.period === 'four_years') return [];
			const relevant = b.periods.some((q) => q.onCardCents || q.elsewhereCents || q.creditedCents || q.opportunityCents);
			if (!relevant) return [];
			const remaining = p.amountCents - Math.max(p.capturedCents, p.expectedCents);
			if (remaining <= 0 || b.enrollment === 'not_enrolled') return [];
			return [{ benefitKey: b.key, account: b.account, cardName: b.cardName, name: b.name, remainingCents: remaining, daysLeft: p.daysLeft ?? 0, periodLabel: p.label, how: b.channel ?? b.enrollHow ?? '', status: p.status }];
		})
		.sort((a, z) => a.daysLeft - z.daysLeft || z.remainingCents - a.remainingCents);

	const cards: CardSummary[] = cardAccts.map((ca) => {
		const bs = benefits.filter((b) => b.account === ca.account);
		const s = (f: (b: BenefitResult) => number, xs = bs) => xs.reduce((a, b) => a + f(b), 0);
		const core = bs.filter((b) => !b.lifestyle);
		return {
			account: ca.account,
			cardId: ca.card.id,
			cardName: ca.card.name,
			feeCents: ca.card.annualFeeCents,
			anniversary: ca.anniversary,
			anniversarySource: ca.anniversarySource,
			possibleCents: s((b) => b.totals.possibleCents, core),
			capturedCents: s((b) => b.totals.capturedCents),
			missedCents: s((b) => b.totals.missedCents, core),
			moveableCents: s((b) => b.totals.moveableCents, core),
			opportunityCents: s((b) => b.totals.opportunityCents, core),
			lifestyleUnusedCents: s((b) => b.totals.possibleCents - b.totals.capturedCents, bs.filter((b) => b.lifestyle))
		};
	});

	return {
		today,
		windowStart,
		yearStart: `${today.slice(0, 4)}-01-01`,
		cards,
		benefits,
		actions,
		actNow,
		pending: [...pending].map(([rubric, ids]) => ({ rubric, txnIds: [...ids] })),
		accounts: choices
	};
}

function periodResult(
	p: Period,
	b: BenefitDef,
	ca: CardAccount,
	today: string,
	enrollment: BenefitResult['enrollment'],
	eligibleOut: (readonly [BTxn, Verdict])[],
	oppOut: (readonly [BTxn, Verdict])[],
	credits: BTxn[],
	ref: (t: BTxn, v: Verdict) => TxnRef
): PeriodResult {
	const amount = b.period === 'month' && b.amountByMonth?.[Number(p.start.slice(5, 7))] != null ? b.amountByMonth[Number(p.start.slice(5, 7))] : b.amountCents;
	const open = p.end > today;
	const inP = eligibleOut.filter(([t, v]) => counts(v) && t.date >= p.start && t.date < p.end);
	const onCard = inP.filter(([t]) => t.account === ca.account);
	const elsewhere = inP.filter(([t]) => t.account !== ca.account);
	const onCardCents = onCard.reduce((a, [t]) => a + Math.min(t.cents, b.maxPerTxnCents ?? Infinity), 0);
	const elsewhereCents = elsewhere.reduce((a, [t]) => a + t.cents, 0);
	const creditedCents = credits.reduce((a, t) => a + t.cents, 0);
	const red = b.redemption.type;

	let captured = 0;
	let expected = 0;
	let status: Status;
	if (red === 'free_membership') {
		const paying = onCardCents + elsewhereCents;
		captured = enrollment === 'enrolled' && !paying ? amount : 0;
		status = paying ? 'paying' : enrollment === 'enrolled' ? 'used' : open ? 'open' : 'unused';
	} else if (red === 'in_app') {
		captured = onCardCents > 0 && enrollment !== 'not_enrolled' ? amount : 0;
		status = captured ? 'likely' : enrollment === 'not_enrolled' && onCardCents ? 'not_enrolled' : elsewhereCents ? 'missed' : open ? 'open' : 'unused';
	} else {
		captured = Math.min(amount, creditedCents);
		expected = enrollment === 'not_enrolled' ? 0 : Math.min(amount, onCardCents);
		const recent = open || daysBetween(p.end, today) < GRACE_DAYS;
		if (captured >= amount * 0.98) status = 'used';
		else if (captured > 0) status = recent && expected > captured ? 'awaiting' : 'partial';
		else if (onCardCents > 0) status = enrollment === 'not_enrolled' ? 'not_enrolled' : recent ? 'awaiting' : 'no_credit';
		else if (b.channel ? oppOut.some(([t]) => t.date >= p.start && t.date < p.end) : elsewhereCents > 0) status = 'missed';
		else status = open ? 'open' : 'unused';
	}
	// Room left for more qualifying spend. Spend already on the card counts even before its credit posts.
	const left = Math.max(0, amount - Math.max(captured, expected));
	const oppCents = b.channel ? oppOut.filter(([t]) => t.date >= p.start && t.date < p.end).reduce((a, [t]) => a + t.cents, 0) : 0;
	const moveable = b.channel || red === 'free_membership' ? 0 : Math.min(left, elsewhereCents);
	const missed = open ? 0 : red === 'free_membership' ? Math.min(amount, onCardCents + elsewhereCents) : Math.max(0, amount - captured);

	return {
		key: p.key,
		label: p.label,
		start: p.start,
		end: p.end,
		open,
		daysLeft: open ? daysBetween(today, p.end) : null,
		amountCents: amount,
		creditedCents,
		capturedCents: captured,
		expectedCents: expected,
		onCardCents,
		elsewhereCents,
		status,
		missedCents: missed,
		moveableCents: moveable,
		opportunityCents: Math.min(left, oppCents),
		onCard: onCard.map(([t, v]) => ref(t, v)),
		elsewhere: (b.channel ? oppOut.filter(([t]) => t.date >= p.start && t.date < p.end) : elsewhere).map(([t, v]) => ref(t, v)),
		credits: credits.map((t) => ref(t, 'yes'))
	};
}

/**
 * Recommendations. Benefits reset at least yearly, so each one is valued on the current calendar year only:
 * moves made this year, periods that overlap this year. Earlier moves stay in the list for context.
 */
function buildActions(benefits: BenefitResult[], moves: Move[], today: string): Action[] {
	const out: Action[] = [];
	const recent = addDays(today, -62);
	const yearStart = `${today.slice(0, 4)}-01-01`;
	const thisYear = (p: PeriodResult) => p.end > yearStart;

	// Moves, grouped by benefit and merchant
	const groups = new Map<string, Move[]>();
	for (const m of moves) {
		const k = `${m.toAccount}|${m.benefitKey}|${merchantKey(m.txn.merchant)}|${m.fromAccount}`;
		(groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
	}
	for (const all of groups.values()) {
		const ms = all.filter((m) => m.txn.date >= yearStart);
		if (!ms.length) continue;
		const m0 = ms[0];
		const value = ms.reduce((a, m) => a + m.netCents, 0);
		const last = ms.map((m) => m.txn.date).sort().at(-1)!;
		const costs = ms.reduce((a, m) => a + m.pointsCostCents + m.benefitLossCents, 0);
		const lost = [...new Set(ms.flatMap((m) => m.lostBenefits))];
		const earlier = all.length - ms.length;
		out.push({
			kind: 'move',
			benefitKey: m0.benefitKey,
			account: m0.toAccount,
			cardName: m0.toCard,
			title: `Pay ${m0.txn.merchant} with ${m0.toCard}`,
			detail:
				`${ms.length} purchase${ms.length > 1 ? 's' : ''} this year on ${m0.fromCard ?? m0.fromAccount} would have used the ${m0.benefitName}` +
				(costs > 0 ? `, after ${fmt(costs)} in lost ${lost.length ? lost.join(', ') + ' and ' : ''}points` : '') +
				(earlier ? ` (plus ${earlier} last year)` : '') +
				'.',
			valueCents: value,
			ongoing: last >= recent,
			merchants: [m0.txn.merchant],
			moves: [...all].sort((x, y) => y.txn.date.localeCompare(x.txn.date))
		});
	}

	for (const b of benefits) {
		const year = b.periods.filter(thisYear);
		const opportunity = year.reduce((a, p) => a + p.opportunityCents, 0);
		if (b.channel && opportunity > 0 && !b.lifestyle) {
			const ex = [...new Set(year.flatMap((p) => p.elsewhere.map((t) => t.merchant)))].slice(0, 4);
			out.push({
				kind: 'book',
				benefitKey: b.key,
				account: b.account,
				cardName: b.cardName,
				title: `Book through the channel for the ${b.name}`,
				detail: `${b.channel} You paid for stays at ${ex.join(', ')} another way. Hotel credits on different cards compete for the same stays.`,
				valueCents: opportunity,
				ongoing: true,
				merchants: ex,
				txns: newestFirst(year.filter((p) => p.opportunityCents > 0).flatMap((p) => p.elsewhere))
			});
		}
		const paying = year.reduce((a, p) => a + (p.status === 'paying' ? Math.min(p.amountCents, p.onCardCents + p.elsewhereCents) : 0), 0);
		if (b.redemption === 'free_membership' && paying > 0) {
			const paid = [...new Set(year.flatMap((p) => [...p.onCard, ...p.elsewhere].map((t) => t.merchant)))];
			const last = year.flatMap((p) => [...p.onCard, ...p.elsewhere].map((t) => t.date)).sort().at(-1) ?? '';
			out.push({
				kind: 'activate',
				benefitKey: b.key,
				account: b.account,
				cardName: b.cardName,
				title: `Stop paying for ${b.name}`,
				detail: `${b.cardName} includes it. ${b.enrollHow ?? ''}`,
				valueCents: paying,
				ongoing: last >= recent,
				merchants: paid,
				txns: newestFirst(year.filter((p) => p.status === 'paying').flatMap((p) => [...p.onCard, ...p.elsewhere]))
			});
		}
		const noCredit = year.filter((p) => !p.open && p.status === 'no_credit');
		if (noCredit.length && b.redemption === 'statement_credit') {
			out.push({
				kind: 'enroll',
				benefitKey: b.key,
				account: b.account,
				cardName: b.cardName,
				title: `${b.name}: qualifying spend but no credit`,
				detail:
					`${noCredit.length} period${noCredit.length > 1 ? 's' : ''} this year had eligible purchases on ${b.cardName} and no credit posted. ` +
					(b.enrollment === 'enrolled'
						? 'You look enrolled now, so this was probably before you enrolled, or the credit posted under a name Spendless doesn\'t recognise.'
						: b.enrollmentRequired
							? `Probably not enrolled. ${b.enrollHow}`
							: 'Check the statement; the credit may post under another name.'),
				valueCents: noCredit.reduce((a, p) => a + Math.min(p.amountCents, p.onCardCents) - p.capturedCents, 0),
				ongoing: true,
				merchants: [...new Set(noCredit.flatMap((p) => p.onCard.map((t) => t.merchant)))].slice(0, 4),
				txns: newestFirst(noCredit.flatMap((p) => p.onCard))
			});
		}
	}
	return out.sort((a, z) => z.valueCents - a.valueCents);
}

const newestFirst = (ts: TxnRef[]) => [...new Map(ts.map((t) => [t.id, t])).values()].sort((x, y) => y.date.localeCompare(x.date));

const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
