/**
 * Live sync from Monarch's official MCP server (https://api.monarch.com/mcp).
 *
 * Auth is OAuth 2.1 + PKCE with a loopback redirect, the same flow Claude Code uses. The first
 * `npm run sync` opens your browser to approve read access; tokens are saved to data/monarch-auth.json
 * (chmod 600, git-ignored) and refreshed automatically after that.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { toCents } from '../money';
import { nowIso, transaction } from '../db';
import { upsertTransactions, recordRun, type IncomingTxn, type UpsertResult } from '../import/upsert';

const MCP_URL = process.env.MONARCH_MCP_URL ?? 'https://api.monarch.com/mcp';
const CALLBACK_PORT = Number(process.env.SPENDLESS_OAUTH_PORT ?? 53682);
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const AUTH_FILE = resolve(process.env.SPENDLESS_AUTH_FILE ?? 'data/monarch-auth.json');
const INTENT = 'organizing_finances';

interface Saved {
	client?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	verifier?: string;
}

class FileOAuthProvider implements OAuthClientProvider {
	private saved: Saved;
	private server?: Server;
	private codePromise?: Promise<string>;

	constructor(private interactive: boolean) {
		this.saved = existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) : {};
	}
	private persist() {
		mkdirSync(dirname(AUTH_FILE), { recursive: true });
		writeFileSync(AUTH_FILE, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
		chmodSync(AUTH_FILE, 0o600);
	}
	get redirectUrl() {
		return REDIRECT;
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'Spendless (local)',
			redirect_uris: [REDIRECT],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		};
	}
	clientInformation() { return this.saved.client; }
	saveClientInformation(c: OAuthClientInformationMixed) { this.saved.client = c; this.persist(); }
	tokens() { return this.saved.tokens; }
	saveTokens(t: OAuthTokens) { this.saved.tokens = t; this.persist(); }
	saveCodeVerifier(v: string) { this.saved.verifier = v; this.persist(); }
	codeVerifier() {
		if (!this.saved.verifier) throw new Error('No PKCE verifier saved');
		return this.saved.verifier;
	}
	async redirectToAuthorization(url: URL) {
		if (!this.interactive) throw new Error('Monarch sign-in needed. Run `npm run sync` in a terminal once to approve access.');
		this.codePromise = this.listenForCode();
		console.log(`\nApprove Spendless in your browser:\n  ${url.href}\n`);
		try {
			const { default: open } = await import('open');
			await open(url.href);
		} catch { /* the printed link works too */ }
	}
	private listenForCode(): Promise<string> {
		return new Promise((ok, fail) => {
			this.server = createServer((req, res) => {
				const u = new URL(req.url ?? '/', REDIRECT);
				if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
				const code = u.searchParams.get('code');
				const err = u.searchParams.get('error');
				res.writeHead(200, { 'content-type': 'text/html' }).end(
					`<body style="font:16px system-ui;padding:3rem">${code ? 'Spendless is connected to Monarch. You can close this tab.' : 'Sign-in failed: ' + (err ?? 'unknown')}</body>`
				);
				this.server?.close();
				code ? ok(code) : fail(new Error(`OAuth error: ${err}`));
			});
			this.server.on('error', fail);
			this.server.listen(CALLBACK_PORT, '127.0.0.1');
			setTimeout(() => { this.server?.close(); fail(new Error('Timed out waiting for Monarch approval')); }, 5 * 60_000).unref();
		});
	}
	waitForCode() {
		if (!this.codePromise) throw new Error('Authorization was not started');
		return this.codePromise;
	}
}

export async function connectMonarch(interactive: boolean): Promise<Client> {
	const provider = new FileOAuthProvider(interactive);
	const transport = () => new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });
	const client = new Client({ name: 'spendless', version: '0.1.0' });
	const t = transport();
	try {
		await client.connect(t);
		return client;
	} catch (e) {
		if (!(e instanceof UnauthorizedError)) throw e;
		const code = await provider.waitForCode();
		await t.finishAuth(code);
		const fresh = new Client({ name: 'spendless', version: '0.1.0' });
		await fresh.connect(transport());
		return fresh;
	}
}

