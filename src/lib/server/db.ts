import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SEED_CATEGORIES } from './categories';

/**
 * Data model
 * - raw_transactions: exactly what Monarch reports, keyed by Monarch's transaction id.
 *   Imports and syncs upsert here and never touch your edits.
 * - overrides / rules / rule_hits: your layer. The `txns` view merges them:
 *   manual override > rule > Monarch's value.
 */
const MIGRATIONS: string[] = [
	/* v1 */ `
	CREATE TABLE accounts (
		name TEXT PRIMARY KEY,
		monarch_id TEXT UNIQUE,
		type TEXT,
		institution TEXT,
		balance_cents INTEGER,
		balance_at TEXT
	);

	CREATE TABLE categories (
		name TEXT PRIMARY KEY,
		group_name TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
		exclude_from_spending INTEGER NOT NULL DEFAULT 0,
		monarch_id TEXT
	);

	CREATE TABLE raw_transactions (
		id TEXT PRIMARY KEY,                 -- Monarch transaction id
		date TEXT NOT NULL,                  -- YYYY-MM-DD
		amount_cents INTEGER NOT NULL,       -- negative = money out
		account TEXT NOT NULL,
		merchant TEXT,
		statement TEXT,                      -- original bank statement text
		category TEXT,
		notes TEXT,
		tags TEXT,
		owner TEXT,
		pending INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL,                -- 'csv' | 'mcp' (last writer)
		first_seen_at TEXT NOT NULL,
		last_seen_at TEXT NOT NULL,
		deleted_at TEXT                      -- set when Monarch no longer reports it
	);
	CREATE INDEX ix_raw_date ON raw_transactions(date);
	CREATE INDEX ix_raw_merchant ON raw_transactions(merchant);

	CREATE TABLE overrides (
		txn_id TEXT PRIMARY KEY REFERENCES raw_transactions(id),
		category TEXT,
		merchant TEXT,
		note TEXT,
		excluded INTEGER,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE rules (
		id INTEGER PRIMARY KEY,
		priority INTEGER NOT NULL DEFAULT 100,  -- lower runs first; first match wins
		field TEXT NOT NULL CHECK (field IN ('merchant','statement')),
		pattern TEXT NOT NULL,                  -- case-insensitive regex
		account TEXT,
		min_cents INTEGER,
		max_cents INTEGER,
		set_category TEXT,
		set_merchant TEXT,
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL
	);

	CREATE TABLE rule_hits (
		txn_id TEXT PRIMARY KEY,
		rule_id INTEGER NOT NULL,
		category TEXT,
		merchant TEXT
	);

	CREATE TABLE recurring_marks (
		series_key TEXT PRIMARY KEY,
		status TEXT NOT NULL CHECK (status IN ('keep','cancel','cancelled','not_recurring')),
		note TEXT,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE sync_runs (
		id INTEGER PRIMARY KEY,
		source TEXT NOT NULL,
		started_at TEXT NOT NULL,
		finished_at TEXT,
		window_start TEXT,
		window_end TEXT,
		inserted INTEGER NOT NULL DEFAULT 0,
		updated INTEGER NOT NULL DEFAULT 0,
		deleted INTEGER NOT NULL DEFAULT 0,
		error TEXT
	);

	CREATE VIEW txns AS
	SELECT
		r.id, r.date, substr(r.date,1,7) AS month, r.amount_cents, r.account, r.pending,
		r.statement, r.notes, r.tags, r.owner,
		COALESCE(o.merchant, h.merchant, r.merchant, r.statement, '(unknown)') AS merchant,
		COALESCE(o.category, h.category, r.category, 'Uncategorized') AS category,
		CASE WHEN o.category IS NOT NULL THEN 'manual'
		     WHEN h.category IS NOT NULL THEN 'rule'
		     ELSE 'monarch' END AS category_source,
		r.category AS monarch_category,
		COALESCE(c.group_name, 'Other') AS category_group,
		COALESCE(c.kind, 'expense') AS kind,
		COALESCE(o.excluded, 0) AS excluded,
		CASE WHEN COALESCE(c.kind,'expense') = 'expense'
		      AND COALESCE(c.exclude_from_spending,0) = 0
		      AND COALESCE(o.excluded,0) = 0
		     THEN -r.amount_cents ELSE 0 END AS spend_cents
	FROM raw_transactions r
	LEFT JOIN overrides o ON o.txn_id = r.id
	LEFT JOIN rule_hits h ON h.txn_id = r.id
	LEFT JOIN categories c ON c.name = COALESCE(o.category, h.category, r.category)
	WHERE r.deleted_at IS NULL;
	`,
	/* v2: rules can combine several conditions (merchant, statement, amount, direction, account, Monarch category, dates) */ `
	CREATE TABLE rules_v2 (
		id INTEGER PRIMARY KEY,
		priority INTEGER NOT NULL DEFAULT 100,   -- lower runs first; ties go to the more specific rule, then the newer one
		merchant_op TEXT CHECK (merchant_op IN ('is','contains','regex')),
		merchant_value TEXT,
		statement_op TEXT CHECK (statement_op IN ('is','contains','regex')),
		statement_value TEXT,
		direction TEXT CHECK (direction IN ('out','in')),
		min_cents INTEGER,                        -- bounds on the absolute amount, inclusive
		max_cents INTEGER,
		account TEXT,
		monarch_category TEXT,
		date_from TEXT,
		date_to TEXT,
		set_category TEXT,
		set_merchant TEXT,
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL,
		updated_at TEXT
	);
	INSERT INTO rules_v2 (id, priority, merchant_op, merchant_value, statement_op, statement_value, account,
		min_cents, max_cents, set_category, set_merchant, enabled, created_at)
	SELECT id, priority,
		CASE WHEN field = 'merchant' THEN 'regex' END, CASE WHEN field = 'merchant' THEN pattern END,
		CASE WHEN field = 'statement' THEN 'regex' END, CASE WHEN field = 'statement' THEN pattern END,
		account, min_cents, max_cents, set_category, set_merchant, enabled, created_at
	FROM rules;
	DROP TABLE rules;
	ALTER TABLE rules_v2 RENAME TO rules;

	-- expose Monarch's raw merchant and the winning rule, so rules can be built and traced from a row
	DROP VIEW txns;
	CREATE VIEW txns AS
	SELECT
		r.id, r.date, substr(r.date,1,7) AS month, r.amount_cents, r.account, r.pending,
		r.statement, r.notes, r.tags, r.owner,
		COALESCE(o.merchant, h.merchant, r.merchant, r.statement, '(unknown)') AS merchant,
		r.merchant AS monarch_merchant,
		COALESCE(o.category, h.category, r.category, 'Uncategorized') AS category,
		CASE WHEN o.category IS NOT NULL THEN 'manual'
		     WHEN h.category IS NOT NULL THEN 'rule'
		     ELSE 'monarch' END AS category_source,
		h.rule_id,
		r.category AS monarch_category,
		COALESCE(c.group_name, 'Other') AS category_group,
		COALESCE(c.kind, 'expense') AS kind,
		COALESCE(o.excluded, 0) AS excluded,
		CASE WHEN COALESCE(c.kind,'expense') = 'expense'
		      AND COALESCE(c.exclude_from_spending,0) = 0
		      AND COALESCE(o.excluded,0) = 0
		     THEN -r.amount_cents ELSE 0 END AS spend_cents
	FROM raw_transactions r
	LEFT JOIN overrides o ON o.txn_id = r.id
	LEFT JOIN rule_hits h ON h.txn_id = r.id
	LEFT JOIN categories c ON c.name = COALESCE(o.category, h.category, r.category)
	WHERE r.deleted_at IS NULL;
	`,
	/* v3 */ `
	-- recurring decisions: status and a type override are independent, either may be empty
	CREATE TABLE recurring_marks_v2 (
		series_key TEXT PRIMARY KEY,
		status TEXT CHECK (status IN ('keep','cancel','cancelled','not_recurring')),
		kind TEXT CHECK (kind IN ('subscription','bill','obligation')),
		note TEXT,
		updated_at TEXT NOT NULL
	);
	INSERT INTO recurring_marks_v2 (series_key, status, note, updated_at) SELECT series_key, status, note, updated_at FROM recurring_marks;
	DROP TABLE recurring_marks;
	ALTER TABLE recurring_marks_v2 RENAME TO recurring_marks;
	`,
	/* v4: a rule can declare that what it matches is a recurring charge (e.g. rent paid over Venmo) */ `
	ALTER TABLE rules ADD COLUMN recurring_kind TEXT CHECK (recurring_kind IN ('subscription','bill','obligation'));
	ALTER TABLE rules ADD COLUMN recurring_cadence TEXT CHECK (recurring_cadence IN ('weekly','biweekly','monthly','quarterly','semiannual','annual'));
	`,
	/* v5: credit card benefits (src/lib/server/benefits) */ `
	-- which synced account is which card; a row here overrides auto-detection (card_id NULL = not a tracked card)
	CREATE TABLE card_accounts (
		account TEXT PRIMARY KEY,
		card_id TEXT,
		anniversary TEXT,                 -- MM-DD; NULL = inferred from the annual fee posting
		updated_at TEXT NOT NULL
	);
	-- enrollment in benefits that need it; method 'automation' is for the future auto sign-up
	CREATE TABLE benefit_enrollment (
		account TEXT NOT NULL,
		benefit_id TEXT NOT NULL,         -- '<card id>/<benefit id>'
		status TEXT NOT NULL CHECK (status IN ('enrolled','not_enrolled')),
		method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','automation')),
		note TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (account, benefit_id)
	);
	-- LLM answers to a rubric about one transaction; rubric_hash ties the answer to the rubric's wording
	CREATE TABLE llm_labels (
		rubric TEXT NOT NULL,
		txn_id TEXT NOT NULL,
		rubric_hash TEXT NOT NULL,
		label TEXT NOT NULL CHECK (label IN ('yes','no','unsure')),
		reason TEXT,
		model TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (rubric, txn_id)
	);
	-- your call on whether a transaction counts toward a benefit; beats rules and the LLM
	CREATE TABLE benefit_txn_overrides (
		benefit_id TEXT NOT NULL,         -- '<card id>/<benefit id>'
		txn_id TEXT NOT NULL,
		eligible INTEGER NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (benefit_id, txn_id)
	);
	`,
	/* v6: your own name and note for a transaction (overrides.merchant / overrides.note, unused until now) */ `
	-- notes: your note, else Monarch's ('' = you cleared it). merchant_source says who named it.
	DROP VIEW txns;
	CREATE VIEW txns AS
	SELECT
		r.id, r.date, substr(r.date,1,7) AS month, r.amount_cents, r.account, r.pending,
		r.statement, COALESCE(o.note, r.notes) AS notes, r.tags, r.owner,
		COALESCE(o.merchant, h.merchant, r.merchant, r.statement, '(unknown)') AS merchant,
		r.merchant AS monarch_merchant,
		CASE WHEN o.merchant IS NOT NULL THEN 'manual'
		     WHEN h.merchant IS NOT NULL THEN 'rule'
		     ELSE 'monarch' END AS merchant_source,
		r.notes AS monarch_notes,
		COALESCE(o.category, h.category, r.category, 'Uncategorized') AS category,
		CASE WHEN o.category IS NOT NULL THEN 'manual'
		     WHEN h.category IS NOT NULL THEN 'rule'
		     ELSE 'monarch' END AS category_source,
		h.rule_id,
		r.category AS monarch_category,
		COALESCE(c.group_name, 'Other') AS category_group,
		COALESCE(c.kind, 'expense') AS kind,
		COALESCE(o.excluded, 0) AS excluded,
		CASE WHEN COALESCE(c.kind,'expense') = 'expense'
		      AND COALESCE(c.exclude_from_spending,0) = 0
		      AND COALESCE(o.excluded,0) = 0
		     THEN -r.amount_cents ELSE 0 END AS spend_cents
	FROM raw_transactions r
	LEFT JOIN overrides o ON o.txn_id = r.id
	LEFT JOIN rule_hits h ON h.txn_id = r.id
	LEFT JOIN categories c ON c.name = COALESCE(o.category, h.category, r.category)
	WHERE r.deleted_at IS NULL;
	`
];

