import { json, error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { previewRule, saveRule, deleteRule, validate, type RuleInput } from '#lib/server/rules.ts';

/** POST { op: 'preview' | 'save' | 'delete', rule } */
export const POST = async ({ request }) => {
	const body = (await request.json()) as { op: string; rule: RuleInput };
	const d = getDb();
	const rule = normalize(body.rule);
	try {
		if (body.op === 'preview') {
			const problem = validate({ ...rule, set_category: rule.set_category ?? '(preview)' }); // preview before an action is chosen
			if (problem) return json({ problem });
			return json(previewRule(d, rule, 150));
		}
		if (body.op === 'save') return json({ id: saveRule(d, rule) });
		if (body.op === 'delete' && rule.id) {
			deleteRule(d, rule.id);
			return json({ ok: true });
		}
	} catch (e) {
		return json({ problem: (e as Error).message }, { status: 400 });
	}
	error(400, 'Unknown op');
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

function normalize(r: Partial<RuleInput>): RuleInput {
	const op = (v: unknown) => (v === 'is' || v === 'contains' || v === 'regex' ? v : null);
	return {
		id: int(r.id) ?? undefined,
		priority: int(r.priority) ?? 100,
		merchant_op: str(r.merchant_value) ? op(r.merchant_op) : null,
		merchant_value: op(r.merchant_op) ? str(r.merchant_value) : null,
		statement_op: str(r.statement_value) ? op(r.statement_op) : null,
		statement_value: op(r.statement_op) ? str(r.statement_value) : null,
		direction: r.direction === 'out' || r.direction === 'in' ? r.direction : null,
		min_cents: int(r.min_cents),
		max_cents: int(r.max_cents),
		account: str(r.account),
		monarch_category: str(r.monarch_category),
		date_from: str(r.date_from),
		date_to: str(r.date_to),
		set_category: str(r.set_category),
		set_merchant: str(r.set_merchant),
		recurring_kind: r.recurring_kind === 'subscription' || r.recurring_kind === 'bill' || r.recurring_kind === 'obligation' ? r.recurring_kind : null,
		recurring_cadence: r.recurring_kind
			? (['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual'].includes(String(r.recurring_cadence)) ? r.recurring_cadence! : 'monthly')
			: null,
		enabled: r.enabled === 0 ? 0 : 1
	};
}
