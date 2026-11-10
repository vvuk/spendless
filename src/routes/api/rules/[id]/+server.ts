import { json, error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';

export const GET = ({ params }) => {
	const r = getDb().prepare(`SELECT * FROM rules WHERE id = ?`).get(Number(params.id));
	if (!r) error(404, 'No such rule');
	return json(r);
};
