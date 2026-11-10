import type { CardDef } from '../types';
import { AIRLINES, HOTEL_STAY, LODGING_STAY, CENTS } from './common';

/**
 * The Platinum Card® from American Express (US consumer), after the Sept 2025 refresh ($895 fee).
 * Saks ended June 30, 2026; the hotel credit became a broader lodging credit (incl. Airbnb Luxe) in Oct 2026.
 * Terms checked Nov 2026 against TPG, Credit Karma, Upgraded Points and cardstack.money.
 *
 * Amex statement credits often post under the merchant's own descriptor (e.g. "NETFLIX.COM" for +$10),
 * so most credits here also recognise a refund-shaped line at an eligible merchant.
 */
const REFRESH = '2025-09-18';
const DE_SERVICES = [
	'disney ?(\\+|plus)', '\\bhulu\\b', 'hlu\\*', 'espn', 'peacock', 'paramount', 'new york times', 'nytimes', 'wall street journal',
	'\\bwsj\\b', 'dow jones', 'youtube ?premium', 'youtubepremi', 'youtube ?tv'
];

export const amexPlatinum: CardDef = {
	id: 'amex-platinum',
	name: 'Amex Platinum',
	issuer: 'American Express',
	annualFeeCents: CENTS(895),
	pointValueCents: 1.5,
	pointsName: 'Membership Rewards',
	detect: {
		institution: 'american express|^amex',
		accountName: 'platinum',
		annualFee: { merchant: ['membership fee'], minCents: CENTS(550), maxCents: CENTS(895) }
	},
	baseMultiplier: 1,
	earn: [
		{ label: 'Flights booked direct or via Amex Travel', multiplier: 5, match: { merchant: [...AIRLINES, 'amex ?travel', 'american express travel'] } },
		{ label: 'Prepaid hotels via Amex Travel', multiplier: 5, match: { merchant: ['amex ?travel', 'american express travel', 'amextravel'] } }
	],
	benefits: [
		{
			id: 'lodging',
			name: 'Hotel / lodging credit',
			amountCents: CENTS(300),
			period: 'half',
			from: REFRESH,
			channel: { how: 'Prepay a Fine Hotels + Resorts or Hotel Collection (2+ nights) stay, or an eligible Airbnb Luxe stay, through Amex Travel.', opportunity: LODGING_STAY },
			eligible: { merchant: ['amex ?travel', 'american express travel', 'amextravel', 'fine hotels', 'airbnb luxe'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['hotel credit', 'lodging credit', 'fhr', 'fine hotels'] } },
			enrollment: { required: false, how: 'Automatic on an eligible prepaid booking in Amex Travel.' }
		},
		{
			id: 'hotel-2025',
			name: 'Hotel credit (pre-refresh)',
			amountCents: CENTS(200),
			period: 'year',
			until: '2025-09-17',
			channel: { how: 'Prepay a Fine Hotels + Resorts or Hotel Collection stay through Amex Travel.', opportunity: HOTEL_STAY },
			eligible: { merchant: ['amex ?travel', 'american express travel', 'amextravel', 'fine hotels'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['hotel credit', 'fhr', 'fine hotels'] } }
		},
		{
			id: 'resy',
			name: 'Resy dining credit',
			amountCents: CENTS(100),
			period: 'quarter',
			from: REFRESH,
			eligible: {
				merchant: ['\\bresy\\b'],
				llm: {
					rubric: 'resy-restaurant',
					candidates: { category: ['Restaurants & Bars'], minCents: CENTS(30), not: { merchant: ['doordash', 'uber ?\\*?eats', 'grubhub', 'caviar', 'postmates', 'seamless', 'toast ?tab'] } }
				}
			},
			redemption: { type: 'statement_credit', credit: { merchant: ['resy credit', 'platinum resy'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits → Resy.', url: 'https://www.americanexpress.com/en-us/benefits/', automation: 'issuer_site' },
			notes: 'Any purchase at a US Resy restaurant counts, booked through Resy or not. Whether a restaurant is on Resy is an LLM guess.'
		},
		{
			id: 'digital-entertainment',
			name: 'Digital entertainment credit',
			amountCents: CENTS(25),
			period: 'month',
			from: REFRESH,
			eligible: { merchant: DE_SERVICES },
			redemption: { type: 'statement_credit', credit: { merchant: ['digital entertainment', 'platinum digital'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits → Digital Entertainment.', url: 'https://www.americanexpress.com/en-us/benefits/', automation: 'issuer_site' },
			notes: 'Disney+, Hulu, ESPN+, Paramount+, Peacock, The New York Times, The Wall Street Journal, YouTube Premium, YouTube TV. Netflix and Spotify do not count.'
		},
		{
			id: 'digital-entertainment-2025',
			name: 'Digital entertainment credit (pre-refresh)',
			amountCents: CENTS(20),
			period: 'month',
			until: '2025-09-17',
			eligible: { merchant: ['disney ?(\\+|plus)', '\\bhulu\\b', 'hlu\\*', 'espn', 'peacock', 'new york times', 'nytimes', 'wall street journal', '\\bwsj\\b'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['digital entertainment', 'platinum digital'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits.' }
		},
		{
			id: 'lululemon',
			name: 'lululemon credit',
			amountCents: CENTS(75),
			period: 'quarter',
			from: REFRESH,
			eligible: { merchant: ['lululemon'], not: { merchant: ['outlet'] } },
			redemption: { type: 'statement_credit', credit: { merchant: ['lululemon credit'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits → lululemon.', automation: 'issuer_site' },
			notes: 'US stores (not outlets) and lululemon.com.',
			lifestyle: true
		},
		{
			id: 'uber-cash',
			name: 'Uber Cash',
			amountCents: CENTS(15),
			amountByMonth: { 12: CENTS(35) },
			period: 'month',
			eligible: { merchant: ['\\buber\\b'], not: { merchant: ['uber ?one'] } },
			redemption: { type: 'in_app' },
			enrollment: { required: true, how: 'Add the Platinum Card to your Uber account; Uber Cash then appears monthly. Pay with the Platinum Card for it to apply.', automation: 'merchant_site' },
			notes: 'Covers Uber rides and Uber Eats in the US. Applied in the app, so the statement just shows smaller Uber charges.'
		},
		{
			id: 'uber-one',
			name: 'Uber One membership credit',
			amountCents: CENTS(120),
			period: 'year',
			from: REFRESH,
			eligible: { merchant: ['uber ?one'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['uber one credit'] }, creditUnderMerchantName: true },
			enrollment: { required: false, how: 'Pay an auto-renewing Uber One membership with the card.' }
		},
		{
			id: 'airline',
			name: 'Airline fee credit',
			amountCents: CENTS(200),
			period: 'year',
			eligible: {
				llm: {
					rubric: 'airline-incidental',
					candidates: { merchant: AIRLINES, maxCents: CENTS(300) },
					fallback: { merchant: AIRLINES, maxCents: CENTS(100) }
				}
			},
			redemption: { type: 'statement_credit', credit: { merchant: ['airline fee', 'airline incidental', 'airline credit'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Pick one qualifying airline in the Amex app → Benefits → Airline Fee Credit (changeable once a year, in January).', automation: 'issuer_site' },
			notes: 'Incidental fees only (bags, seats, lounge day passes, change fees) on the one airline you select; not tickets. Matching here ignores which airline you picked.'
		},
		{
			id: 'clear',
			name: 'CLEAR+ credit',
			amountCents: CENTS(209),
			period: 'year',
			eligible: { merchant: ['clearme', 'clear ?(\\+|plus)'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['clear.*credit'] }, creditUnderMerchantName: true },
			enrollment: { required: false, how: 'Automatic when you pay CLEAR+ with the card.' }
		},
		{
			id: 'walmart-plus',
			name: 'Walmart+ membership credit',
			amountCents: CENTS(14),
			period: 'month',
			eligible: { merchant: ['walmart ?\\+', 'walmart plus', 'wmt plus', 'walmart.*membership'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['walmart.*credit'] }, creditUnderMerchantName: true },
			enrollment: { required: false, how: 'Pay a monthly (not annual) Walmart+ membership with the card.' },
			lifestyle: true
		},
		{
			id: 'equinox',
			name: 'Equinox credit',
			amountCents: CENTS(300),
			period: 'year',
			eligible: { merchant: ['equinox'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['equinox credit'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits → Equinox.', automation: 'issuer_site' },
			lifestyle: true
		},
		{
			id: 'oura',
			name: 'Oura Ring credit',
			amountCents: CENTS(200),
			period: 'year',
			from: REFRESH,
			eligible: { merchant: ['\\boura\\b'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['oura credit'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits.', automation: 'issuer_site' },
			lifestyle: true
		},
		{
			id: 'saks',
			name: 'Saks credit',
			amountCents: CENTS(50),
			period: 'half',
			until: '2026-06-30',
			eligible: { merchant: ['\\bsaks\\b'], not: { merchant: ['off 5th', 'off fifth'] } },
			redemption: { type: 'statement_credit', credit: { merchant: ['saks credit'] }, creditUnderMerchantName: true },
			enrollment: { required: true, how: 'Enroll in the Amex app → Benefits.' },
			lifestyle: true
		},
		{
			id: 'global-entry',
			name: 'Global Entry / TSA PreCheck',
			amountCents: CENTS(120),
			period: 'four_years',
			eligible: { merchant: ['global entry', 'tsa ?pre', 'uscbp', 'cbp\\b', 'idemia', 'telos'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['global entry.*credit', 'tsa.*credit', 'known traveler'] }, creditUnderMerchantName: true },
			enrollment: { required: false, how: 'Automatic when you pay the application fee with the card.' }
		}
	],
	sourceNotes: 'Amounts per period are the post-Sept-2025 values; the $200 hotel and $20/mo entertainment credits before that are kept as separate pre-refresh entries.'
};
