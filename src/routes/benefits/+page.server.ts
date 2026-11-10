import { fail } from '@sveltejs/kit';
import { getDb, nowIso } from '#lib/server/db.ts';
import { localToday } from '#lib/server/recurring.ts';
import { analyzeBenefits } from '#lib/server/benefits/analyze.ts';
import { CARDS } from '#lib/server/benefits/cards/index.ts';
import { classifyPending, llmConfigured, llmModel } from '#lib/server/benefits/llm.ts';
import { setEnrollment, enrollmentQueue } from '#lib/server/benefits/enroll.ts';

export const load = () => {
	const d = getDb();
	const a = analyzeBenefits(d, localToday());
	const exclusions = d
		.prepare(
			`SELECT o.benefit_id, o.txn_id, o.eligible, t.date, t.merchant, -t.amount_cents AS cents, t.account
			 FROM benefit_txn_overrides o JOIN txns t ON t.id = o.txn_id ORDER BY t.date DESC`
		)
		.all() as { benefit_id: string; txn_id: string; eligible: number; date: string; merchant: string; cents: number; account: string }[];
	return {
		...a,
		enrollQueue: enrollmentQueue(a),
		exclusions,
		cardDefs: CARDS.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, notes: c.sourceNotes ?? null })),
		llm: { configured: llmConfigured(), model: llmModel(), pending: a.pending.reduce((s, p) => s + p.txnIds.length, 0) }
	};
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export const actions = {
	enroll: async ({ request }) => {
		const f = await request.formData();
		const account = str(f, 'account');
		const key = str(f, 'key');
		const status = str(f, 'status');
		if (!account || !key) return fail(400, { error: 'Missing benefit' });
		if (status && status !== 'enrolled' && status !== 'not_enrolled') return fail(400, { error: 'Unknown status' });
		setEnrollment(getDb(), account, key, (status || null) as 'enrolled' | 'not_enrolled' | null);
		return { ok: true };
	},
	map: async ({ request }) => {
		const f = await request.formData();
		const account = str(f, 'account');
		const card = str(f, 'card'); // '' = automatic, 'none' = not a tracked card
		const anniversary = str(f, 'anniversary'); // MM-DD or ''
		if (!account) return fail(400, { error: 'Missing account' });
		if (card && card !== 'none' && !CARDS.some((c) => c.id === card)) return fail(400, { error: 'Unknown card' });
		if (anniversary && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(anniversary)) return fail(400, { error: 'Anniversary must be MM-DD' });
		const d = getDb();
		if (!card && !anniversary) d.prepare(`DELETE FROM card_accounts WHERE account = ?`).run(account);
		else
			d.prepare(
				`INSERT INTO card_accounts (account, card_id, anniversary, updated_at) VALUES (?,?,?,?)
				 ON CONFLICT(account) DO UPDATE SET card_id = excluded.card_id, anniversary = excluded.anniversary, updated_at = excluded.updated_at`
			).run(account, card === 'none' ? null : card || autoCard(account), anniversary || null, nowIso());
		return { ok: true };
	},
	override: async ({ request }) => {
		const f = await request.formData();
		const key = str(f, 'key');
		const txn = str(f, 'txn');
		const eligible = str(f, 'eligible'); // '1', '0', or '' to clear
		if (!key || !txn) return fail(400, { error: 'Missing transaction' });
		const d = getDb();
		if (eligible === '') d.prepare(`DELETE FROM benefit_txn_overrides WHERE benefit_id = ? AND txn_id = ?`).run(key, txn);
		else
			d.prepare(
				`INSERT INTO benefit_txn_overrides (benefit_id, txn_id, eligible, updated_at) VALUES (?,?,?,?)
				 ON CONFLICT(benefit_id, txn_id) DO UPDATE SET eligible = excluded.eligible, updated_at = excluded.updated_at`
			).run(key, txn, eligible === '1' ? 1 : 0, nowIso());
		return { ok: true };
	},
	classify: async ({ locals }) => {
		if (locals.demo) return fail(400, { error: 'Classification is off in demo mode; the demo data comes with its answers.' });
		if (!llmConfigured()) return fail(400, { error: 'Set OPENROUTER_API_KEY in .env first.' });
		const d = getDb();
		const a = analyzeBenefits(d, localToday());
		try {
			const r = await classifyPending(d, a.pending, { limit: 400 });
			if (r.errors.length && !r.asked) return fail(502, { error: r.errors[0] });
			return { ok: true, classified: r };
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
	}
};

/** Keep the detected card when only the anniversary is being set. */
function autoCard(account: string) {
	const a = analyzeBenefits(getDb(), localToday(), { days: 31 });
	return a.cards.find((c) => c.account === account)?.cardId ?? null;
}
