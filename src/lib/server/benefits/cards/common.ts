import type { EligibleSpec } from '../types';

/** Regex fragments shared by card definitions. Tested case-insensitively against "merchant · statement". */

export const AIRLINES = [
	'\\bunited\\b(?! ?(healthcare|way|states))', 'delta air', '\\bdelta\\b.*air', 'american air', '\\baa\\.com', 'alaska air', 'southwest',
	'jetblue', 'hawaiian air', 'spirit air', 'frontier air', 'sun country', 'air canada', 'british a', 'lufthansa', 'air france',
	'\\bklm\\b', 'virgin atl', 'emirates', 'qatar air', 'singapore air', 'cathay', 'japan airlines', 'aer lingus',
	'iberia', 'turkish air', 'icelandair', 'norwegian air', 'aeromexico', 'qantas', 'air new zealand', 'ryanair', 'easyjet'
];

export const HOTELS = [
	'hotel', 'marriott', 'courtyard', 'sheraton', 'westin', 'ritz', 'st\\.? regis', 'hilton', 'doubletree', 'hampton inn',
	'embassy suites', 'conrad', 'waldorf', 'hyatt', 'andaz', 'ihg', 'intercontinental', 'holiday inn', 'kimpton', 'four seasons',
	'fairmont', 'sofitel', 'accor', 'wyndham', 'best western', 'motel', '\\binn\\b', 'resort', 'lodging', 'booking\\.com',
	'expedia', 'hotels\\.com'
];
export const VACATION_RENTALS = ['airbnb', 'vrbo'];

export const DINING_CATEGORIES = ['Restaurants & Bars', 'Coffee Shops', 'Fast Food'];
export const TRAVEL_CATEGORIES = ['Travel & Vacation', 'Taxi & Ride Shares', 'Parking & Tolls', 'Public Transit', 'Airfare', 'Hotel', 'Rental Car & Taxi'];
/** Food delivered or eaten at a hotel is dining, not a stay. */
export const HOTEL_FOOD = ['\\bf&b\\b', '\\bfb\\b', 'coffee', 'bar\\b', 'restaurant', 'market', 'cafe', 'grill', 'kitchen'];

export const CENTS = (dollars: number) => Math.round(dollars * 100);

/** A hotel stay paid directly: what a hotel-portal credit could have covered had it been booked there. */
export const HOTEL_STAY: EligibleSpec = {
	merchant: HOTELS,
	category: ['Travel & Vacation'],
	all: true,
	not: { merchant: [...HOTEL_FOOD, ...VACATION_RENTALS] },
	minCents: 10000,
	llm: { rubric: 'hotel-stay', candidates: { category: ['Travel & Vacation', 'Uncategorized', 'Miscellaneous'], minCents: 10000, not: { merchant: VACATION_RENTALS } } }
};
/** Hotels plus vacation rentals (Amex's lodging credit also takes Airbnb Luxe). */
export const LODGING_STAY: EligibleSpec = { ...HOTEL_STAY, merchant: [...HOTELS, ...VACATION_RENTALS], not: { merchant: HOTEL_FOOD } };
