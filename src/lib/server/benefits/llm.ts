import type { DatabaseSync } from 'node:sqlite';
import { RUBRICS, rubricHash } from './rubrics';
import { nowIso, transaction } from '../db';

/**
 * Asks a cheap model, through OpenRouter, the rubric questions the deterministic rules can't settle.
 * Answers are cached in llm_labels, so each transaction is asked about once per rubric wording.
 *
 * Env: OPENROUTER_API_KEY (required), SPENDLESS_LLM_MODEL (default below).
 */
export const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const BATCH = 40;

let envLoaded = false;
/** Read .env (git-ignored) once, without overriding variables already set. */
function env(name: string): string | undefined {
	if (!envLoaded) {
		envLoaded = true;
		try {
			process.loadEnvFile('.env');
		} catch {
			/* no .env */
		}
	}
	return process.env[name] || undefined;
}

export const llmModel = () => env('SPENDLESS_LLM_MODEL') ?? DEFAULT_MODEL;
export const llmConfigured = () => !!env('OPENROUTER_API_KEY');

interface Row { id: string; date: string; amount_cents: number; merchant: string; monarch_merchant: string | null; statement: string | null; category: string }

export interface ClassifyResult {
	asked: number;
	yes: number;
	no: number;
	unsure: number;
	calls: number;
	promptTokens: number;
	completionTokens: number;
	costUsd: number | null;
	errors: string[];
}

/** Classify up to `limit` pending (rubric, transaction) pairs. */
export async function classifyPending(
	d: DatabaseSync,
	pending: { rubric: string; txnIds: string[] }[],
	opts: { limit?: number; model?: string; onProgress?: (done: number, total: number) => void } = {}
): Promise<ClassifyResult> {
	const key = env('OPENROUTER_API_KEY');
	if (!key) throw new Error('Set OPENROUTER_API_KEY (in .env) to classify transactions with an LLM.');
	const model = opts.model ?? llmModel();
	const limit = opts.limit ?? 400;
	const res: ClassifyResult = { asked: 0, yes: 0, no: 0, unsure: 0, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, errors: [] };
	const get = d.prepare(`SELECT id, date, amount_cents, merchant, monarch_merchant, statement, category FROM txns WHERE id = ?`);
	const put = d.prepare(
		`INSERT INTO llm_labels (rubric, txn_id, rubric_hash, label, reason, model, created_at) VALUES (?,?,?,?,?,?,?)
		 ON CONFLICT(rubric, txn_id) DO UPDATE SET rubric_hash = excluded.rubric_hash, label = excluded.label, reason = excluded.reason,
		   model = excluded.model, created_at = excluded.created_at`
	);

	const total = Math.min(limit, pending.reduce((a, p) => a + p.txnIds.length, 0));
	for (const { rubric, txnIds } of pending) {
		const r = RUBRICS[rubric];
		if (!r) continue;
		const hash = rubricHash(rubric);
		for (let i = 0; i < txnIds.length && res.asked < limit; i += BATCH) {
			const ids = txnIds.slice(i, Math.min(i + BATCH, i + limit - res.asked));
			const rows = ids.map((id) => get.get(id) as unknown as Row | undefined).filter((x): x is Row => !!x);
			if (!rows.length) continue;
			try {
				const { answers, usage } = await ask(key, model, r.question, rows);
				res.calls++;
				res.promptTokens += usage.prompt_tokens ?? 0;
				res.completionTokens += usage.completion_tokens ?? 0;
				if (usage.cost != null && res.costUsd != null) res.costUsd += usage.cost;
				else res.costUsd = null;
				transaction(d, () => {
					for (const a of answers) {
						const row = rows[a.i];
						if (!row) continue;
						put.run(rubric, row.id, hash, a.label, a.reason?.slice(0, 200) ?? null, model, nowIso());
						res[a.label]++;
					}
				});
				res.asked += rows.length;
				opts.onProgress?.(res.asked, total);
			} catch (e) {
				res.errors.push(`${rubric}: ${(e as Error).message}`);
				if (res.errors.length >= 3) return res;
			}
		}
	}
	return res;
}

const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['answers'],
	properties: {
		answers: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['i', 'label', 'reason'],
				properties: {
					i: { type: 'integer', description: 'index of the transaction' },
					label: { type: 'string', enum: ['yes', 'no', 'unsure'] },
					reason: { type: 'string', description: 'a few words' }
				}
			}
		}
	}
};

async function ask(key: string, model: string, question: string, rows: Row[]) {
	const list = rows
		.map((r, i) =>
			JSON.stringify({ i, date: r.date, amount: (Math.abs(r.amount_cents) / 100).toFixed(2), merchant: r.merchant, raw_merchant: r.monarch_merchant ?? undefined, statement: r.statement ?? undefined, category: r.category })
		)
		.join('\n');
	const body = {
		model,
		temperature: 0,
		usage: { include: true },
		response_format: { type: 'json_schema', json_schema: { name: 'labels', strict: true, schema: SCHEMA } },
		messages: [
			{
				role: 'system',
				content:
					'You label US credit card transactions for a personal finance tool. Answer the question for each transaction from its ' +
					'merchant name, bank statement text, category and amount. Use what you know about the merchant. Say "unsure" only when ' +
					'the text really gives no clue. Return one answer per transaction, using its index i.'
			},
			{ role: 'user', content: `Question: ${question}\n\nTransactions (JSON lines):\n${list}` }
		]
	};
	const resp = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Spendless' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(60_000)
	});
	if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
	const j = (await resp.json()) as {
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
		error?: { message?: string };
	};
	if (j.error) throw new Error(j.error.message ?? 'OpenRouter error');
	const text = j.choices?.[0]?.message?.content ?? '';
	const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { answers: { i: number; label: 'yes' | 'no' | 'unsure'; reason?: string }[] };
	const answers = (parsed.answers ?? []).filter((a) => Number.isInteger(a.i) && ['yes', 'no', 'unsure'].includes(a.label));
	return { answers, usage: j.usage ?? {} };
}
