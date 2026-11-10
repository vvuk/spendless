import type { DatabaseSync } from 'node:sqlite';
import { nowIso, transaction } from '../db.ts';
import { upsertTransactions, recordRun, type IncomingTxn } from '../import/upsert.ts';
import { saveRule } from '../rules.ts';
import { analyzeBenefits } from '../benefits/analyze.ts';
import { setEnrollment } from '../benefits/enroll.ts';
import { rubricHash } from '../benefits/rubrics.ts';

/**
 * Made-up but plausible finances for demo mode: a salaried renter with savings, a brokerage account,
 * a car loan and three cards: a Sapphire Reserve and an Amex Platinum (so the benefits page has
 * credits used, missed and left on the table) plus a no-fee cash-back card. Nothing here comes from your data.
 *
 * Randomness is keyed by calendar date (not by position in the history), so a given day
 * looks the same every time the demo is built and screenshots stay consistent.
 */

const SEED = 'spendless-demo-1';

const CHK = 'Everyday Checking (...4821)';
const SAV = 'High-Yield Savings (...7710)';
const SAPPHIRE = 'Sapphire Reserve (...3392)';
const AMEX = 'Platinum Card (...2046)';
const CASH = 'Cash Back Card (...6015)';
const BRK = 'Brokerage (...1184)';
const RET = '401(k) (...5530)';
const CARDS = [SAPPHIRE, AMEX, CASH];

const ACCOUNTS: { name: string; type: string; institution: string; balance: number }[] = [
	{ name: CHK, type: 'Checking', institution: 'Harbor Credit Union', balance: 9_412_37 },
	{ name: SAV, type: 'Savings', institution: 'Harbor Credit Union', balance: 38_250_11 },
	{ name: SAPPHIRE, type: 'Credit Card', institution: 'Chase', balance: -2_183_40 },
	{ name: AMEX, type: 'Credit Card', institution: 'American Express', balance: -1_046_18 },
	{ name: CASH, type: 'Credit Card', institution: 'Lattice Card', balance: -412_06 },
	{ name: BRK, type: 'Brokerage', institution: 'Lattice Invest', balance: 84_930_55 },
	{ name: RET, type: 'Retirement', institution: 'Lattice Invest', balance: 141_208_90 }
];

// ---- seeded randomness -------------------------------------------------------------------

