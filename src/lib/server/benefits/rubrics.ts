/**
 * Questions an LLM answers about a single transaction, for benefits whose definition can't be captured by
 * merchant names and categories. Rubrics are shared across cards ("is this a hotel stay?" serves both the
 * Amex lodging credit and Chase's The Edit), and answers are cached per transaction. Editing a rubric's text
 * changes its hash, so its cached answers are re-asked on the next run.
 */
export const RUBRICS: Record<string, { question: string }> = {
	travel: {
		question:
			'Is this a travel purchase under Chase Sapphire Reserve\'s broad definition of travel? Travel includes airlines, hotels, motels, timeshares, ' +
			'campgrounds, car rental agencies, cruise lines, travel agencies, discount travel sites, trains, buses, taxis, limousines, ferries, ' +
			'toll bridges and highways, parking lots and garages, and rideshare. It does NOT include food or shopping inside a hotel or airport, ' +
			'gift cards, or in-flight purchases from a different merchant.'
	},
	'hotel-stay': {
		question:
			'Is this a payment for a hotel, resort, or vacation-rental stay (lodging)? Answer no for food, drinks, spa, parking, shops or ' +
			'coffee bars that happen to be inside a hotel, and for flights or car rentals.'
	},
	'airline-incidental': {
		question:
			'Is this an airline INCIDENTAL fee rather than a ticket? Incidental fees: checked or overweight bags, seat selection or upgrades ' +
			'bought separately, in-flight food/drink/wifi billed by the airline, airport lounge day passes, change or cancellation fees, ' +
			'pet fees. Not incidental: airfare tickets, award-ticket taxes, miles purchases, gift cards, duty free. Small amounts ($5–$150) ' +
			'charged by an airline are usually incidentals; amounts over ~$150 are usually tickets.'
	},
	'resy-restaurant': {
		question:
			'Is this most likely a dine-in purchase at a full-service US restaurant or bar that is listed on Resy (resy.com)? Resy lists many ' +
			'sit-down restaurants in major US cities, especially chef-driven, reservation-taking places. Answer no for fast food, coffee shops, ' +
			'delivery apps, counter-service chains, bakeries, stadium concessions, and anything outside the US.'
	},
	'doordash-nonrestaurant': {
		question:
			'This is a DoorDash order. Is it from a grocery store, convenience store, pharmacy, alcohol shop, or other retail store ' +
			'(DashMart, Safeway, CVS, Walgreens, 7-Eleven, Sephora, etc.) rather than a restaurant?'
	}
};

export function rubricHash(id: string): string {
	const q = RUBRICS[id]?.question ?? '';
	let h = 2166136261;
	for (let i = 0; i < q.length; i++) h = Math.imul(h ^ q.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}
