import { getDb } from '#lib/server/db.ts';
import { categories, accounts } from '#lib/server/queries.ts';
import { loadRules, ordered, describe } from '#lib/server/rules.ts';

export const load = () => {
	const d = getDb();
	const hits = new Map(
		(d.prepare(`SELECT rule_id, COUNT(*) n FROM rule_hits GROUP BY rule_id`).all() as { rule_id: number; n: number }[]).map((h) => [h.rule_id, h.n])
	);
	const rules = ordered(loadRules(d)).map((r, i) => ({ ...r, order: i + 1, when: describe(r), matches: hits.get(r.id) ?? 0 }));
	return { rules, categories: categories(d), accounts: accounts(d) };
};
