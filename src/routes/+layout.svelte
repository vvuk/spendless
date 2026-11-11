<script lang="ts">
	import '../app.css';
	import { page, navigating } from '$app/state';
	import { enhance } from '$app/forms';
	import { relTime } from '#lib/format.ts';

	let { data, children } = $props();
	let syncing = $state(false);
	let syncMsg = $state<string | null>(null);

	const links = [
		{ href: '/', label: 'Overview' },
		{ href: '/recurring', label: 'Recurring' },
		{ href: '/benefits', label: 'Benefits' },
		{ href: '/transactions', label: 'Transactions' },
		{ href: '/rules', label: 'Rules' }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));
</script>

<header class="top">
	<a class="brand" href="/">Spendless</a>
	<nav aria-label="Sections">
		{#each links as l}
			<a href={l.href} aria-current={active(l.href) ? 'page' : undefined}>{l.label}</a>
		{/each}
	</nav>
	<div class="right">
		{#if data.demo}
			<span class="muted">Showing made-up demo data</span>
		{:else}
			<form
				class="sync"
				method="POST"
				action="/sync"
				use:enhance={() => {
					syncing = true;
					syncMsg = null;
					return async ({ result, update }) => {
						syncing = false;
						if (result.type === 'failure') syncMsg = String((result.data as { error?: string })?.error ?? 'Sync failed');
						// stay on this page and reload its data, rather than following the form to /sync
						await update({ navigate: false });
					};
				}}
			>
				<span class="muted" title={data.sync?.finished_at ?? ''}>
					{#if data.sync?.error}<span class="up">Last sync failed</span>{:else}Data from {data.sync?.source === 'csv' ? 'CSV import' : 'Monarch'}, {relTime(data.sync?.finished_at)}{/if}
				</span>
				<button class="btn" disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
			</form>
		{/if}
		<!-- a plain post and a full page load: every page's data changes at once, so no component should keep
		     state (like the chart's range) from the other dataset -->
		<form method="POST" action="/demo">
			<input type="hidden" name="on" value={data.demo ? '0' : '1'} />
			<input type="hidden" name="to" value={page.url.pathname + page.url.search} />
			<button
				class="btn demo"
				aria-pressed={data.demo}
				title={data.demo ? 'Back to your data' : 'Show generated data instead of yours, for screenshots'}
			><span class="dot" aria-hidden="true"></span>Demo mode</button>
		</form>
	</div>
</header>
{#if syncMsg}<p class="banner" role="alert">{syncMsg}</p>{/if}

<main class:loading={!!navigating.to}>
	{@render children()}
</main>

<style>
	.top {
		display: flex; align-items: center; gap: 28px;
		padding: 14px 32px; border-bottom: 1px solid var(--rule); background: var(--surface);
		position: sticky; top: 0; z-index: 20;
	}
	.brand { font-weight: 650; font-size: 16px; text-decoration: none; letter-spacing: -0.02em; }
	nav { display: flex; gap: 4px; }
	nav a { text-decoration: none; color: var(--ink-2); padding: 4px 10px; border-radius: 6px; }
	nav a:hover { background: var(--wash); }
	nav a[aria-current='page'] { color: var(--ink); background: var(--wash); font-weight: 550; }
	.right { margin-left: auto; display: flex; align-items: center; gap: 12px; font-size: 13px; }
	.sync { display: flex; align-items: center; gap: 12px; }
	.demo { display: inline-flex; align-items: center; gap: 6px; }
	.demo .dot { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--ink-3); }
	.demo[aria-pressed='true'] { border-color: var(--flex); color: var(--flex); }
	.demo[aria-pressed='true'] .dot { background: var(--flex); border-color: var(--flex); }
	.banner { margin: 0; padding: 8px 32px; background: var(--wash); color: var(--up); font-size: 13px; }
	main { max-width: 1440px; margin: 0 auto; padding: 24px 32px 64px; transition: opacity 0.15s; }
	main.loading { opacity: 0.6; }
	@media (max-width: 720px) {
		.top { flex-wrap: wrap; gap: 10px; padding: 12px 16px; }
		.right { margin-left: 0; width: 100%; justify-content: space-between; }
		main { padding: 16px 16px 48px; }
	}
</style>
