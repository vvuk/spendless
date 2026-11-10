/** Normalize a merchant name into a grouping key: "The New York Times" ≈ "New York Times", "Hetzner Online GmbH" ≈ "Hetzner Online". */
export function merchantKey(name: string | null | undefined): string {
	let s = (name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
	s = s
		.replace(/\b(sq|tst|pp|paypal|sp|dd)\s*\*\s*/g, ' ') // processor prefixes: "SQ *", "TST*", "PAYPAL *"
		.replace(/\.(com|net|org|io|co|tv|app|ai)\b/g, ' ')
		.replace(/[+&'’.,*#/\\()-]/g, ' ')
		.replace(/\b(the|inc|llc|ltd|gmbh|corp|co|limited|subscription|subscriptions|membership|order)\b/g, ' ')
		.replace(/\b\d{3,}\b/g, ' ') // store numbers / ids
		.replace(/\s+/g, ' ')
		.trim();
	return s || (name ?? '').toLowerCase().trim();
}
