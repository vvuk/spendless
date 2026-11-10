import type { DatabaseSync } from 'node:sqlite';
import { detectRecurring, localToday, type Charge } from './recurring.ts';

/**
 * Money coming in, split into recurring income (paychecks, rent from a tenant: anything that
 * arrives on a regular beat) and everything else (stock sales, one-off payments, refunds of taxes...).
 *
 * Sources:
 * - transactions in an income category;
 * - transfers in, because Monarch files a tenant's rent and money from an unsynced brokerage as plain
 *   transfers. Card accounts are skipped (money in there is a card payment).
 * Either way, money that is really a move between your own accounts is left out: another synced account
 * has the matching outflow within 5 days, or the bank's description says it came from your own checking
 * or savings. (Monarch sometimes files such moves as "Other Income".) Paychecks are always kept.
 * Marking a transaction "don't count" on the Transactions page removes it.
 */
export interface Inflow {
	id: string;
	date: string;
	month: string;
	cents: number;
	merchant: string;
	category: string;
	account: string;
	source: 'income' | 'transfer';
	recurring: boolean;
}

// Monarch's own name "Transfer From Checking", or a bank description "transfer from CHK 1234" where 1234 is one
// of your accounts (a tenant paying from their BoA account reads "from CHK 5678"). Not "from BRK": money out of
// a brokerage is a sale.
const FROM_OWN_WORDS = /\bfrom (checking|savings)\b|\bfrom check\b/i;
const FROM_ACCOUNT_NO = /\bfrom (?:chk|sav|checking|savings)\s*(?:\.{3}|x+|\*+)?(\d{4})\b/gi;
const RENT = /\brent(al)?\b/i;

export function loadInflows(d: DatabaseSync, today = localToday()): Inflow[] {
	// last four digits of every synced account, from names like "Personal Checking (...1234)"
	const own = new Set(
		(d.prepare(`SELECT name FROM accounts`).all() as { name: string }[]).map((a) => a.name.match(/(\d{4})\)?\s*$/)?.[1]).filter(Boolean) as string[]
	);
	const rows = (
		d
			.prepare(
				`SELECT t.id, t.date, t.month, t.amount_cents AS cents, t.merchant, COALESCE(t.statement, '') AS statement, t.category, t.account, t.kind
				 FROM txns t LEFT JOIN accounts a ON a.name = t.account
				 WHERE t.amount_cents > 0 AND t.excluded = 0
				   AND (t.kind = 'income' OR (t.kind = 'transfer' AND t.category = 'Transfer' AND COALESCE(a.type, '') <> 'Credit Card'))
				   AND (t.category = 'Paychecks' OR NOT EXISTS (
				         SELECT 1 FROM txns o
				         WHERE o.amount_cents = -t.amount_cents AND o.account <> t.account
				           AND o.date BETWEEN date(t.date, '-5 days') AND date(t.date, '+5 days')))`
			)
			.all() as { id: string; date: string; month: string; cents: number; merchant: string; statement: string; category: string; account: string; kind: string }[]
	).filter((r) => r.category === 'Paychecks' || !fromOwnAccount(r.merchant, r.statement, own));

	// Same detector as subscriptions, run on money in. Everything is filed under one neutral
	// category so detection treats a tenant's "transfer" like any other payer.
	const charges: Charge[] = rows.map((r) => ({ id: r.id, date: r.date, cents: r.cents, merchant: r.merchant, category: 'Income', categoryGroup: 'Income', account: r.account }));
	const inSeries = new Set(detectRecurring(charges, today).flatMap((s) => s.charges.map((c) => c.id)));

	return rows.map((r) => ({
		id: r.id, date: r.date, month: r.month, cents: r.cents, merchant: r.merchant, category: r.category, account: r.account,
		source: r.kind === 'income' ? 'income' : 'transfer',
		// paychecks count even when the payer's name changes every time (payroll providers do this)
		recurring: r.category === 'Paychecks' || inSeries.has(r.id) || RENT.test(r.merchant) || RENT.test(r.statement)
	}));
}

function fromOwnAccount(merchant: string, statement: string, own: Set<string>) {
	if (FROM_OWN_WORDS.test(merchant)) return true;
	const numbered = [...statement.matchAll(FROM_ACCOUNT_NO)].map((m) => m[1]);
	return numbered.length ? numbered.some((n) => own.has(n)) : FROM_OWN_WORDS.test(statement);
}

/** Recurring and other money in, per month. */
export function inflowByMonth(inflows: Inflow[]) {
	const by = new Map<string, { recurring: number; other: number }>();
	for (const f of inflows) {
		const m = by.get(f.month) ?? by.set(f.month, { recurring: 0, other: 0 }).get(f.month)!;
		if (f.recurring) m.recurring += f.cents;
		else m.other += f.cents;
	}
	return by;
}
