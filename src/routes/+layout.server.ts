import { getDb } from '#lib/server/db.ts';
import { lastSync } from '#lib/server/queries.ts';

export const load = ({ locals }) => ({ sync: lastSync(getDb()) ?? null, demo: locals.demo });
