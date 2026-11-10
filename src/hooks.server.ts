import type { Handle } from '@sveltejs/kit/hooks';
import { withDb } from '#lib/server/db.ts';
import { DEMO_COOKIE, getDemoDb } from '#lib/server/demo/index.ts';

/** In demo mode every load, action and API call in the request reads and writes the demo database. */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.demo = event.cookies.get(DEMO_COOKIE) === '1';
	if (!event.locals.demo) return resolve(event);
	return withDb(getDemoDb(), () => resolve(event));
};
