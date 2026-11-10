import { fail } from '@sveltejs/kit';
import { getDb, nowIso } from '#lib/server/db.ts';
import { getRecurring, localToday } from '#lib/server/recurring.ts';

export const load = () => {
	const today = localToday();
	return { today, series: getRecurring(getDb(), today) };
};

const STATUSES = ['keep', 'cancel', 'cancelled', 'not_recurring'];
const KINDS = ['subscription', 'bill', 'obligation'];

function upsert(key: string, col: 'status' | 'kind', value: string | null) {
	const d = getDb();
	d.prepare(
		`INSERT INTO recurring_marks (series_key, ${col}, updated_at) VALUES (?,?,?)
		 ON CONFLICT(series_key) DO UPDATE SET ${col} = excluded.${col}, updated_at = excluded.updated_at`
	).run(key, value, nowIso());
	d.prepare(`DELETE FROM recurring_marks WHERE status IS NULL AND kind IS NULL AND note IS NULL`).run();
}

export const actions = {
	mark: async ({ request }) => {
		const f = await request.formData();
		const key = String(f.get('key') ?? '');
		const status = String(f.get('status') ?? '');
		if (!key) return fail(400, { error: 'Missing series' });
		if (status && !STATUSES.includes(status)) return fail(400, { error: 'Unknown status' });
		upsert(key, 'status', status || null);
		return { ok: true };
	},
	kind: async ({ request }) => {
		const f = await request.formData();
		const key = String(f.get('key') ?? '');
		const kind = String(f.get('kind') ?? '');
		if (!key) return fail(400, { error: 'Missing series' });
		if (kind && !KINDS.includes(kind)) return fail(400, { error: 'Unknown type' });
		upsert(key, 'kind', kind || null);
		return { ok: true };
	}
};