/** Monarch's tools return JSON text, sometimes wrapped as {"result": "<json>"}. */
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
	const res = await client.callTool({ name, arguments: { intent: INTENT, ...args } });
	const content = res.content as { type: string; text?: string }[] | undefined;
	if (res.isError) throw new Error(`${name} failed: ${content?.map((c) => c.text).join(' ')}`);
	let data: unknown = res.structuredContent ?? JSON.parse(content?.find((c) => c.type === 'text')?.text ?? 'null');
	while (data && typeof data === 'object' && 'result' in data && typeof (data as { result: unknown }).result === 'string')
		data = JSON.parse((data as { result: string }).result);
	return data as T;
}

interface McpTxn { id: string; date: string; pending: boolean; merchant: string | null; amount: number; category: string | null; account: string }

export interface SyncResult extends UpsertResult {
	window: { start: string; end: string };
	fetched: number;
	accounts: number;
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export async function syncFromMonarch(
	d: DatabaseSync,
	opts: { since?: string; interactive?: boolean; log?: (s: string) => void } = {}
): Promise<SyncResult> {
	const log = opts.log ?? (() => {});
	const started = nowIso();
	// Monarch keeps editing recent rows (pending → posted, recategorization), so always re-pull a window.
	const window = { start: opts.since ?? isoDaysAgo(45), end: isoDaysAgo(-1) };
	try {
		const client = await connectMonarch(opts.interactive ?? false);
		try {
			// Reference data first.
			const cats = await call<{ category_groups: { name: string; type: string; categories: { id: string; name: string }[] }[] }>(client, 'GetCategories', {});
			const acc = await call<{ accounts: { id: string; name: string; type: string; balance: number; institution?: string }[] }>(client, 'GetAccounts', {});
			transaction(d, () => {
				const c = d.prepare(
					`INSERT INTO categories (name, group_name, kind, monarch_id) VALUES (?,?,?,?)
					 ON CONFLICT(name) DO UPDATE SET group_name = excluded.group_name, kind = excluded.kind, monarch_id = excluded.monarch_id`
				);
				for (const g of cats.category_groups)
					for (const cat of g.categories) c.run(cat.name, g.name, g.type === 'income' || g.type === 'transfer' ? g.type : 'expense', cat.id);
				const a = d.prepare(
					`INSERT INTO accounts (name, monarch_id, type, institution, balance_cents, balance_at) VALUES (?,?,?,?,?,?)
					 ON CONFLICT(name) DO UPDATE SET monarch_id = excluded.monarch_id, type = excluded.type,
					   institution = excluded.institution, balance_cents = excluded.balance_cents, balance_at = excluded.balance_at`
				);
				for (const x of acc.accounts) a.run(x.name, x.id, x.type, x.institution ?? null, toCents(x.balance), started);
			});
			log(`${acc.accounts.length} accounts, ${cats.category_groups.length} category groups`);

			// Transactions, paged.
			const rows: IncomingTxn[] = [];
			for (let offset = 0; ; ) {
				const page = await call<{ transactions: McpTxn[]; next_offset?: number }>(client, 'GetTransactions', {
					start_date: window.start,
					end_date: window.end,
					limit: 100,
					offset,
					sort_by: 'date',
					filters: JSON.stringify({ transaction_type: 'All', visibility: 'all' })
				});
				for (const t of page.transactions)
					rows.push({
						id: String(t.id), date: t.date, amountCents: toCents(t.amount), account: t.account,
						pending: !!t.pending, merchant: t.merchant ?? null, category: t.category ?? null
						// statement/notes/tags aren't in the compact listing; upsert keeps what the CSV gave us
					});
				log(`  fetched ${rows.length}`);
				if (page.next_offset == null || !page.transactions.length) break;
				offset = page.next_offset;
			}

			const res = upsertTransactions(d, rows, 'mcp', window);
			recordRun(d, 'mcp', started, res, window);
			return { ...res, window, fetched: rows.length, accounts: acc.accounts.length };
		} finally {
			await client.close();
		}
	} catch (e) {
		recordRun(d, 'mcp', started, {}, window, String((e as Error).message ?? e));
		throw e;
	}
}
