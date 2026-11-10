import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { syncFromMonarch } from '#lib/server/sync/monarchMcp.ts';
import { classifyAfterSync } from '#lib/server/benefits/auto.ts';

export const actions = {
	default: async ({ locals }) => {
		// a sync would pull your real data into the demo database
		if (locals.demo) return fail(400, { error: 'Sync is off in demo mode.' });
		try {
			const d = getDb();
			const r = await syncFromMonarch(d, { interactive: false });
			// judge new purchases for card benefits; never fails the sync
			const benefits = await classifyAfterSync(d, console.log);
			return { ok: true, ...r, classified: benefits?.asked ?? 0 };
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
	}
};
