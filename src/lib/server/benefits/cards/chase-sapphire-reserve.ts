import type { CardDef } from '../types';
import { AIRLINES, HOTELS, DINING_CATEGORIES, TRAVEL_CATEGORIES, HOTEL_FOOD, HOTEL_STAY, CENTS } from './common';

/**
 * Chase Sapphire Reserve, as refreshed in 2025 (existing cardmembers moved to the new benefits on
 * Oct 26, 2025). Terms checked Nov 2026 against issuer summaries and TPG / Upgraded Points / Thrifty Traveler.
 */
const REFRESH = '2025-10-26';

export const chaseSapphireReserve: CardDef = {
	id: 'chase-sapphire-reserve',
	name: 'Chase Sapphire Reserve',
	issuer: 'Chase',
	annualFeeCents: CENTS(795),
	pointValueCents: 1.5,
	pointsName: 'Ultimate Rewards',
	detect: {
		institution: '^chase',
		// Monarch names this account just "CREDIT CARD", so recognise it by the fee instead.
		annualFee: { merchant: ['annual membership fee'], minCents: CENTS(550), maxCents: CENTS(795) }
	},
	baseMultiplier: 1,
	earn: [
		{ label: 'Chase Travel (incl. The Edit)', multiplier: 8, match: { merchant: ['chase travel', '\\bcl \\*chase', 'the edit'] }, from: REFRESH },
		{ label: 'Flights booked direct', multiplier: 4, match: { merchant: AIRLINES }, from: REFRESH },
		{ label: 'Hotels booked direct', multiplier: 4, match: { merchant: HOTELS, not: { merchant: [...HOTEL_FOOD, 'airbnb', 'vrbo', 'expedia', 'booking\\.com', 'hotels\\.com'] } }, from: REFRESH },
		{ label: 'Lyft', multiplier: 5, match: { merchant: ['\\blyft\\b'] }, until: '2027-09-30' },
		{ label: 'Dining', multiplier: 3, match: { category: DINING_CATEGORIES, merchant: ['doordash', 'uber \\*?eats', 'grubhub'] } },
		{ label: 'Travel (pre-refresh)', multiplier: 3, match: { category: TRAVEL_CATEGORIES }, until: '2025-10-25' }
	],
	benefits: [
		{
			id: 'travel',
			name: 'Travel credit',
			amountCents: CENTS(300),
			period: 'cardmember_year',
			eligible: {
				category: TRAVEL_CATEGORIES,
				not: { merchant: ['travel credit', 'known traveler'] },
				llm: { rubric: 'travel', candidates: { category: ['Uncategorized', 'Miscellaneous'], minCents: 500 } }
			},
			redemption: { type: 'statement_credit', credit: { merchant: ['^travel credit', 'travel credit \\$300'] } },
			enrollment: { required: false, how: 'Automatic on any travel purchase.' }
		},
		{
			id: 'the-edit',
			name: 'The Edit hotel credit',
			amountCents: CENTS(500),
			maxPerTxnCents: CENTS(250),
			period: 'year',
			from: REFRESH,
			channel: { how: 'Prepay a 2+ night stay at a hotel in The Edit, booked through Chase Travel.', opportunity: HOTEL_STAY },
			eligible: { merchant: ['the edit', 'chase travel.*(hotel|edit)'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['edit credit', 'the edit'] } },
			enrollment: { required: false, how: 'Automatic when you prepay an Edit stay in Chase Travel.' },
			notes: 'Hotel stays paid any other way show up as a booking opportunity, not a move.'
		},
		{
			id: 'chase-travel-hotel-2026',
			name: 'Select Chase Travel hotel credit',
			amountCents: CENTS(250),
			period: 'year',
			from: '2026-01-01',
			until: '2026-12-31',
			channel: { how: 'Prepay a stay at a select hotel through Chase Travel.', opportunity: HOTEL_STAY },
			eligible: { merchant: ['chase travel.*hotel', '\\bcl \\*chase'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['chase travel.*credit', 'hotel credit'] } },
			enrollment: { required: false, how: 'Automatic on an eligible Chase Travel booking.' }
		},
		{
			id: 'dining',
			name: 'Exclusive Tables dining credit',
			amountCents: CENTS(150),
			period: 'half',
			from: REFRESH,
			channel: { how: 'Book a Sapphire Reserve Exclusive Tables restaurant on OpenTable and pay with the card.' },
			eligible: { merchant: ['exclusive tables'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['dining credit', 'exclusive tables'] } },
			enrollment: { required: false, how: 'Book through the Exclusive Tables list in OpenTable, pay with the card.' },
			notes: 'Which restaurants qualify changes often, so dinners elsewhere are not counted as missed.'
		},
		{
			id: 'stubhub',
			name: 'StubHub / viagogo credit',
			amountCents: CENTS(150),
			period: 'half',
			from: REFRESH,
			until: '2027-12-31',
			eligible: { merchant: ['stubhub', 'viagogo'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['stubhub credit'] } },
			enrollment: { required: true, how: 'Activate in the Chase app → Benefits.', url: 'https://www.chase.com/personal/credit-cards/sapphire/reserve', automation: 'issuer_site' },
			notes: 'Only StubHub and viagogo count; Ticketmaster and AXS do not.'
		},
		{
			id: 'doordash-restaurant',
			name: 'DoorDash restaurant promo',
			amountCents: CENTS(5),
			period: 'month',
			from: REFRESH,
			until: '2027-12-31',
			eligible: { merchant: ['doordash'], not: { merchant: ['dashpass'] } },
			redemption: { type: 'in_app' },
			enrollment: { required: true, how: 'Activate DashPass with the card in the DoorDash app.', automation: 'merchant_site' }
		},
		{
			id: 'doordash-nonrestaurant',
			name: 'DoorDash grocery / retail promos',
			amountCents: CENTS(20),
			period: 'month',
			from: REFRESH,
			until: '2027-12-31',
			eligible: { llm: { rubric: 'doordash-nonrestaurant', candidates: { merchant: ['doordash'], not: { merchant: ['dashpass'] } } } },
			redemption: { type: 'in_app' },
			enrollment: { required: true, how: 'Same DashPass activation; two $10 promos a month for grocery, convenience or retail orders.' },
			notes: 'Statements rarely say whether an order was a restaurant, so this is tracked loosely.'
		},
		{
			id: 'dashpass',
			name: 'DashPass membership',
			amountCents: CENTS(9.99),
			period: 'month',
			until: '2027-12-31',
			eligible: { merchant: ['dashpass'] },
			redemption: { type: 'free_membership' },
			enrollment: { required: true, how: 'Activate with the card in the DoorDash app.', automation: 'merchant_site' }
		},
		{
			id: 'lyft',
			name: 'Lyft in-app credit',
			amountCents: CENTS(10),
			period: 'month',
			from: REFRESH,
			until: '2027-09-30',
			eligible: { merchant: ['\\blyft\\b'], not: { merchant: ['memb', 'pink'] } },
			redemption: { type: 'in_app' },
			enrollment: { required: true, how: 'Link the card in the Lyft app.', automation: 'merchant_site' }
		},
		{
			id: 'peloton',
			name: 'Peloton membership credit',
			amountCents: CENTS(10),
			period: 'month',
			from: REFRESH,
			until: '2027-12-31',
			eligible: { merchant: ['peloton'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['peloton credit'] } },
			enrollment: { required: true, how: 'Activate in the Chase app → Benefits.', automation: 'issuer_site' },
			lifestyle: true
		},
		{
			id: 'apple',
			name: 'Apple TV and Apple Music',
			amountCents: CENTS(23.98),
			period: 'month',
			from: REFRESH,
			until: '2027-06-22',
			eligible: { merchant: ['apple ?tv', 'apple music', 'apple one'] },
			redemption: { type: 'free_membership' },
			enrollment: { required: true, how: 'Activate in the Chase app → Benefits, then sign in with your Apple Account.', automation: 'issuer_site' },
			notes: 'Apple bills these as APPLE.COM/BILL, which hides what was bought; only statements naming the service are counted.'
		},
		{
			id: 'global-entry',
			name: 'Global Entry / TSA PreCheck / NEXUS',
			amountCents: CENTS(120),
			period: 'four_years',
			eligible: { merchant: ['global entry', 'tsa ?pre', 'nexus', 'uscbp', 'cbp\\b', 'idemia', 'telos'] },
			redemption: { type: 'statement_credit', credit: { merchant: ['known traveler credit', 'global entry credit', 'tsa.*credit'] } },
			enrollment: { required: false, how: 'Automatic when you pay the application fee with the card.' }
		}
	],
	sourceNotes:
		'Earn and credits per the 2025 refresh. DoorDash: $5 restaurant + 2×$10 non-restaurant promos monthly; Chase added a limited-time extra DoorDash promo from Oct 1, 2026 that is not modelled.'
};
