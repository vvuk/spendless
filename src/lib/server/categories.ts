export type Kind = 'income' | 'expense' | 'transfer';
export interface SeedCategory {
	name: string;
	group: string;
	kind: Kind;
	excludeFromSpending?: boolean;
}

// Mirrors the Monarch category tree. The live sync refreshes this from Monarch.
const tree: [group: string, kind: Kind, cats: string[]][] = [
	['Income', 'income', ['Paychecks', 'Interest', 'Other Income', 'Reimbursement']],
	['Gifts & Donations', 'expense', ['Charity', 'Gifts']],
	['Auto & Transport', 'expense', ['Auto Payment', 'Public Transit', 'Auto Maintenance', 'Gas', 'Parking & Tolls', 'Taxi & Ride Shares', 'Cars']],
	['Housing', 'expense', ['Mortgage', 'Rent', 'Home Improvement', 'Home Management']],
	['Bills & Utilities', 'expense', ['Garbage', 'Water', 'Gas & Electric', 'Internet & Cable', 'Phone', 'Subscriptions']],
	['Food & Dining', 'expense', ['Groceries', 'Restaurants & Bars', 'Coffee Shops']],
	['Travel & Lifestyle', 'expense', ['Travel & Vacation', 'Entertainment & Recreation', 'Personal', 'Pets', 'Fun Money']],
	['Shopping', 'expense', ['Shopping', 'Clothing', 'Furniture & Housewares', 'Electronics', 'Amazon']],
	['Children', 'expense', ['Child Care', 'Child Activities']],
	['Education', 'expense', ['Student Loans', 'Education']],
	['Health & Wellness', 'expense', ['Medical', 'Dentist', 'Fitness']],
	['Financial', 'expense', ['Loan Repayment', 'Financial & Legal Services', 'Financial Fees', 'Cash & ATM', 'Insurance', 'Taxes']],
	['Other', 'expense', ['Uncategorized', 'Check', 'Miscellaneous']],
	['Business', 'expense', ['Advertising & Promotion', 'Business Utilities & Communication', 'Employee Wages & Contract Labor', 'Business Travel & Meals', 'Business Auto Expenses', 'Business Insurance', 'Office Supplies & Expenses', 'Office Rent', 'Postage & Shipping']],
	['Transfers', 'transfer', ['Transfer', 'Credit Card Payment', 'Balance Adjustments']]
];

// Taxes are lumpy and not "spending" you can trim; Monarch also excludes them from budgets.
const EXCLUDED = new Set(['Taxes']);

export const SEED_CATEGORIES: SeedCategory[] = tree.flatMap(([group, kind, cats]) =>
	cats.map((name) => ({ name, group, kind, excludeFromSpending: EXCLUDED.has(name) }))
);
