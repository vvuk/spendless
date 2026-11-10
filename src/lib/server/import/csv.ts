import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { toCents } from '../money';
import { nowIso } from '../db';
import { upsertTransactions, recordRun, type IncomingTxn, type UpsertResult } from './upsert';

/** RFC 4180 CSV parser (quoted fields, embedded commas/newlines, "" escapes). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let q = false;
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
			} else field += c;
		} else if (c === '"') q = true;
		else if (c === ',') { row.push(field); field = ''; }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field); field = '';
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
		} else field += c;
	}
	if (field !== '' || row.length) { row.push(field); rows.push(row); }
	return rows;
}

const blank = (s: string | undefined) => (s == null || s.trim() === '' ? null : s.trim());

/** Parse a Monarch "Download transactions" export. Requires the Id column (current exports have it). */
export function parseMonarchCsv(text: string): IncomingTxn[] {
	const [header, ...body] = parseCsv(text);
	const ix = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
	const col = {
		date: ix('Date'), merchant: ix('Merchant'), category: ix('Category'), account: ix('Account'),
		statement: ix('Original Statement'), notes: ix('Notes'), amount: ix('Amount'), tags: ix('Tags'),
		owner: ix('Owner'), pending: ix('Pending'), id: ix('Id')
	};
	for (const k of ['date', 'amount', 'account', 'id'] as const)
		if (col[k] < 0) throw new Error(`Monarch CSV is missing the "${k}" column. Header: ${header.join(', ')}`);

	const opt = (r: string[], i: number) => (i < 0 ? undefined : blank(r[i]));
	return body.map((r) => ({
		id: r[col.id].trim(),
		date: r[col.date].trim(),
		amountCents: toCents(r[col.amount]),
		account: r[col.account].trim(),
		merchant: opt(r, col.merchant),
		statement: opt(r, col.statement),
		category: opt(r, col.category),
		notes: opt(r, col.notes),
		tags: opt(r, col.tags),
		owner: opt(r, col.owner),
		pending: col.pending >= 0 && r[col.pending]?.trim().toLowerCase() === 'true'
	}));
}

/**
 * Import a full Monarch export. The file is treated as complete for its date range,
 * so transactions Monarch has since deleted (e.g. pending holds that posted) are marked deleted.
 */
export function importMonarchCsv(d: DatabaseSync, path: string): UpsertResult & { rows: number; window: { start: string; end: string } } {
	const started = nowIso();
	const rows = parseMonarchCsv(readFileSync(path, 'utf8'));
	if (!rows.length) throw new Error('No rows in CSV');
	const dates = rows.map((r) => r.date).sort();
	const window = { start: dates[0], end: dates[dates.length - 1] };
	const res = upsertTransactions(d, rows, 'csv', window);
	recordRun(d, 'csv', started, res, window);
	return { ...res, rows: rows.length, window };
}
