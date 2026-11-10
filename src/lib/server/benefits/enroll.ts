import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../db';
import type { Analysis } from './analyze';

/**
 * Enrollment state, plus the seam for signing up automatically later.
 *
 * Today you mark benefits enrolled by hand on /benefits. An automated enroller (e.g. a browser session on
 * americanexpress.com or chase.com) would implement `Enroller`, register itself in ENROLLERS, and record
 * success with method 'automation'. `enrollmentQueue` is the to-do list it would work from.
 */
export type EnrollStatus = 'enrolled' | 'not_enrolled';

export function setEnrollment(d: DatabaseSync, account: string, benefitKey: string, status: EnrollStatus | null, method: 'manual' | 'automation' = 'manual') {
	if (!status) {
		d.prepare(`DELETE FROM benefit_enrollment WHERE account = ? AND benefit_id = ?`).run(account, benefitKey);
		return;
	}
	d.prepare(
		`INSERT INTO benefit_enrollment (account, benefit_id, status, method, updated_at) VALUES (?,?,?,?,?)
		 ON CONFLICT(account, benefit_id) DO UPDATE SET status = excluded.status, method = excluded.method, updated_at = excluded.updated_at`
	).run(account, benefitKey, status, method, nowIso());
}

export interface EnrollTask {
	account: string;
	benefitKey: string;
	name: string;
	cardName: string;
	how: string;
	url: string | null;
	automation: string | null;
	/** Why it's worth doing: qualifying spend in the window, on any card. */
	spendCents: number;
}

/** Benefits that need enrolling and aren't known to be enrolled, most valuable first. */
export function enrollmentQueue(a: Analysis): EnrollTask[] {
	return a.benefits
		.filter((b) => b.enrollmentRequired && b.enrollment !== 'enrolled')
		.map((b) => ({
			account: b.account,
			benefitKey: b.key,
			name: b.name,
			cardName: b.cardName,
			how: b.enrollHow ?? '',
			url: b.enrollUrl,
			automation: b.automation,
			spendCents: b.periods.reduce((s, p) => s + p.onCardCents + p.elsewhereCents, 0)
		}))
		.sort((x, y) => y.spendCents - x.spendCents);
}

export interface Enroller {
	/** e.g. 'issuer_site:american-express' */
	id: string;
	canEnroll(task: EnrollTask): boolean;
	enroll(task: EnrollTask): Promise<{ ok: boolean; message: string }>;
}

/** No automated enrollers yet. */
export const ENROLLERS: Enroller[] = [];
