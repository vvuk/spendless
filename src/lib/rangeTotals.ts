/** Sums over a range of months of the overview's monthly series (months are 'YYYY-MM', inclusive). */
export interface MonthFlows { month: string; fixed: number; flexible: number; income: number; otherIn: number }

export function rangeTotals(bars: MonthFlows[], from: string, to: string) {
	const rows = bars.filter((b) => b.month >= from && b.month <= to);
	const sum = (f: (b: MonthFlows) => number) => rows.reduce((a, b) => a + f(b), 0);
	const flexible = sum((b) => b.flexible), fixed = sum((b) => b.fixed);
	const recurring = sum((b) => b.income), other = sum((b) => b.otherIn);
	return { months: rows.length, flexible, fixed, spent: flexible + fixed, recurring, other, income: recurring + other };
}
