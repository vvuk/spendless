const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (cents: number) => usd.format(Math.round(cents / 100));
export const money2 = (cents: number) => usd2.format(cents / 100);
export const moneyShort = (cents: number) => {
	const d = Math.abs(cents / 100);
	const s = d >= 1e6 ? `${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)}M` : d >= 1e4 ? `${Math.round(d / 1e3)}k` : d >= 1e3 ? `${(d / 1e3).toFixed(1)}k` : `${Math.round(d)}`;
	return `${cents < 0 ? '−' : ''}$${s}`;
};
export const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m: string, long = false) => {
	const [y, mo] = m.split('-').map(Number);
	return long ? `${MONTHS_LONG[mo - 1]} ${y}` : `${MONTHS[mo - 1]} ’${String(y).slice(2)}`;
};
export const dateLabel = (d: string) => {
	const [y, m, day] = d.split('-').map(Number);
	return `${MONTHS[m - 1]} ${day}, ${y}`;
};
export const dateShort = (d: string) => {
	const [, m, day] = d.split('-').map(Number);
	return `${MONTHS[m - 1]} ${day}`;
};
export const addMonths = (m: string, n: number) => {
	const [y, mo] = m.split('-').map(Number);
	const t = y * 12 + (mo - 1) + n;
	return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const relTime = (iso: string | null | undefined) => {
	if (!iso) return 'never';
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 90) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86400)} days ago`;
};
export const cadenceLabel: Record<string, string> = {
	weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Yearly'
};
