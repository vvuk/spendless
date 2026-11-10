export const toCents = (v: string | number): number => {
	const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
	if (!Number.isFinite(n)) throw new Error(`Bad amount: ${v}`);
	return Math.round(n * 100);
};
