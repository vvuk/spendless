import type { DatabaseSync } from 'node:sqlite';
import { FIXED_CATEGORIES } from '#lib/categories-shared.ts';
import { addMonths } from '#lib/format.ts';
import { localToday } from './recurring';

const FIXED_SQL = `(${FIXED_CATEGORIES.map((c: string) => `'${c.replace(/'/g, "''")}'`).join(',')})`;

export function monthlySpend(d: DatabaseSync, endMonth: string, n = 25) {
	const start = addMonths(endMonth, -(n - 1));
	const rows = d
		.prepare(
			`SELECT month,
			        SUM(CASE WHEN category IN ${FIXED_SQL} THEN spend_cents ELSE 0 END) AS fixed,
			        SUM(CASE WHEN category IN ${FIXED_SQL} THEN 0 ELSE spend_cents END) AS flexible
			 FROM txns WHERE month BETWEEN ? AND ? GROUP BY month`
		)
		.all(start, endMonth) as { month: string; fixed: number; flexible: number }[];
	const by = new Map(rows.map((r) => [r.month, r]));
	return Array.from({ length: n }, (_, i) => {
		const m = addMonths(start, i);
		const r = by.get(m);
		return { month: m, fixed: Math.max(0, r?.fixed ?? 0), flexible: Math.max(0, r?.flexible ?? 0) };
	});
}

/** Month-to-date numbers for the headline row. */
export function monthSummary(d: DatabaseSync, month: string) {
	const today = localToday();
	const isCurrent = today.startsWith(month);
	const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : 31;
	const sum = (sql: string, ...args: (string | number)[]) =>
		(d.prepare(sql).get(...args) as { s: number | null }).s ?? 0;

	const spent = sum(`SELECT SUM(spend_cents) s FROM txns WHERE month = ?`, month);
	const fixed = sum(`SELECT SUM(spend_cents) s FROM txns WHERE month = ? AND category IN ${FIXED_SQL}`, month);
	const prev = addMonths(month, -1);
	const prevSameDay = sum(
		`SELECT SUM(spend_cents) s FROM txns WHERE month = ? AND CAST(substr(date, 9, 2) AS INTEGER) <= ?`,
		prev,
		dayOfMonth
	);
	const prevTotal = sum(`SELECT SUM(spend_cents) s FROM txns WHERE month = ?`, prev);
	const avg12 =
		sum(`SELECT SUM(spend_cents) s FROM txns WHERE month BETWEEN ? AND ?`, addMonths(month, -12), prev) / 12;
	const avg12Flexible =
		sum(`SELECT SUM(spend_cents) s FROM txns WHERE month BETWEEN ? AND ? AND category NOT IN ${FIXED_SQL}`, addMonths(month, -12), prev) / 12;
	return { month, isCurrent, dayOfMonth, spent, fixed, flexible: spent - fixed, prevSameDay, prevTotal, avg12, avg12Flexible };
}

export interface CategoryRow {
	category: string;
	group: string;
	fixed: boolean;
	month: number;
	avg: number;
	trend: number[]; // 13 months ending at the selected month
	total12: number;
}

export function categoryTable(d: DatabaseSync, month: string): CategoryRow[] {
	const start = addMonths(month, -12);
	const rows = d
		.prepare(
			`SELECT category, category_group AS grp, month, SUM(spend_cents) AS s
			 FROM txns WHERE month BETWEEN ? AND ? AND kind = 'expense' GROUP BY category, month`
		)
		.all(start, month) as { category: string; grp: string; month: string; s: number }[];
	const map = new Map<string, CategoryRow>();
	for (const r of rows) {
		let row = map.get(r.category);
		if (!row) {
			row = { category: r.category, group: r.grp, fixed: FIXED_CATEGORIES.includes(r.category), month: 0, avg: 0, trend: Array(13).fill(0), total12: 0 };
			map.set(r.category, row);
		}
		const i = 12 - monthsBetween(r.month, month);
		row.trend[i] = r.s;
		if (r.month === month) row.month = r.s;
		else row.total12 += r.s;
	}
	for (const row of map.values()) row.avg = row.total12 / 12;
	return [...map.values()].filter((r) => r.total12 > 0 || r.month > 0).sort((a, b) => b.total12 + b.month - (a.total12 + a.month));
}

