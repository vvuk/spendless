/**
 * Credit card benefits, described as data.
 *
 * A card definition is plain JSON-compatible data (regexes are strings), so a new card is one new file in
 * `cards/` plus a line in `cards/index.ts`. Nothing in the engine knows about any particular card.
 */

/** Which transactions a rule applies to. Regexes are case-insensitive and tested against "merchant · statement". */
export interface Matcher {
	merchant?: string[];
	category?: string[];
	/** When both merchant and category are given: false (default) = either is enough, true = both must hold. */
	all?: boolean;
	not?: { merchant?: string[]; category?: string[] };
	/** Bounds on the purchase amount, inclusive. */
	minCents?: number;
	maxCents?: number;
}

/**
 * What counts toward a benefit. Deterministic first; for fuzzy definitions ("airline incidental fees",
 * "a restaurant on Resy") an LLM rubric judges the candidates the deterministic rules can't settle.
 */
export interface EligibleSpec extends Matcher {
	llm?: {
		/** Key into RUBRICS (rubrics.ts). Rubrics are shared, so "is this a hotel stay?" is asked once per transaction. */
		rubric: string;
		/** Prefilter: only these transactions are sent to the model. Keeps cost and false positives down. */
		candidates: Matcher;
		/** Used for candidates the model hasn't judged yet (no API key, or not classified yet). Omit = treat as not eligible. */
		fallback?: Matcher;
	};
}

export type PeriodKind = 'month' | 'quarter' | 'half' | 'year' | 'cardmember_year' | 'four_years';

export type Redemption =
	/** A statement credit posts after a qualifying purchase. `credit` recognises the posting on the card. */
	| { type: 'statement_credit'; credit: Matcher; /** Amex sometimes posts the credit under the merchant's own name. */ creditUnderMerchantName?: boolean }
	/** Applied inside the merchant's app (Uber Cash, Lyft, DoorDash). Invisible on the statement: the charge is just smaller. */
	| { type: 'in_app' }
	/** A membership the card gives you free. Paying for it yourself, on any card, is the miss. */
	| { type: 'free_membership' };

export interface BenefitDef {
	id: string; // unique within the card
	name: string;
	/** Value per period, in cents. */
	amountCents: number;
	period: PeriodKind;
	/** Per-month overrides, e.g. Uber Cash pays $35 in December instead of $15. Months are 1–12. */
	amountByMonth?: Record<number, number>;
	/** At most this much per transaction (e.g. The Edit: $250 per booking). */
	maxPerTxnCents?: number;
	/** First and last day the benefit exists (YYYY-MM-DD). Lets definitions change over time without rewriting history. */
	from?: string;
	until?: string;
	eligible: EligibleSpec;
	redemption: Redemption;
	/**
	 * The purchase has to be made through a particular channel (a travel portal, a reservation platform).
	 * `eligible` then describes channel purchases only; `opportunity` describes spend that could have gone
	 * through the channel (e.g. any hotel stay). That spend can't simply be moved to this card, so it's
	 * reported as "book it differently next time", never as a move.
	 */
	channel?: { how: string; opportunity?: EligibleSpec };
	enrollment?: {
		required: boolean;
		how: string;
		url?: string;
		/** Groundwork for automatic sign-up: which automation could do it. Nothing runs yet. */
		automation?: 'issuer_site' | 'merchant_site';
	};
	notes?: string;
	/** Hide from "missed" totals; still shown. For benefits that only pay off if you'd change habits (Equinox, Oura). */
	lifestyle?: boolean;
}

export interface EarnRule {
	label: string;
	multiplier: number;
	match: Matcher;
	from?: string;
	until?: string;
}

export interface CardDef {
	id: string;
	name: string;
	issuer: string;
	annualFeeCents: number;
	/** Cents per point, for weighing points lost when a purchase moves between cards. */
	pointValueCents: number;
	pointsName: string;
	/** How to recognise this card among synced accounts. All given conditions must hold. */
	detect: {
		institution?: string;
		accountName?: string;
		/** Regex on the annual-fee line; also used to infer the card anniversary. */
		annualFee?: Matcher;
	};
	earn: EarnRule[];
	baseMultiplier: number;
	benefits: BenefitDef[];
	sourceNotes?: string;
}
