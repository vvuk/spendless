import type { EligibleSpec, Matcher } from './types';
import { rubricHash } from './rubrics';

export interface BTxn {
	id: string;
	date: string;
	cents: number; // absolute amount
	inflow: boolean;
	account: string;
	merchant: string;
	statement: string;
	category: string;
	/** "merchant · Monarch merchant · statement", what merchant regexes are tested against */
	text: string;
}

const reCache = new Map<string, RegExp>();
const re = (s: string) => {
	let r = reCache.get(s);
	if (!r) reCache.set(s, (r = new RegExp(s, 'i')));
	return r;
};
const anyRe = (pats: string[] | undefined, text: string) => !!pats?.some((p) => re(p).test(text));

/** True when `m` names merchants or categories and the transaction satisfies it. An empty matcher matches nothing. */
export function matches(m: Matcher | undefined, t: Pick<BTxn, 'text' | 'category' | 'cents'>): boolean {
	if (!m) return false;
	const hasM = !!m.merchant?.length;
	const hasC = !!m.category?.length;
	if (!hasM && !hasC) return false;
	const okM = hasM && anyRe(m.merchant, t.text);
	const okC = hasC && m.category!.includes(t.category);
	const ok = hasM && hasC ? (m.all ? okM && okC : okM || okC) : okM || okC;
	if (!ok) return false;
	if (m.minCents != null && t.cents < m.minCents) return false;
	if (m.maxCents != null && t.cents > m.maxCents) return false;
	if (m.not && (anyRe(m.not.merchant, t.text) || !!m.not.category?.includes(t.category))) return false;
	return true;
}

export type Verdict = 'yes' | 'manual' | 'llm' | 'heuristic' | 'pending' | 'no';
export const counts = (v: Verdict) => v === 'yes' || v === 'manual' || v === 'llm' || v === 'heuristic';

export interface Labels {
	get(rubric: string, txnId: string): 'yes' | 'no' | 'unsure' | undefined;
}

/**
 * Is `t` eligible under `spec`?
 *  yes        deterministic rule
 *  manual     you said it counts
 *  llm        the model said yes
 *  heuristic  not judged by the model yet, but the fallback rule says yes
 *  pending    a candidate the model hasn't judged; not counted
 */
export function judge(spec: EligibleSpec | undefined, t: BTxn, labels: Labels, override?: boolean): Verdict {
	if (override != null) return override ? 'manual' : 'no';
	if (!spec) return 'no';
	if (matches(spec, t)) return 'yes';
	const l = spec.llm;
	if (!l || !matches(l.candidates, t)) return 'no';
	const label = labels.get(l.rubric, t.id);
	if (label === 'yes') return 'llm';
	if (label) return 'no';
	return matches(l.fallback, t) ? 'heuristic' : 'pending';
}

/** Labels from the llm_labels table, ignoring answers to an older wording of a rubric. */
export function labelsFrom(rows: { rubric: string; txn_id: string; rubric_hash: string; label: string }[]): Labels {
	const m = new Map<string, 'yes' | 'no' | 'unsure'>();
	const hashes = new Map<string, string>();
	for (const r of rows) {
		let h = hashes.get(r.rubric);
		if (h == null) hashes.set(r.rubric, (h = rubricHash(r.rubric)));
		if (r.rubric_hash === h) m.set(`${r.rubric}\u0000${r.txn_id}`, r.label as 'yes' | 'no' | 'unsure');
	}
	return { get: (rubric, id) => m.get(`${rubric}\u0000${id}`) };
}
