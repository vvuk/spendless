import type { DatabaseSync } from 'node:sqlite';
import { transaction, nowIso } from './db';

export type TextOp = 'is' | 'contains' | 'regex';

export interface Rule {
	id: number;
	priority: number;
	merchant_op: TextOp | null;
	merchant_value: string | null;
	statement_op: TextOp | null;
	statement_value: string | null;
	direction: 'out' | 'in' | null;
	min_cents: number | null;
	max_cents: number | null;
	account: string | null;
	monarch_category: string | null;
	date_from: string | null;
	date_to: string | null;
	set_category: string | null;
	set_merchant: string | null;
	recurring_kind: 'subscription' | 'bill' | 'obligation' | null;
	recurring_cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | null;
	enabled: number;
	created_at?: string;
	updated_at?: string | null;
}
export type RuleInput = Omit<Rule, 'id' | 'created_at' | 'updated_at'> & { id?: number };

/** The fields a rule sees: Monarch's raw values, never your overrides (so rules don't feed on each other). */
export interface RawTxn {
	id: string;
	date: string;
	merchant: string | null;
	statement: string | null;
	account: string;
	amount_cents: number;
	category: string | null;
}

function textTest(op: TextOp | null, value: string | null): ((s: string | null) => boolean) | null {
	if (!op || value == null || value === '') return null;
	const v = value.trim().toLowerCase();
	if (op === 'is') return (s) => (s ?? '').trim().toLowerCase() === v;
	if (op === 'contains') return (s) => (s ?? '').toLowerCase().includes(v);
	const re = new RegExp(value, 'i');
	return (s) => re.test(s ?? '');
}

export function conditionCount(r: Partial<Rule>) {
	return [
		r.merchant_op && r.merchant_value,
		r.statement_op && r.statement_value,
		r.direction,
		r.min_cents != null || r.max_cents != null,
		r.account,
		r.monarch_category,
		r.date_from || r.date_to
	].filter(Boolean).length;
}

/** Build a predicate for a rule. Throws on an invalid regex. */
export function compile(r: Rule): (t: RawTxn) => boolean {
	const m = textTest(r.merchant_op, r.merchant_value);
	const st = textTest(r.statement_op, r.statement_value);
	const acct = r.account?.toLowerCase();
	const mcat = r.monarch_category?.toLowerCase();
	return (t) => {
		if (r.direction === 'out' && t.amount_cents >= 0) return false;
		if (r.direction === 'in' && t.amount_cents <= 0) return false;
		const abs = Math.abs(t.amount_cents);
		if (r.min_cents != null && abs < r.min_cents) return false;
		if (r.max_cents != null && abs > r.max_cents) return false;
		if (r.date_from && t.date < r.date_from) return false;
		if (r.date_to && t.date > r.date_to) return false;
		if (acct && t.account.toLowerCase() !== acct) return false;
		if (mcat && (t.category ?? '').toLowerCase() !== mcat) return false;
		if (m && !m(t.merchant)) return false;
		if (st && !st(t.statement)) return false;
		return true;
	};
}

/** Evaluation order: explicit priority, then more conditions (more specific) first, then newest first. */
export function ordered<T extends Rule>(rules: T[]): T[] {
	return [...rules].sort(
		(a, b) => a.priority - b.priority || conditionCount(b) - conditionCount(a) || b.id - a.id
	);
}

export function loadRules(d: DatabaseSync): Rule[] {
	return d.prepare(`SELECT * FROM rules`).all() as unknown as Rule[];
}

export function loadRaw(d: DatabaseSync): RawTxn[] {
	return d
		.prepare(`SELECT id, date, merchant, statement, account, amount_cents, category FROM raw_transactions WHERE deleted_at IS NULL`)
		.all() as unknown as RawTxn[];
}

function firstMatch(compiled: { r: Rule; test: (t: RawTxn) => boolean }[], t: RawTxn) {
	for (const c of compiled) if (c.test(t)) return c.r;
	return undefined;
}

function compileAll(rules: Rule[]) {
	return ordered(rules.filter((r) => r.enabled)).flatMap((r) => {
		try {
			return [{ r, test: compile(r) }];
		} catch {
			return []; // bad regex: skip rather than break everything
		}
	});
}

/** Recompute rule_hits for every live transaction. First rule in evaluation order wins. */
export function applyRules(d: DatabaseSync) {
	const compiled = compileAll(loadRules(d));
	const txns = loadRaw(d);
	const ins = d.prepare(`INSERT INTO rule_hits (txn_id, rule_id, category, merchant) VALUES (?,?,?,?)`);
	transaction(d, () => {
		d.exec(`DELETE FROM rule_hits`);
		if (!compiled.length) return;
		for (const t of txns) {
			const hit = firstMatch(compiled, t);
			if (hit) ins.run(t.id, hit.id, hit.set_category, hit.set_merchant);
		}
	});
}

export function validate(r: RuleInput): string | null {
	if (!conditionCount(r)) return 'Add at least one condition, or the rule would match every transaction.';
	if (!r.set_category && !r.set_merchant && !r.recurring_kind) return 'Choose a category to set, a new merchant name, or track it as recurring.';
	for (const [op, v, label] of [[r.merchant_op, r.merchant_value, 'Merchant'], [r.statement_op, r.statement_value, 'Statement']] as const)
		if (op === 'regex' && v) {
			try { new RegExp(v, 'i'); } catch (e) { return `${label} pattern isn't a valid regular expression: ${(e as Error).message}`; }
		}
	if (r.min_cents != null && r.max_cents != null && r.min_cents > r.max_cents) return 'The minimum amount is larger than the maximum.';
	if (r.date_from && r.date_to && r.date_from > r.date_to) return 'The start date is after the end date.';
	return null;
}