function hash(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** A small PRNG (mulberry32) seeded from a key, e.g. "groceries:2026-03-14". */
function rng(key: string) {
	let a = hash(`${SEED}:${key}`);
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
type R = ReturnType<typeof rng>;
const pick = <T>(r: R, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
/** Dollars between lo and hi, as cents. */
const dollars = (r: R, lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100);

// ---- dates -------------------------------------------------------------------------------

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const dow = (s: string) => toDate(s).getUTCDay();
function addMonth(m: string, n: number) {
	const [y, mo] = m.split('-').map(Number);
	const t = y * 12 + (mo - 1) + n;
	return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
function onDay(month: string, day: number) {
	const [y, mo] = month.split('-').map(Number);
	const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

// ---- merchants ---------------------------------------------------------------------------

/** [merchant, statement text, Monarch category] */
type M = readonly [string, string, string];

const GROCERY: M[] = [
	["Trader Joe's", 'TRADER JOE S #118 OAKLAND CA', 'Groceries'],
	["Trader Joe's", 'TRADER JOE S #118 OAKLAND CA', 'Groceries'],
	['Safeway', 'SAFEWAY #1742 OAKLAND CA', 'Groceries'],
	['Whole Foods Market', 'WHOLEFDS OAK 10234 OAKLAND CA', 'Groceries'],
	['Rockridge Market Hall', 'ROCKRIDGE MKT HALL OAKLAND CA', 'Groceries']
];
const RESTAURANTS: M[] = [
	['Chipotle', 'CHIPOTLE 2291 OAKLAND CA', 'Restaurants & Bars'],
	['Sweetgreen', 'SWEETGREEN EMERYVILLE CA', 'Restaurants & Bars'],
	['Lucky Noodle House', 'SQ *LUCKY NOODLE HOUSE', 'Restaurants & Bars'],
	['Casa Verde Taqueria', 'CASA VERDE TAQUERIA OAKLAND', 'Restaurants & Bars'],
	['The Copper Tap', 'TST* THE COPPER TAP', 'Restaurants & Bars'],
	['Saffron Kitchen', 'TST* SAFFRON KITCHEN', 'Restaurants & Bars'],
	['Pizzeria Nonna', 'PIZZERIA NONNA BERKELEY CA', 'Restaurants & Bars'],
	['DoorDash', 'DOORDASH*ORDER', 'Restaurants & Bars'],
	['Sushi Hana', 'SQ *SUSHI HANA', 'Restaurants & Bars'],
	['Little Bird Cafe', 'LITTLE BIRD CAFE OAKLAND', 'Restaurants & Bars']
];
/** Sit-down places the demo treats as listed on Resy (the stand-in for the LLM's answer). */
const RESY = new Set(['The Copper Tap', 'Saffron Kitchen', 'Sushi Hana', 'Pizzeria Nonna']);
const TRAVEL = new Set(['Travel & Vacation', 'Taxi & Ride Shares', 'Parking & Tolls', 'Public Transit']);

const COFFEE: M[] = [
	['Blue Bottle Coffee', 'BLUE BOTTLE COFFEE OAKLAND', 'Coffee Shops'],
	['Peet\'s Coffee', 'PEETS 0412 OAKLAND CA', 'Coffee Shops'],
	// Monarch files this one under restaurants; a demo rule fixes it
	['Highwire Roasters', 'SQ *HIGHWIRE ROASTERS', 'Restaurants & Bars']
];
const GAS: M[] = [
	['Shell', 'SHELL OIL 57442 OAKLAND CA', 'Gas'],
	['Chevron', 'CHEVRON 0091 EMERYVILLE CA', 'Gas'],
	['Costco Gas', 'COSTCO GAS #0144', 'Gas']
];
const RIDES: M[] = [
	['Uber', 'UBER *TRIP', 'Taxi & Ride Shares'],
	['Lyft', 'LYFT *RIDE', 'Taxi & Ride Shares'],
	['BART', 'CLIPPER BART', 'Public Transit']
];
const SHOPPING: M[] = [
	['Target', 'TARGET 00021 EMERYVILLE CA', 'Shopping'],
	['REI', 'REI #0127 BERKELEY CA', 'Shopping'],
	['Uniqlo', 'UNIQLO SF UNION SQ', 'Clothing'],
	['Etsy', 'ETSY.COM', 'Shopping'],
	['Walgreens', 'WALGREENS #3021', 'Medical'],
	['Ace Hardware', 'ACE HDWE OAKLAND', 'Home Improvement']
];
const FUN: M[] = [
	['AMC Theatres', 'AMC 1240 ONLINE', 'Entertainment & Recreation'],
	['Eventbrite', 'EVENTBRITE *TICKETS', 'Entertainment & Recreation'],
	['Bay Bowl', 'SQ *BAY BOWL', 'Entertainment & Recreation'],
	['Steam', 'STEAM PURCHASE', 'Entertainment & Recreation']
];
const PARKING: M[] = [['ParkMobile', 'PARKMOBILE', 'Parking & Tolls'], ['FasTrak', 'FASTRAK CSC', 'Parking & Tolls']];
const BIG: M[] = [
	['Best Buy', 'BEST BUY 00011 EMERYVILLE', 'Electronics'],
	['IKEA', 'IKEA EMERYVILLE', 'Furniture & Housewares'],
	['Apple Store', 'APPLE STORE R014', 'Electronics'],
	['Midas', 'MIDAS #2210', 'Auto Maintenance'],
	['Pacific Dental Care', 'PACIFIC DENTAL CARE', 'Dentist']
];
const AIRLINES: M[] = [['Alaska Airlines', 'ALASKA AIR 0272', 'Travel & Vacation'], ['United', 'UNITED 0162', 'Travel & Vacation'], ['Southwest', 'SOUTHWES 5262', 'Travel & Vacation']];
const LODGING: M[] = [['Airbnb', 'AIRBNB * HMXQ4', 'Travel & Vacation'], ['Marriott', 'MARRIOTT PORTLAND', 'Travel & Vacation'], ['Hotel Lumen', 'HOTEL LUMEN SEATTLE', 'Travel & Vacation']];

// ---- generation --------------------------------------------------------------------------

export function generateDemo(today: string, months = 26): IncomingTxn[] {
	const out: IncomingTxn[] = [];
	let n = 0;
	const add = (date: string, account: string, cents: number, [merchant, statement, category]: M, notes?: string) => {
		if (date > today) return;
		out.push({
			id: `demo-${String(++n).padStart(5, '0')}`,
			date,
			amountCents: cents,
			account,
			merchant,
			statement,
			category,
			notes: notes ?? null,
			tags: null,
			owner: null,
			// card charges from the last two days haven't posted yet
			pending: CARDS.includes(account) && cents < 0 && date > addDays(today, -2)
		});
	};

	const endMonth = today.slice(0, 7);
	const startMonth = addMonth(endMonth, -(months - 1));
	const start = `${startMonth}-01`;
	const monthIndex = (m: string) => {
		const [ya, ma] = startMonth.split('-').map(Number);
		const [yb, mb] = m.split('-').map(Number);
		return (yb - ya) * 12 + (mb - ma);
	};
	const fromEnd = (m: string) => months - 1 - monthIndex(m); // 0 = this month

	// ---- every day: everyday spending
	for (let date = start; date <= today; date = addDays(date, 1)) {
		const r = rng(`day:${date}`);
		const wd = dow(date);
		const weekend = wd === 0 || wd === 6;
		const card = () => {
			const x = r();
			return x < 0.6 ? SAPPHIRE : x < 0.82 ? AMEX : CASH;
		};

		if (r() < (weekend ? 0.45 : 0.25)) add(date, card(), -dollars(r, 18, weekend ? 165 : 95), pick(r, GROCERY));
		if (r() < (weekend ? 0.5 : 0.28)) {
			const m = pick(r, RESTAURANTS);
			add(date, card(), -dollars(r, m[0] === 'Chipotle' || m[0] === 'Sweetgreen' ? 12 : 22, m[0] === 'Chipotle' || m[0] === 'Sweetgreen' ? 19 : 118), m);
		}
		if (!weekend && r() < 0.42) add(date, CASH, -dollars(r, 4.25, 8.75), pick(r, COFFEE));
		if (r() < 0.075) add(date, SAPPHIRE, -dollars(r, 38, 72), pick(r, GAS));
		if (r() < 0.07) {
			// Uber goes on the Amex for Uber Cash, Lyft on the Sapphire for its Lyft credit
			const m = pick(r, RIDES);
			add(date, m[0] === 'Uber' ? AMEX : SAPPHIRE, -dollars(r, 9, 38), m);
		}
		if (r() < 0.02) add(date, SAPPHIRE, -dollars(r, 24, 70), ['DoorDash', 'DOORDASH*DASHMART', 'Groceries']);
		if (r() < 0.12) add(date, SAPPHIRE, -dollars(r, 9, 85), ['Amazon', 'AMZN MKTP US*2K4T', 'Shopping']);
		if (r() < 0.05) add(date, card(), -dollars(r, 15, 160), pick(r, SHOPPING));
		if (r() < (weekend ? 0.08 : 0.025)) add(date, card(), -dollars(r, 14, 95), pick(r, FUN));
		if (r() < 0.05) add(date, SAPPHIRE, -dollars(r, 4, 24), pick(r, PARKING));
		if (r() < 0.006) add(date, CHK, dollars(r, 20, 140), ['Venmo', 'VENMO CASHOUT', 'Transfer'], 'Dinner split');
	}

	// ---- every month: bills, subscriptions, income, transfers
	for (let month = startMonth; month <= endMonth; month = addMonth(month, 1)) {
		const r = rng(`month:${month}`);
		const ago = fromEnd(month);
		const mi = monthIndex(month);
		const calMonth = Number(month.slice(5));

		// housing: rent went up when the lease renewed a year ago
		add(onDay(month, 1), CHK, ago >= 13 ? -2_850_00 : -2_975_00, ['Parkview Apartments', 'PARKVIEW APTS WEB PMT', 'Rent']);
		add(onDay(month, 5), SAPPHIRE, -14_50, ['Harbor Renters Insurance', 'HARBOR RENTERS INS', 'Insurance']);

		// utilities: energy follows the seasons (heating in winter, a little A/C in late summer)
		const season = Math.cos(((calMonth - 1) / 12) * 2 * Math.PI);
		add(onDay(month, 14), CHK, -Math.round((92 + 58 * Math.max(season, -0.4) + r() * 24) * 100), ['Bayline Energy', 'BAYLINE ENERGY AUTOPAY', 'Gas & Electric']);
		add(onDay(month, 9), SAPPHIRE, ago >= 9 ? -65_00 : -70_00, ['Fiberline Internet', 'FIBERLINE INTERNET', 'Internet & Cable']);
		add(onDay(month, 24), CASH, -85_00, ['Clearwave Wireless', 'CLEARWAVE WIRELESS', 'Phone']);

		// loans
		add(onDay(month, 15), CHK, -389_27, ['Summit Auto Finance', 'SUMMIT AUTO FIN PMT', 'Auto Payment']);
		add(onDay(month, 26), CHK, -312_40, ['EdFund Loan Servicing', 'EDFUND LOAN SVC', 'Student Loans']);
		if (calMonth === 2 || calMonth === 8) add(onDay(month, 11), CHK, ago >= 12 ? -712_00 : -748_00, ['Northstar Auto Insurance', 'NORTHSTAR INS PREM', 'Insurance']);

		// subscriptions
		add(onDay(month, 7), CASH, ago >= 10 ? -15_49 : -17_99, ['Netflix', 'NETFLIX.COM', 'Subscriptions']);
		add(onDay(month, 12), CASH, ago >= 5 ? -11_99 : -12_99, ['Spotify', 'SPOTIFY USA', 'Subscriptions']);
		add(onDay(month, 3), CASH, -2_99, ['Apple', 'APPLE.COM/BILL', 'Subscriptions'], 'iCloud+');
		add(onDay(month, 18), CASH, -17_00, ['The New York Times', 'NYTIMES*SUBSCRIPTION', 'Subscriptions']);
		add(onDay(month, 1), SAPPHIRE, -49_00, ['Crunch Fitness', 'CRUNCH FITNESS OAKLAND', 'Fitness']);
		if (ago >= 7) add(onDay(month, 22), CASH, -17_99, ['Hulu', 'HULU 877-8244858', 'Subscriptions']); // cancelled
		if (ago <= 4) add(onDay(month, 20), CASH, -9_99, ['Duolingo', 'DUOLINGO', 'Subscriptions']); // new
		if (mi % 12 === 4) add(onDay(month, 16), SAPPHIRE, -139_00, ['Amazon Prime', 'AMAZON PRIME*MEMBERSHIP', 'Subscriptions']);
		if (mi % 12 === 9) add(onDay(month, 2), CASH, -119_88, ['Dropbox', 'DROPBOX*PLUS', 'Subscriptions']);
		// Disney+ on the Amex, refunded by the digital entertainment credit (Amex posts it under the merchant's name)
		add(onDay(month, 6), AMEX, -9_99, ['Disney+', 'DISNEYPLUS', 'Subscriptions']);
		add(onDay(month, 8), AMEX, 9_99, ['Disney+', 'DISNEYPLUS CREDIT', 'Subscriptions']);
		// paying for things the Sapphire would give for free
		if (ago <= 15) add(onDay(month, 11), CASH, -12_99, ['Apple TV+', 'APPLE TV+ SUBSCRIPTION', 'Subscriptions']);
		if (ago >= 8 && ago <= 20) add(onDay(month, 4), CASH, -9_99, ['DoorDash', 'DOORDASH DASHPASS', 'Subscriptions']);

		// card fees, and the occasional purchase that earns a credit
		if (calMonth === 3) add(onDay(month, 14), SAPPHIRE, -795_00, ['Annual Membership Fee', 'ANNUAL MEMBERSHIP FEE', 'Financial Fees']);
		if (calMonth === 9) add(onDay(month, 22), AMEX, -895_00, ['Platinum Membership Fee', 'PLATINUM CARD MEMBERSHIP FEE', 'Financial Fees']);
		if (r() < 0.22) add(onDay(month, 1 + Math.floor(r() * 27)), SAPPHIRE, -dollars(r, 95, 260), ['StubHub', 'STUBHUB INC', 'Entertainment & Recreation']);
		if (calMonth === 5) add(onDay(month, 8), AMEX, -209_00, ['CLEAR', 'CLEARME.COM CLEAR PLUS', 'Travel & Vacation']);
		if (ago === 19) add(onDay(month, 12), SAPPHIRE, -120_00, ['U.S. Customs and Border Protection', 'US CBP GLOBAL ENTRY', 'Financial & Legal Services']);
		if (ago === 5) add(onDay(month, 3), AMEX, -782_40, ['Amex Travel', 'AMEX TRAVEL FINE HOTELS RESORTS', 'Travel & Vacation']);

		// health, giving
		if (r() < 0.2) add(onDay(month, 1 + Math.floor(r() * 27)), SAPPHIRE, -dollars(r, 25, 60), ['Bayview Medical Group', 'BAYVIEW MED GRP COPAY', 'Medical']);
		add(onDay(month, 15), SAPPHIRE, -25_00, ['Bay Area Food Bank', 'BAY AREA FOOD BANK', 'Charity']);

		// a trip now and then: flights a few weeks out, lodging and meals during
		if (r() < 0.2 && ago > 0) {
			const tripDay = onDay(month, 8 + Math.floor(r() * 14));
			const air = pick(r, AIRLINES);
			add(addDays(tripDay, -30 - Math.floor(r() * 20)), SAPPHIRE, -dollars(r, 280, 640), air);
			if (r() < 0.7) add(addDays(tripDay, -1), AMEX, -dollars(r, 35, 70), [air[0], `${air[1].replace(/ \d+$/, '')} BAG FEE`, 'Travel & Vacation']);
			add(tripDay, SAPPHIRE, -dollars(r, 520, 1350), pick(r, LODGING));
			for (let i = 0; i < 4; i++) add(addDays(tripDay, i), SAPPHIRE, -dollars(r, 25, 140), pick(r, RESTAURANTS));
		}
		// an occasional big purchase
		if (r() < 0.12) add(onDay(month, 1 + Math.floor(r() * 27)), SAPPHIRE, -dollars(r, 180, 1250), pick(r, BIG));
		// holiday gifts
		if (calMonth === 12) for (let i = 0; i < 5; i++) add(onDay(month, 2 + Math.floor(r() * 20)), SAPPHIRE, -dollars(r, 25, 180), pick(r, [['Etsy', 'ETSY.COM', 'Gifts'], ['Amazon', 'AMZN MKTP US*GIFT', 'Gifts']] as const));

		// money in
		add(onDay(month, 28), SAV, Math.round((88 + mi * 1.9 + r() * 6) * 100), ['Harbor Credit Union', 'INTEREST PAID', 'Interest']);
		if (calMonth === 3) add(onDay(month, 15), CHK, dollars(r, 5_200, 7_400), ['Brightline Labs', 'BRIGHTLINE LABS BONUS PPD', 'Other Income'], 'Annual bonus');
		if (calMonth === 4) add(onDay(month, 19), CHK, dollars(r, 600, 1_800), ['IRS', 'IRS TREAS 310 TAX REF', 'Other Income']);
		if (r() < 0.3) add(onDay(month, 10 + Math.floor(r() * 15)), CHK, dollars(r, 45, 320), ['Brightline Labs', 'BRIGHTLINE LABS EXP REIMB', 'Reimbursement']);

		// moves between own accounts (both sides, as Monarch reports them)
		const save = onDay(month, 3);
		add(save, CHK, -1_000_00, ['Transfer to Savings', 'ONLINE TRANSFER TO SAV ...7710', 'Transfer']);
		add(save, SAV, 1_000_00, ['Transfer From Checking', 'ONLINE TRANSFER FROM CHK ...4821', 'Transfer']);
		const invest = onDay(month, 16);
		add(invest, CHK, -500_00, ['Lattice Invest', 'LATTICE INVEST ACH', 'Transfer']);
		add(invest, BRK, 500_00, ['Deposit', 'ACH DEPOSIT FROM CHK ...4821', 'Transfer']);
	}

	// ---- paychecks: every other Friday, the latest on or before today (so the current month
	// usually has one in it); a raise 11 months ago
	const raise = `${addMonth(endMonth, -10)}-01`;
	for (let date = addDays(today, -((dow(today) + 2) % 7)); date >= start; date = addDays(date, -14))
		add(date, CHK, date >= raise ? 4_012_55 : 3_846_12, ['Brightline Labs', 'BRIGHTLINE LABS PAYROLL PPD', 'Paychecks']);

	// ---- statement credits: each qualifying charge is credited a few days later, up to the period's cap
	const credit = (account: string, ok: (t: IncomingTxn) => boolean, period: (date: string) => string, capCents: number, lag: number, row: M) => {
		const used = new Map<string, number>();
		for (const t of out.filter((t) => t.account === account && t.amountCents < 0 && ok(t))) {
			const k = period(t.date);
			const c = Math.min(capCents - (used.get(k) ?? 0), -t.amountCents);
			if (c <= 0) continue;
			used.set(k, (used.get(k) ?? 0) + c);
			add(addDays(t.date, lag), account, c, row);
		}
	};
	const year = (date: string) => date.slice(0, 4);
	const half = (date: string) => `${date.slice(0, 4)}-${date.slice(5, 7) <= '06' ? 1 : 2}`;
	const quarter = (date: string) => `${date.slice(0, 4)}-${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
	const sinceYear = (mmdd: string) => (date: string) => String(Number(date.slice(0, 4)) - (date.slice(5) < mmdd ? 1 : 0));
	const st = (t: IncomingTxn) => t.statement ?? '';

	credit(SAPPHIRE, (t) => TRAVEL.has(t.category ?? ''), sinceYear('03-14'), 300_00, 1, ['Travel Credit', 'TRAVEL CREDIT $300/YEAR', 'Travel & Vacation']);
	credit(SAPPHIRE, (t) => st(t).includes('STUBHUB') && t.date >= '2025-10-26', half, 150_00, 3, ['StubHub Credit', 'STUBHUB CREDIT', 'Entertainment & Recreation']);
	credit(SAPPHIRE, (t) => st(t).includes('CBP'), () => 'once', 120_00, 2, ['Known Traveler Credit', 'KNOWN TRAVELER CREDIT', 'Financial & Legal Services']);
	// enrolled in the Resy credit at the start of 2026, so late 2025 shows Resy dinners with no credit
	credit(AMEX, (t) => RESY.has(t.merchant ?? '') && -t.amountCents >= 30_00 && t.date >= '2026-01-01', quarter, 100_00, 2, ['Amex Resy Credit', 'PLATINUM RESY CREDIT', 'Restaurants & Bars']);
	credit(AMEX, (t) => st(t).includes('BAG FEE'), year, 200_00, 3, ['Airline Fee Credit', 'AIRLINE FEE CREDIT', 'Travel & Vacation']);
	credit(AMEX, (t) => st(t).includes('CLEARME'), year, 209_00, 2, ['CLEAR', 'CLEAR PLUS CREDIT', 'Travel & Vacation']);
	credit(AMEX, (t) => st(t).includes('AMEX TRAVEL'), half, 300_00, 4, ['Amex Travel Hotel Credit', 'FHR HOTEL CREDIT', 'Travel & Vacation']);

	// ---- card payments: on the 21st, each card pays off last month's balance in full
	for (let month = startMonth; month <= endMonth; month = addMonth(month, 1)) {
		const prev = addMonth(month, -1);
		for (const card of CARDS) {
			const owed = -out.filter((t) => t.account === card && t.date.startsWith(prev) && t.category !== 'Credit Card Payment').reduce((s, t) => s + t.amountCents, 0);
			if (owed <= 0) continue;
			const date = onDay(month, 21);
			const name = card.replace(/ \(.*/, '');
			add(date, card, owed, [`${name} Payment`, 'PAYMENT - THANK YOU', 'Credit Card Payment']);
			add(date, CHK, -owed, [`${name} Payment`, `${name.toUpperCase()} ONLINE PMT`, 'Credit Card Payment']);
		}
	}

	return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Fill an empty (freshly migrated) database with demo data. */
export function seedDemo(d: DatabaseSync, today: string) {
	const now = nowIso();
	transaction(d, () => {
		const a = d.prepare(`INSERT INTO accounts (name, monarch_id, type, institution, balance_cents, balance_at) VALUES (?,?,?,?,?,?)`);
		ACCOUNTS.forEach((x, i) => a.run(x.name, `demo-acct-${i + 1}`, x.type, x.institution, x.balance, now));
	});
	const txns = generateDemo(today);
	const res = upsertTransactions(d, txns, 'mcp');
	recordRun(d, 'mcp', now, res, { start: txns[0]?.date ?? today, end: today });

	// a couple of rules, so the Rules page has something to show
	const blank = {
		priority: 100, merchant_op: null, merchant_value: null, statement_op: null, statement_value: null, direction: null,
		min_cents: null, max_cents: null, account: null, monarch_category: null, date_from: null, date_to: null,
		set_category: null, set_merchant: null, recurring_kind: null, recurring_cadence: null, enabled: 1
	} as const;
	saveRule(d, { ...blank, statement_op: 'contains', statement_value: 'HIGHWIRE ROASTERS', set_category: 'Coffee Shops' });
	saveRule(d, { ...blank, statement_op: 'contains', statement_value: 'EXP REIMB', direction: 'in', set_merchant: 'Brightline Labs (expenses)' });

	// card benefits: a few enrollments, and canned answers in place of the LLM (demo mode never calls it)
	for (const [account, key] of [
		[AMEX, 'amex-platinum/digital-entertainment'],
		[AMEX, 'amex-platinum/uber-cash'],
		[SAPPHIRE, 'chase-sapphire-reserve/lyft'],
		[SAPPHIRE, 'chase-sapphire-reserve/doordash-restaurant'],
		[SAPPHIRE, 'chase-sapphire-reserve/doordash-nonrestaurant']
	])
		setEnrollment(d, account, key, 'enrolled');
	labelForDemo(d, today);
}

/** What the LLM would say about the demo's transactions, written straight into llm_labels. */
function labelForDemo(d: DatabaseSync, today: string) {
	const get = d.prepare(`SELECT merchant, statement, amount_cents FROM txns WHERE id = ?`);
	const put = d.prepare(`INSERT OR REPLACE INTO llm_labels (rubric, txn_id, rubric_hash, label, reason, model, created_at) VALUES (?,?,?,?,?,?,?)`);
	const judge: Record<string, (t: { merchant: string; statement: string; cents: number }) => boolean> = {
		travel: () => false,
		'hotel-stay': (t) => /hotel|marriott|airbnb|fine hotels/i.test(t.statement),
		'airline-incidental': (t) => /bag fee|seat|lounge/i.test(t.statement),
		'resy-restaurant': (t) => RESY.has(t.merchant),
		'doordash-nonrestaurant': (t) => /dashmart/i.test(t.statement)
	};
	const now = nowIso();
	transaction(d, () => {
		for (const { rubric, txnIds } of analyzeBenefits(d, today).pending) {
			const yes = judge[rubric];
			if (!yes) continue;
			for (const id of txnIds) {
				const r = get.get(id) as { merchant: string; statement: string | null; amount_cents: number } | undefined;
				if (!r) continue;
				const label = yes({ merchant: r.merchant, statement: r.statement ?? '', cents: Math.abs(r.amount_cents) }) ? 'yes' : 'no';
				put.run(rubric, id, rubricHash(rubric), label, 'demo data', 'demo', now);
			}
		}
	});
}
