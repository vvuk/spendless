import type { DatabaseSync } from 'node:sqlite';
import { nowIso, transaction } from '../db';
import { applyRules } from '../rules';

/** One transaction as a source reports it. `undefined` = "this source doesn't know", keep what we have. */
export interface IncomingTxn {
	id: string;
	date: string;
	amountCents: number;
	account: string;
	pending: boolean;
	merchant?: string | null;
	statement?: string | null;
	category?: string | null;
	notes?: string | null;
	tags?: string | null;
	owner?: string | null;
}

export interface UpsertResult {
	inserted: number;
	updated: number;
	deleted: number;
	unchanged: number;
}

const FIELDS = ['date', 'amount_cents', 'account', 'merchant', 'statement', 'category', 'notes', 'tags', 'owner', 'pending'] as const;
type Row = Record<(typeof FIELDS)[number], string | number | null>;

function toRow(t: IncomingTxn, prev?: Row): Row {
	const keep = <K extends keyof Row>(k: K, v: string | number | null | undefined) =>
		v === undefined ? (prev?.[k] ?? null) : v;
	return {
		date: t.date,
		amount_cents: t.amountCents,
		account: t.account,
		merchant: keep('merchant', t.merchant),
		statement: keep('statement', t.statement),
		category: keep('category', t.category),
		notes: keep('notes', t.notes),
		tags: keep('tags', t.tags),
		owner: keep('owner', t.owner),
		pending: t.pending ? 1 : 0
	};
}

/**
 * Upsert transactions by Monarch id. If `window` is given, the source is treated as the complete
 * truth for that date range: anything in the range it didn't report is marked deleted
 * (this is how pending charges that later post under a new id get cleaned up).
 */
export function upsertTransactions(
	d: DatabaseSync,
	rows: IncomingTxn[],
	source: 'csv' | 'mcp',
	window?: { start: string; end: string }
): UpsertResult {
	const res: UpsertResult = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
	const now = nowIso();
	const get = d.prepare(`SELECT ${FIELDS.join(',')}, deleted_at FROM raw_transactions WHERE id = ?`);
	const ins = d.prepare(
		`INSERT INTO raw_transactions (id, ${FIELDS.join(',')}, source, first_seen_at, last_seen_at)
		 VALUES (?, ${FIELDS.map(() => '?').join(',')}, ?, ?, ?)`
	);
	const upd = d.prepare(
		`UPDATE raw_transactions SET ${FIELDS.map((f) => `${f} = ?`).join(',')},
		 source = ?, last_seen_at = ?, deleted_at = NULL WHERE id = ?`
	);
	const touch = d.prepare(`UPDATE raw_transactions SET last_seen_at = ? WHERE id = ?`);
	const acct = d.prepare(`INSERT OR IGNORE INTO accounts (name) VALUES (?)`);

	transaction(d, () => {
		d.exec(`CREATE TEMP TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY); DELETE FROM seen;`);
		const seen = d.prepare(`INSERT OR IGNORE INTO seen (id) VALUES (?)`);
		const accounts = new Set<string>();

		for (const t of rows) {
			seen.run(t.id);
			accounts.add(t.account);
			const prev = get.get(t.id) as (Row & { deleted_at: string | null }) | undefined;
			const row = toRow(t, prev);
			const vals = FIELDS.map((f) => row[f]);
			if (!prev) {
				ins.run(t.id, ...vals, source, now, now);
				res.inserted++;
			} else if (prev.deleted_at || FIELDS.some((f) => prev[f] !== row[f])) {
				upd.run(...vals, source, now, t.id);
				res.updated++;
			} else {
				touch.run(now, t.id);
				res.unchanged++;
			}
		}
		for (const a of accounts) acct.run(a);

		if (window) {
			const r = d
				.prepare(
					`UPDATE raw_transactions SET deleted_at = ?
					 WHERE deleted_at IS NULL AND date BETWEEN ? AND ? AND id NOT IN (SELECT id FROM seen)`
				)
				.run(now, window.start, window.end);
			res.deleted = Number(r.changes);
		}
	});

	applyRules(d);
	return res;
}

export function recordRun(
	d: DatabaseSync,
	source: string,
	startedAt: string,
	r: Partial<UpsertResult>,
	window?: { start: string; end: string },
	error?: string
) {
	d.prepare(
		`INSERT INTO sync_runs (source, started_at, finished_at, window_start, window_end, inserted, updated, deleted, error)
		 VALUES (?,?,?,?,?,?,?,?,?)`
	).run(source, startedAt, nowIso(), window?.start ?? null, window?.end ?? null, r.inserted ?? 0, r.updated ?? 0, r.deleted ?? 0, error ?? null);
}