const COLS = ['priority', 'merchant_op', 'merchant_value', 'statement_op', 'statement_value', 'direction', 'min_cents', 'max_cents',
	'account', 'monarch_category', 'date_from', 'date_to', 'set_category', 'set_merchant', 'recurring_kind', 'recurring_cadence', 'enabled'] as const;

export function saveRule(d: DatabaseSync, r: RuleInput): number {
	const err = validate(r);
	if (err) throw new Error(err);
	const vals = COLS.map((c) => (r[c] === undefined ? null : r[c]));
	let id: number;
	if (r.id) {
		d.prepare(`UPDATE rules SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, nowIso(), r.id);
		id = r.id;
	} else {
		const res = d.prepare(`INSERT INTO rules (${COLS.join(', ')}, created_at) VALUES (${COLS.map(() => '?').join(', ')}, ?)`).run(...vals, nowIso());
		id = Number(res.lastInsertRowid);
	}
	applyRules(d);
	return id;
}

export function deleteRule(d: DatabaseSync, id: number) {
	d.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
	applyRules(d);
}

export interface PreviewRow {
	id: string; date: string; merchant: string | null; statement: string | null; account: string; amount_cents: number;
	current: string; next: string; outcome: 'change' | 'same' | 'manual' | 'other_rule';
	other_rule?: number;
}

/**
 * What a draft rule would do, given every other rule and your one-off edits:
 * 'change' = category changes, 'same' = already that category, 'manual' = your one-off edit wins,
 * 'other_rule' = a rule that runs earlier claims it.
 */
export function previewRule(d: DatabaseSync, draft: RuleInput, limit = 200) {
	const draftRule: Rule = { ...draft, id: draft.id ?? Number.MAX_SAFE_INTEGER, enabled: 1 } as Rule;
	const test = compile(draftRule);
	const others = loadRules(d).filter((r) => r.id !== draft.id);
	const compiled = compileAll([...others, draftRule]);
	const overrides = new Map(
		(d.prepare(`SELECT txn_id, category FROM overrides WHERE category IS NOT NULL`).all() as { txn_id: string; category: string }[]).map((o) => [o.txn_id, o.category])
	);
	const current = new Map(
		(d.prepare(`SELECT id, category FROM txns`).all() as { id: string; category: string }[]).map((t) => [t.id, t.category])
	);
	const rows: PreviewRow[] = [];
	const counts = { total: 0, change: 0, same: 0, manual: 0, other_rule: 0 };
	const txns = loadRaw(d).filter(test).sort((a, b) => b.date.localeCompare(a.date));
	for (const t of txns) {
		const winner = firstMatch(compiled, t)!;
		const cur = current.get(t.id) ?? t.category ?? 'Uncategorized';
		const next = draft.set_category ?? cur;
		const outcome: PreviewRow['outcome'] = overrides.has(t.id)
			? 'manual'
			: winner.id !== draftRule.id
				? 'other_rule'
				: cur === next ? 'same' : 'change';
		counts.total++;
		counts[outcome]++;
		if (rows.length < limit)
			rows.push({ id: t.id, date: t.date, merchant: t.merchant, statement: t.statement, account: t.account, amount_cents: t.amount_cents, current: cur, next, outcome, other_rule: outcome === 'other_rule' ? winner.id : undefined });
	}
	return { counts, rows };
}

/** Plain-language summary of a rule's conditions. */
export function describe(r: Partial<Rule>): string[] {
	const out: string[] = [];
	const op = (o: TextOp | null | undefined) => (o === 'is' ? 'is' : o === 'contains' ? 'contains' : 'matches');
	if (r.merchant_op && r.merchant_value) out.push(`Merchant ${op(r.merchant_op)} “${r.merchant_value}”`);
	if (r.statement_op && r.statement_value) out.push(`Statement ${op(r.statement_op)} “${r.statement_value}”`);
	const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
	const dir = r.direction === 'out' ? 'Money out' : r.direction === 'in' ? 'Money in' : null;
	if (r.min_cents != null && r.max_cents != null && r.min_cents === r.max_cents) out.push(`${dir ?? 'Amount'} of exactly ${$(r.min_cents)}`);
	else if (r.min_cents != null && r.max_cents != null) out.push(`${dir ?? 'Amount'} between ${$(r.min_cents)} and ${$(r.max_cents)}`);
	else if (r.min_cents != null) out.push(`${dir ?? 'Amount'} of at least ${$(r.min_cents)}`);
	else if (r.max_cents != null) out.push(`${dir ?? 'Amount'} up to ${$(r.max_cents)}`);
	else if (dir) out.push(dir);
	if (r.account) out.push(`Account is ${r.account}`);
	if (r.monarch_category) out.push(`Monarch says ${r.monarch_category}`);
	if (r.date_from && r.date_to) out.push(`From ${r.date_from} to ${r.date_to}`);
	else if (r.date_from) out.push(`On or after ${r.date_from}`);
	else if (r.date_to) out.push(`On or before ${r.date_to}`);
	return out;
}
