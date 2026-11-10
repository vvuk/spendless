import { redirect } from '@sveltejs/kit';
import { DEMO_COOKIE } from '#lib/server/demo/index.ts';

export const load = () => redirect(303, '/');

export const actions = {
	/** Turn demo mode on or off, then go back to the page the toggle was clicked on. */
	default: async ({ request, cookies }) => {
		const f = await request.formData();
		if (f.get('on') === '1') cookies.set(DEMO_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
		else cookies.delete(DEMO_COOKIE, { path: '/' });
		const to = String(f.get('to') ?? '/');
		redirect(303, to.startsWith('/') && !to.startsWith('//') ? to : '/');
	}
};