/** Spending per category per month over the whole history (for range totals). */
export function categoryMonthly(d: DatabaseSync) {
	return d
		.prepare(
			`SELECT category, category_group AS grp, month, SUM(spend_cents) AS s
			 FROM txns WHERE kind = 'expense' GROUP BY category, month HAVING s <> 0`
		)
		.all() as { category: string; grp: string; month: string; s: number }[];
}

const monthsBetween = (a: string, b: string) => {
	const [ya, ma] = a.split('-').map(Number);
	const [yb, mb] = b.split('-').map(Number);
	return (yb - ya) * 12 + (mb - ma);
};

export function topMerchants(d: DatabaseSync, days = 90, limit = 14) {
	const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
	return d
		.prepare(
			`SELECT merchant, SUM(spend_cents) AS total, COUNT(*) AS n,
			        (SELECT category FROM txns t2 WHERE t2.merchant = t.merchant AND t2.date >= ? GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1) AS category
			 FROM txns t WHERE date >= ? AND spend_cents > 0 AND category NOT IN ${FIXED_SQL}
			 GROUP BY merchant ORDER BY total DESC LIMIT ?`
		)
		.all(since, since, limit) as { merchant: string; total: number; n: number; category: string }[];
}

export function lastSync(d: DatabaseSync) {
	return d
		.prepare(`SELECT source, finished_at, error, inserted, updated, deleted FROM sync_runs ORDER BY id DESC LIMIT 1`)
		.get() as { source: string; finished_at: string; error: string | null; inserted: number; updated: number; deleted: number } | undefined;
}

export function netWorth(d: DatabaseSync) {
	const r = d.prepare(`SELECT SUM(balance_cents) s, COUNT(balance_cents) n, MAX(balance_at) at FROM accounts`).get() as { s: number | null; n: number; at: string | null };
	return r.n ? { cents: r.s ?? 0, at: r.at } : null;
}

export function latestMonth(d: DatabaseSync) {
	return (d.prepare(`SELECT MAX(month) m FROM txns`).get() as { m: string | null }).m ?? localToday().slice(0, 7);
}

export function categories(d: DatabaseSync) {
	return d.prepare(`SELECT name, group_name AS grp, kind FROM categories ORDER BY group_name, name`).all() as { name: string; grp: string; kind: string }[];
}

export interface TxnFilter { q?: string; month?: string; category?: string; source?: string; limit?: number; offset?: number }

export function transactions(d: DatabaseSync, f: TxnFilter) {
	const where: string[] = [];
	const args: (string | number)[] = [];
	// a renamed transaction is still found by Monarch's name; notes are yours, else Monarch's
	if (f.q) {
		where.push(`(merchant LIKE ? OR monarch_merchant LIKE ? OR statement LIKE ? OR notes LIKE ?)`);
		args.push(...Array(4).fill(`%${f.q}%`));
	}
	if (f.month) { where.push(`month = ?`); args.push(f.month); }
	if (f.category) { where.push(`category = ?`); args.push(f.category); }
	if (f.source) { where.push(`category_source = ?`); args.push(f.source); }
	const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const total = (d.prepare(`SELECT COUNT(*) n, SUM(amount_cents) s FROM txns ${w}`).get(...args) as { n: number; s: number | null });
	const rows = d
		.prepare(
			`SELECT id, date, merchant, monarch_merchant, statement, category, category_source, rule_id, monarch_category, account, amount_cents, pending, excluded, notes,
			        merchant_source, monarch_notes
			 FROM txns ${w} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`
		)
		.all(...args, f.limit ?? 150, f.offset ?? 0) as {
		id: string; date: string; merchant: string; monarch_merchant: string | null; statement: string | null; category: string; category_source: string; rule_id: number | null;
		monarch_category: string | null; account: string; amount_cents: number; pending: number; excluded: number; notes: string | null;
		merchant_source: 'manual' | 'rule' | 'monarch'; monarch_notes: string | null;
	}[];
	return { rows, count: total.n, sum: total.s ?? 0 };
}

export function accounts(d: DatabaseSync) {
	return (d.prepare(`SELECT name FROM accounts ORDER BY name`).all() as { name: string }[]).map((a) => a.name);
}
