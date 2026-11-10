/** Form state for the rule editor, and conversion to/from stored rules. Client-safe. */
export type TextOp = 'is' | 'contains' | 'regex';
export type AmountMode = 'exactly' | 'between' | 'atleast' | 'atmost';

export interface StoredRule {
	id?: number;
	priority?: number;
	merchant_op: TextOp | null; merchant_value: string | null;
	statement_op: TextOp | null; statement_value: string | null;
	direction: 'out' | 'in' | null;
	min_cents: number | null; max_cents: number | null;
	account: string | null; monarch_category: string | null;
	date_from: string | null; date_to: string | null;
	set_category: string | null; set_merchant: string | null;
	recurring_kind?: RecurringKind | null; recurring_cadence?: Cadence | null;
	enabled?: number;
}
export type RecurringKind = 'subscription' | 'bill' | 'obligation';
export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface Draft {
	id?: number;
	priority: number;
	enabled: number;
	merchant: { on: boolean; op: TextOp; value: string };
	statement: { on: boolean; op: TextOp; value: string };
	amount: { on: boolean; mode: AmountMode; a: string; b: string };
	direction: { on: boolean; value: 'out' | 'in' };
	account: { on: boolean; value: string };
	monarch: { on: boolean; value: string };
	dates: { on: boolean; from: string; to: string };
	set_category: string;
	set_merchant: string;
	recurring: { on: boolean; kind: RecurringKind; cadence: Cadence };
}

const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));
const cents = (s: string) => {
	const n = Number(s.replace(/[$,\s]/g, ''));
	return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(Math.abs(n) * 100);
};

export interface TxnLike {
	date: string; merchant: string; monarch_merchant: string | null; statement: string | null;
	account: string; amount_cents: number; category: string; monarch_category: string | null;
}

/** Start a rule from one transaction: same merchant, same exact amount, same direction. */
export function draftFromTxn(t: TxnLike): Draft {
	return {
		priority: 100,
		enabled: 1,
		merchant: { on: !!(t.monarch_merchant ?? t.merchant), op: 'is', value: t.monarch_merchant ?? t.merchant },
		statement: { on: false, op: 'contains', value: t.statement ?? '' },
		amount: { on: true, mode: 'exactly', a: dollars(Math.abs(t.amount_cents)), b: '' },
		direction: { on: true, value: t.amount_cents < 0 ? 'out' : 'in' },
		account: { on: false, value: t.account },
		monarch: { on: false, value: t.monarch_category ?? '' },
		dates: { on: false, from: t.date, to: '' },
		set_category: t.category,
		set_merchant: '',
		recurring: { on: false, kind: 'obligation', cadence: 'monthly' }
	};
}

export function blankDraft(): Draft {
	return {
		priority: 100, enabled: 1,
		merchant: { on: true, op: 'is', value: '' },
		statement: { on: false, op: 'contains', value: '' },
		amount: { on: false, mode: 'exactly', a: '', b: '' },
		direction: { on: false, value: 'out' },
		account: { on: false, value: '' },
		monarch: { on: false, value: '' },
		dates: { on: false, from: '', to: '' },
		set_category: '', set_merchant: '',
		recurring: { on: false, kind: 'obligation', cadence: 'monthly' }
	};
}

export function draftFromRule(r: StoredRule & { id: number }): Draft {
	const mode: AmountMode =
		r.min_cents != null && r.max_cents != null ? (r.min_cents === r.max_cents ? 'exactly' : 'between')
		: r.min_cents != null ? 'atleast' : 'atmost';
	return {
		id: r.id,
		priority: r.priority ?? 100,
		enabled: r.enabled ?? 1,
		merchant: { on: !!r.merchant_op, op: r.merchant_op ?? 'is', value: r.merchant_value ?? '' },
		statement: { on: !!r.statement_op, op: r.statement_op ?? 'contains', value: r.statement_value ?? '' },
		amount: {
			on: r.min_cents != null || r.max_cents != null, mode,
			a: dollars(mode === 'atmost' ? r.max_cents : r.min_cents), b: mode === 'between' ? dollars(r.max_cents) : ''
		},
		direction: { on: !!r.direction, value: r.direction ?? 'out' },
		account: { on: !!r.account, value: r.account ?? '' },
		monarch: { on: !!r.monarch_category, value: r.monarch_category ?? '' },
		dates: { on: !!(r.date_from || r.date_to), from: r.date_from ?? '', to: r.date_to ?? '' },
		set_category: r.set_category ?? '',
		set_merchant: r.set_merchant ?? '',
		recurring: { on: !!r.recurring_kind, kind: r.recurring_kind ?? 'obligation', cadence: r.recurring_cadence ?? 'monthly' }
	};
}

export function draftToRule(d: Draft): StoredRule {
	let min: number | null = null, max: number | null = null;
	if (d.amount.on) {
		const a = cents(d.amount.a), b = cents(d.amount.b);
		if (d.amount.mode === 'exactly') min = max = a;
		else if (d.amount.mode === 'between') { min = a; max = b; }
		else if (d.amount.mode === 'atleast') min = a;
		else max = a;
	}
	return {
		id: d.id,
		priority: d.priority,
		enabled: d.enabled,
		merchant_op: d.merchant.on ? d.merchant.op : null, merchant_value: d.merchant.on ? d.merchant.value : null,
		statement_op: d.statement.on ? d.statement.op : null, statement_value: d.statement.on ? d.statement.value : null,
		direction: d.direction.on ? d.direction.value : null,
		min_cents: min, max_cents: max,
		account: d.account.on ? d.account.value : null,
		monarch_category: d.monarch.on ? d.monarch.value : null,
		date_from: d.dates.on ? d.dates.from || null : null, date_to: d.dates.on ? d.dates.to || null : null,
		set_category: d.set_category || null, set_merchant: d.set_merchant || null,
		recurring_kind: d.recurring.on ? d.recurring.kind : null,
		recurring_cadence: d.recurring.on ? d.recurring.cadence : null
	};
}
