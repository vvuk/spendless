import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.ts';
import { localToday } from '../recurring.ts';
import { seedDemo } from './generate.ts';

/** Cookie that turns demo mode on for a browser. */
export const DEMO_COOKIE = 'spendless_demo';

let demo: { day: string; db: DatabaseSync } | undefined;

/**
 * The demo database: in memory only, never written to disk, and rebuilt each day so the
 * history always ends today. Edits made in demo mode (rules, categories, marks) last until
 * the server restarts or the day changes.
 */
export function getDemoDb(): DatabaseSync {
	const day = localToday();
	if (demo?.day === day) return demo.db;
	demo?.db.close();
	const db = openDb(':memory:');
	seedDemo(db, day);
	demo = { day, db };
	return db;
}