let db: DatabaseSync | undefined;

// Lets one request run against another database (demo mode) without threading it through every call.
const scoped = new AsyncLocalStorage<DatabaseSync>();

export function dbPath() {
	return resolve(process.env.SPENDLESS_DB ?? 'data/spendless.db');
}

/** The database for the current request: the demo database while demo mode is on, otherwise yours. */
export function getDb(): DatabaseSync {
	const s = scoped.getStore();
	if (s) return s;
	if (db) return db;
	const path = dbPath();
	mkdirSync(dirname(path), { recursive: true });
	db = openDb(path);
	return db;
}

/** Run `fn` (and everything it awaits) with `getDb()` returning `d`. */
export function withDb<T>(d: DatabaseSync, fn: () => T): T {
	return scoped.run(d, fn);
}

/** Open a database at `path` (or ':memory:') with the full schema applied. */
export function openDb(path: string): DatabaseSync {
	const d = new DatabaseSync(path);
	d.exec(`${path === ':memory:' ? '' : 'PRAGMA journal_mode = WAL;'} PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
	migrate(d);
	return d;
}

function migrate(d: DatabaseSync) {
	const { user_version } = d.prepare('PRAGMA user_version').get() as { user_version: number };
	for (let v = user_version; v < MIGRATIONS.length; v++) {
		transaction(d, () => {
			d.exec(MIGRATIONS[v]);
			d.exec(`PRAGMA user_version = ${v + 1}`);
		});
	}
	if (user_version === 0) seedCategories(d);
}

function seedCategories(d: DatabaseSync) {
	const ins = d.prepare(
		`INSERT OR IGNORE INTO categories (name, group_name, kind, exclude_from_spending) VALUES (?,?,?,?)`
	);
	transaction(d, () => {
		for (const c of SEED_CATEGORIES) ins.run(c.name, c.group, c.kind, c.excludeFromSpending ? 1 : 0);
	});
}

export function transaction<T>(d: DatabaseSync, fn: () => T): T {
	d.exec('BEGIN');
	try {
		const out = fn();
		d.exec('COMMIT');
		return out;
	} catch (e) {
		d.exec('ROLLBACK');
		throw e;
	}
}

export const nowIso = () => new Date().toISOString();
