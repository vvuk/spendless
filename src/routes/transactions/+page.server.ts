import { fail } from '@sveltejs/kit';
import { getDb, nowIso } from '#lib/server/db.ts';
import { transactions, categories, accounts } from '#lib/server/queries.ts';
import { applyRules } from '#lib/server/rules.ts';

const PAGE = 150;

export const load = ({ url }) => {
	const d = getDb();
	const f = {
		q: url.searchParams.get('q') ?? '',
		month: url.searchParams.get('month') ?? '',
		category: url.searchParams.get('category') ?? '',
		source: url.searchParams.get('source') ?? ''
	};
	const page = Math.max(0, Number(url.searchParams.get('page') ?? 0));
	const res = transactions(d, { ...f, limit: PAGE, offset: page * PAGE });
	const months = (d.prepare(`SELECT DISTINCT month FROM txns ORDER BY month DESC`).all() as { month: string }[]).map((r) => r.month);
	const rules = d.prepare(`SELECT COUNT(*) n FROM rules WHERE enabled = 1`).get() as { n: number };
	return { f, page, pageSize: PAGE, ...res, months, categories: categories(d), accounts: accounts(d), ruleCount: rules.n };
};

export const actions = {
	/** Change one transaction's category. Picking Monarch's own category again clears your edit. */
	categorize: async ({ request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const category = String(f.get('category') ?? '');
		const d = getDb();
		const t = d.prepare(`SELECT category, monarch_category, category_source FROM txns WHERE id = ?`).get(id) as
			{ category: string; monarch_category: string | null; category_source: string } | undefined;
		if (!t) return fail(404, { error: 'Transaction not found' });
		// keep an explicit edit whenever it differs from what Monarch or a rule would give
		const ruled = (d.prepare(`SELECT category FROM rule_hits WHERE txn_id = ?`).get(id) as { category: string | null } | undefined)?.category;
		const fallback = ruled ?? t.monarch_category;
		const value = category && category !== fallback ? category : null;
		d.prepare(
			`INSERT INTO overrides (txn_id, category, updated_at) VALUES (?,?,?)
			 ON CONFLICT(txn_id) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`
		).run(id, value, nowIso());
		return { ok: true };
	},
	exclude: async ({ request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const on = f.get('excluded') === '1';
		getDb()
			.prepare(
				`INSERT INTO overrides (txn_id, excluded, updated_at) VALUES (?,?,?)
				 ON CONFLICT(txn_id) DO UPDATE SET excluded = excluded.excluded, updated_at = excluded.updated_at`
			)
			.run(id, on ? 1 : null, nowIso());
		return { ok: true };
	},
	/** Rename one transaction. An empty name, or the name a rule or Monarch would give, clears your edit. */
	rename: async ({ request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const name = String(f.get('name') ?? '').trim().replace(/\s+/g, ' ');
		const d = getDb();
		const r = d
			.prepare(`SELECT r.merchant, r.statement, h.merchant AS ruled FROM raw_transactions r LEFT JOIN rule_hits h ON h.txn_id = r.id WHERE r.id = ?`)
			.get(id) as { merchant: string | null; statement: string | null; ruled: string | null } | undefined;
		if (!r) return fail(404, { error: 'Transaction not found' });
		if (name.length > 200) return fail(400, { error: 'That name is too long' });
		const fallback = r.ruled ?? r.merchant ?? r.statement;
		const value = name && name !== fallback ? name : null;
		d.prepare(
			`INSERT INTO overrides (txn_id, merchant, updated_at) VALUES (?,?,?)
			 ON CONFLICT(txn_id) DO UPDATE SET merchant = excluded.merchant, updated_at = excluded.updated_at`
		).run(id, value, nowIso());
		return { ok: true };
	},
	/** Set your note on a transaction. It replaces Monarch's note; saving Monarch's text unchanged clears your edit. */
	note: async ({ request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const note = String(f.get('note') ?? '').trim();
		const d = getDb();
		const r = d.prepare(`SELECT notes FROM raw_transactions WHERE id = ?`).get(id) as { notes: string | null } | undefined;
		if (!r) return fail(404, { error: 'Transaction not found' });
		if (note.length > 2000) return fail(400, { error: 'That note is too long' });
		// '' is kept when Monarch has a note, so clearing it hides Monarch's too
		const value = note === (r.notes ?? '').trim() ? null : note;
		d.prepare(
			`INSERT INTO overrides (txn_id, note, updated_at) VALUES (?,?,?)
			 ON CONFLICT(txn_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
		).run(id, value, nowIso());
		return { ok: true };
	},
	reapply: async () => {
		applyRules(getDb());
		return { ok: true };
	}
};
