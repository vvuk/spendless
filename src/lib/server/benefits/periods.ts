import type { PeriodKind } from './types';

export interface Period {
	key: string;
	label: string;
	start: string; // inclusive, YYYY-MM-DD
	end: string; // exclusive
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d = 1) => {
	// normalise month overflow (m is 1-based, may exceed 12)
	const t = (y * 12 + (m - 1));
	return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-${pad(d)}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

/** The period of `kind` containing `date`. `anniversary` (MM-DD) anchors cardmember years. */
export function periodOf(kind: PeriodKind, date: string, anniversary = '01-01'): Period {
	const y = Number(date.slice(0, 4));
	const m = Number(date.slice(5, 7));
	switch (kind) {
		case 'month':
			return { key: date.slice(0, 7), label: `${MONTHS[m - 1]} ${y}`, start: ymd(y, m), end: ymd(y, m + 1) };
		case 'quarter': {
			const q = Math.floor((m - 1) / 3);
			return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`, start: ymd(y, q * 3 + 1), end: ymd(y, q * 3 + 4) };
		}
		case 'half': {
			const h = m <= 6 ? 0 : 1;
			return { key: `${y}-H${h + 1}`, label: `${h ? 'Jul–Dec' : 'Jan–Jun'} ${y}`, start: ymd(y, h * 6 + 1), end: ymd(y, h * 6 + 7) };
		}
		case 'year':
			return { key: String(y), label: String(y), start: `${y}-01-01`, end: `${y + 1}-01-01` };
		case 'cardmember_year': {
			let start = `${y}-${anniversary}`;
			if (start > date) start = `${y - 1}-${anniversary}`;
			const sy = Number(start.slice(0, 4));
			const [am, ad] = anniversary.split('-').map(Number);
			return { key: `CY${start}`, label: `${MONTHS[am - 1]} ${ad}, ${sy} – ${sy + 1}`, start, end: `${sy + 1}-${anniversary}` };
		}
		case 'four_years': {
			// Rolling: "within the 4 years ending on `date`". Callers pass today.
			const start = `${y - 4}-${date.slice(5)}`;
			return { key: `4Y${date}`, label: 'Last 4 years', start, end: addDays(date, 1) };
		}
	}
}

/** All periods of `kind` that overlap [from, to] (inclusive dates). four_years yields the single window ending at `to`. */
export function periodsBetween(kind: PeriodKind, from: string, to: string, anniversary = '01-01'): Period[] {
	if (kind === 'four_years') return [periodOf(kind, to)];
	const out: Period[] = [];
	let p = periodOf(kind, from, anniversary);
	while (p.start <= to) {
		out.push(p);
		p = periodOf(kind, p.end, anniversary);
	}
	return out;
}

export const PERIOD_NOUN: Record<PeriodKind, string> = {
	month: 'month',
	quarter: 'quarter',
	half: 'half-year',
	year: 'calendar year',
	cardmember_year: 'cardmember year',
	four_years: '4 years'
};
export const PERIODS_PER_YEAR: Record<PeriodKind, number> = { month: 12, quarter: 4, half: 2, year: 1, cardmember_year: 1, four_years: 0.25 };
