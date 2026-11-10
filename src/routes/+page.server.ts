import { getDb } from '#lib/server/db.ts';
import { monthlySpend, monthSummary, categoryTable, categoryMonthly, topMerchants, netWorth, latestMonth } from '#lib/server/queries.ts';
import { localToday } from '#lib/server/recurring.ts';
import { loadInflows, inflowByMonth } from '#lib/server/income.ts';
import { addMonths } from '#lib/format.ts';

export const load = ({ url }) => {
	const d = getDb();
	const latest = latestMonth(d);
	const q = url.searchParams.get('month');
	const month = q && /^\d{4}-\d{2}$/.test(q) && q <= latest ? q : latest;
	// the whole history; the chart's range slider decides how much of it to show
	const first = (d.prepare(`SELECT MIN(month) m FROM txns`).get() as { m: string | null }).m ?? latest;
	const months = (Number(latest.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(latest.slice(5)) - Number(first.slice(5)) + 1;
	const inflow = inflowByMonth(loadInflows(d));
	const inOf = (m: string) => inflow.get(m) ?? { recurring: 0, other: 0 };
	let avg12Income = 0;
	for (let i = 1; i <= 12; i++) avg12Income += inOf(addMonths(month, -i)).recurring / 12;
	return {
		month,
		latest,
		today: localToday(),
		summary: monthSummary(d, month),
		income: { ...inOf(month), avg12: avg12Income },
		bars: monthlySpend(d, latest, months).map((b) => ({ ...b, income: inOf(b.month).recurring, otherIn: inOf(b.month).other })),
		categories: categoryTable(d, month),
		categoryMonths: categoryMonthly(d),
		merchants: topMerchants(d, 90),
		netWorth: netWorth(d)
	};
};
