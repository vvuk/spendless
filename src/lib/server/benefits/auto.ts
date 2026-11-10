import type { DatabaseSync } from 'node:sqlite';
import { analyzeBenefits } from './analyze';
import { classifyPending, llmConfigured, type ClassifyResult } from './llm';
import { localToday } from '../recurring';

let running: Promise<ClassifyResult | null> | null = null;

/**
 * After new transactions arrive, ask the LLM about the ones that need a judgement call. Answers are cached, so
 * normally only the new purchases are sent. Does nothing without OPENROUTER_API_KEY, and never throws: a failed
 * classification must not fail the sync (the purchases just stay pending until next time).
 */
export function classifyAfterSync(d: DatabaseSync, log: (msg: string) => void = () => {}): Promise<ClassifyResult | null> {
	if (!llmConfigured()) return Promise.resolve(null);
	// one run at a time; a second sync while one is running shares its result
	if (running) return running;
	running = (async () => {
		try {
			const pending = analyzeBenefits(d, localToday()).pending;
			if (!pending.some((p) => p.txnIds.length)) return null;
			const r = await classifyPending(d, pending, { limit: 400 });
			log(`Benefits: classified ${r.asked} transactions (${r.yes} yes, ${r.no} no, ${r.unsure} unsure)` + (r.costUsd != null ? `, $${r.costUsd.toFixed(4)}` : ''));
			for (const e of r.errors) log(`Benefits: ${e}`);
			return r;
		} catch (e) {
			log(`Benefits: classification failed: ${(e as Error).message}`);
			return null;
		}
	})().finally(() => {
		running = null;
	});
	return running;
}
