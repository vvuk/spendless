<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { money2, monthLabel, dateShort } from '#lib/format.ts';
	import RuleEditor from '#lib/components/RuleEditor.svelte';
	import { draftFromTxn, draftFromRule, type Draft, type StoredRule } from '#lib/ruleDraft.ts';

	let { data } = $props();
	let q = $state('');
	$effect(() => { q = data.f.q; });

	const groups = $derived.by(() => {
		const m = new Map<string, string[]>();
		for (const c of data.categories) (m.get(c.grp) ?? m.set(c.grp, []).get(c.grp)!).push(c.name);
		return [...m.entries()];
	});

	function setParam(k: string, v: string) {
		const u = new URL(page.url.href);
		if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
		u.searchParams.delete('page');
		goto(u.pathname + u.search, { replace: true });
	}
	let t: ReturnType<typeof setTimeout>;
	const onSearch = () => { clearTimeout(t); t = setTimeout(() => setParam('q', q.trim()), 250); };

	// Form actions keep the current filters in their URL, and results apply in place (no navigation),
	// so the list you're looking at stays put after an edit.
	const act = (name: string) => `${page.url.search ? page.url.search + '&' : '?'}/${name}`;
	const stay = () => async ({ update }: { update: (o?: { reset?: boolean; navigate?: boolean }) => Promise<void> }) =>
		update({ reset: false, navigate: false });

	// Inline edits of a row's name or note: Enter (or leaving the field) saves, Escape cancels.
	let renaming = $state<string | null>(null);
	let noting = $state<string | null>(null);
	const closeEdits = () => { renaming = null; noting = null; };
	const saveInline = () => async ({ update }: { update: (o?: { reset?: boolean; navigate?: boolean }) => Promise<void> }) => {
		await update({ reset: false, navigate: false });
		closeEdits();
	};
	function focus(node: HTMLInputElement | HTMLTextAreaElement) {
		node.focus();
		node.select();
	}
	function editKeys(e: KeyboardEvent) {
		const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		if (e.key === 'Escape') { e.preventDefault(); el.dataset.cancel = '1'; closeEdits(); }
		else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.form?.requestSubmit(); }
	}
	function editBlur(e: FocusEvent) {
		const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		if (el.dataset.cancel) return;
		if (el.value.trim() === (el.dataset.orig ?? '').trim()) closeEdits();
		else el.form?.requestSubmit();
	}
	function nameTitle(r: { merchant_source: string; monarch_merchant: string | null; statement: string | null }) {
		const orig = r.monarch_merchant ?? r.statement;
		if (r.merchant_source === 'manual') return `Renamed by you${orig ? ` (Monarch: ${orig})` : ''}. Click to edit.`;
		if (r.merchant_source === 'rule') return `Named by a rule${orig ? ` (Monarch: ${orig})` : ''}. Click to rename this one.`;
		return 'Click to rename';
	}

	let editing = $state<Draft | null>(null);
	let toast = $state<string | null>(null);
	async function openRuleFor(id: number) {
		const r = (await (await fetch(`/api/rules/${id}`)).json()) as StoredRule & { id: number };
		editing = draftFromRule(r);
	}
	async function saved(msg: string) {
		editing = null;
		toast = msg;
		await invalidateAll();
		setTimeout(() => (toast = null), 4000);
	}
	const pages = $derived(Math.ceil(data.count / data.pageSize));
	const pageHref = (p: number) => { const u = new URL(page.url.href); u.searchParams.set('page', String(p)); return u.pathname + u.search; };
</script>

<svelte:head><title>Transactions · Spendless</title></svelte:head>

<div class="bar">
	<h1>Transactions</h1>
	<span class="muted num">{data.count.toLocaleString()} matching, net {money2(data.sum)}</span>
</div>

<div class="filters">
	<input type="search" placeholder="Search name, statement or note" bind:value={q} oninput={onSearch} aria-label="Search" />
	<select value={data.f.month} onchange={(e) => setParam('month', e.currentTarget.value)} aria-label="Month">
		<option value="">All months</option>
		{#each data.months as m}<option value={m}>{monthLabel(m, true)}</option>{/each}
	</select>
	<select value={data.f.category} onchange={(e) => setParam('category', e.currentTarget.value)} aria-label="Category">
		<option value="">All categories</option>
		{#each groups as [g, cs]}<optgroup label={g}>{#each cs as c}<option value={c}>{c}</option>{/each}</optgroup>{/each}
	</select>
	<select value={data.f.source} onchange={(e) => setParam('source', e.currentTarget.value)} aria-label="Categorized by">
		<option value="">Categorized by anyone</option>
		<option value="monarch">By Monarch</option>
		<option value="rule">By your rules</option>
		<option value="manual">By you, one at a time</option>
	</select>
	{#if data.f.q || data.f.month || data.f.category || data.f.source}<a class="clear" href="/transactions">Clear filters</a>{/if}
	<a class="muted rules" href="/rules">{data.ruleCount} {data.ruleCount === 1 ? 'rule' : 'rules'}</a>
</div>

{#if toast}<p class="note" role="status">{toast}</p>{/if}

<table class="data tx">
	<thead>
		<tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th class="r">Amount</th><th class="r">Count it</th></tr>
	</thead>
	<tbody>
		{#each data.rows as r (r.id)}
			<tr class:excluded={r.excluded} class:pending={r.pending}>
				<td class="num ink2 nowrap">{dateShort(r.date)}<span class="yr">{r.date.slice(0, 4)}</span></td>
				<td class="mcell">
					{#if renaming === r.id}
						<form method="POST" action={act('rename')} class="inline" use:enhance={saveInline}>
							<input type="hidden" name="id" value={r.id} />
							<input name="name" class="nameinput" value={r.merchant} data-orig={r.merchant} maxlength="200" autocomplete="off" aria-label="Name for this transaction"
								use:focus onkeydown={editKeys} onblur={editBlur} />
						</form>
						<div class="meta hint">Enter to save, Esc to cancel. Clear it to go back to {r.merchant_source === 'rule' ? 'the rule’s' : 'Monarch’s'} name.</div>
					{:else}
						<button class="m namebtn" title={nameTitle(r)} onclick={() => { closeEdits(); renaming = r.id; }}>{r.merchant}</button>
						{#if r.merchant_source === 'manual'}<span class="src you" title={nameTitle(r)}>You</span>{/if}
						{#if r.pending}<span class="tag">Pending</span>{/if}
						<button class="notebtn" class:has={!!r.notes} title={r.notes ? 'Edit note' : 'Add a note'} aria-label="{r.notes ? 'Edit' : 'Add a'} note for {r.merchant}"
							onclick={() => { closeEdits(); noting = r.id; }}>✎</button>
					{/if}
					{#if r.statement && r.statement.toLowerCase() !== r.merchant.toLowerCase()}<div class="meta">{r.statement}</div>{/if}
					{#if noting === r.id}
						<form method="POST" action={act('note')} class="inline" use:enhance={saveInline}>
							<input type="hidden" name="id" value={r.id} />
							<textarea name="note" class="noteinput" rows="2" maxlength="2000" placeholder="Add a note (searchable)" aria-label="Note for {r.merchant}"
								value={r.notes ?? ''} data-orig={r.notes ?? ''} use:focus onkeydown={editKeys} onblur={editBlur}></textarea>
						</form>
						<div class="meta hint">Enter to save, Shift+Enter for a new line, Esc to cancel.{#if r.monarch_notes} Clear it to hide Monarch’s note.{/if}</div>
					{:else if r.notes}
						<button class="notetext" title={r.notes !== r.monarch_notes ? 'Your note. Click to edit.' : 'Note from Monarch. Click to edit.'} onclick={() => { closeEdits(); noting = r.id; }}>{r.notes}</button>
					{/if}
				</td>
				<td class="catcell">
					<form method="POST" action={act('categorize')} class="catform" use:enhance={stay}>
						<input type="hidden" name="id" value={r.id} />
						<select name="category" value={r.category} aria-label="Category for {r.merchant}" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							{#each groups as [g, cs]}<optgroup label={g}>{#each cs as c}<option value={c}>{c}</option>{/each}</optgroup>{/each}
						</select>
					</form>
					<span class="src">
						{#if r.category_source === 'rule' && r.rule_id}
							<button class="srcbtn" title="Set by a rule. Click to edit it." onclick={() => openRuleFor(r.rule_id!)}>Rule</button>
						{:else if r.category_source === 'manual'}
							<span title={r.monarch_category ? `Monarch said ${r.monarch_category}` : ''}>You</span>
						{/if}
					</span>
					<button class="mk" title="Make a rule from this transaction" aria-label="Make a rule from this {r.merchant} transaction" onclick={() => (editing = draftFromTxn(r))}>»</button>
				</td>
				<td class="ink2 acct">{r.account.replace(/\s*\(\.\.\.(\d+)\)/, ' ··$1')}</td>
				<td class="r num nowrap" class:inflow={r.amount_cents > 0}>{r.amount_cents > 0 ? '+' : ''}{money2(r.amount_cents)}</td>
				<td class="r">
					<form method="POST" action={act('exclude')} use:enhance={stay}>
						<input type="hidden" name="id" value={r.id} />
						<input type="hidden" name="excluded" value={r.excluded ? '0' : '1'} />
						<button class="link" title={r.excluded ? 'Count this in spending again' : 'Leave this out of spending totals (reimbursed, one-off, not really yours)'}>{r.excluded ? 'Excluded' : 'Counted'}</button>
					</form>
				</td>
			</tr>
		{:else}
			<tr><td colspan="6" class="empty">Nothing matches these filters. Try a shorter search or clear the filters.</td></tr>
		{/each}
	</tbody>
</table>

{#if editing}
	<RuleEditor bind:draft={editing} categories={groups} accounts={data.accounts} onclose={() => (editing = null)} onsaved={saved} />
{/if}

{#if pages > 1}
	<nav class="pager" aria-label="Pages">
		{#if data.page > 0}<a href={pageHref(data.page - 1)}>Newer</a>{/if}
		<span class="muted">Page {data.page + 1} of {pages}</span>
		{#if data.page < pages - 1}<a href={pageHref(data.page + 1)}>Older</a>{/if}
	</nav>
{/if}

<style>
	.bar { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
	h1 { font-size: 26px; letter-spacing: -0.025em; }
	.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
	.filters input, .filters select { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); padding: 5px 9px; font-size: 13px; }
	.filters input { width: 300px; max-width: 100%; }
	.clear { font-size: 13px; }
	.rules { margin-left: auto; font-size: 12.5px; }
	.rules:hover { color: var(--ink); }
	.note { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 12px; font-size: 13px; }
	.tx td { padding-top: 6px; padding-bottom: 6px; }
	.nowrap { white-space: nowrap; }
	.yr { color: var(--ink-3); margin-left: 5px; font-size: 12px; }
	.mcell { max-width: 360px; }
	.m { font-weight: 500; }
	.namebtn { border: 0; background: none; padding: 0; font: inherit; font-weight: 500; color: inherit; cursor: text; text-align: left; }
	.namebtn:hover, .namebtn:focus-visible { text-decoration: underline dotted; text-underline-offset: 3px; }
	.src.you { width: auto; margin-left: 6px; }
	.notebtn {
		border: 0; background: none; padding: 0 3px; margin-left: 4px; cursor: pointer; font-size: 13px; line-height: 1;
		color: var(--ink-3); opacity: 0; vertical-align: baseline;
	}
	tr:hover .notebtn, .notebtn:focus-visible { opacity: 1; }
	.notebtn:hover { color: var(--flex); }
	.notebtn.has { display: none; }
	.notetext {
		display: block; max-width: 100%; border: 0; background: none; padding: 0; margin-top: 1px; cursor: text; text-align: left;
		font: inherit; font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.notetext::before { content: '✎ '; color: var(--ink-3); }
	.notetext:hover { color: var(--ink); }
	.inline { display: block; }
	.nameinput, .noteinput {
		width: 100%; box-sizing: border-box; border: 1px solid var(--rule); border-radius: 5px; background: var(--surface);
		padding: 2px 6px; font: inherit; color: var(--ink);
	}
	.nameinput { font-weight: 500; }
	.noteinput { font-size: 12.5px; margin-top: 3px; resize: vertical; }
	.hint { white-space: normal; }
	.meta { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tag { font-size: 11px; padding: 0 5px; border-radius: 4px; background: var(--wash); color: var(--ink-2); margin-left: 6px; }
	.catcell { white-space: nowrap; width: 300px; }
	.catform { display: inline-block; vertical-align: middle; }
	.catform select { border: 1px solid transparent; background: transparent; padding: 2px 4px; border-radius: 5px; font-size: 13px; width: 200px; }
	.catform select:hover, .catform select:focus { border-color: var(--rule); background: var(--surface); }
	.src { display: inline-block; width: 40px; font-size: 11px; font-weight: 550; color: var(--flex); vertical-align: middle; }
	.srcbtn { border: 0; background: none; padding: 0; font: inherit; color: inherit; cursor: pointer; text-decoration: underline dotted; }
	.mk {
		width: 26px; height: 24px; border: 1px solid transparent; border-radius: 6px; background: none; cursor: pointer;
		color: var(--ink-3); font-size: 15px; line-height: 1; vertical-align: middle;
	}
	tr:hover .mk { border-color: var(--rule); color: var(--ink); }
	.mk:hover, .mk:focus-visible { background: var(--surface); color: var(--flex) !important; }
	.acct { font-size: 12.5px; white-space: nowrap; }
	.inflow { color: var(--good); }
	tr.excluded td { color: var(--ink-3); }
	tr.excluded .m { text-decoration: line-through; }
	tr.pending td { font-style: italic; }
	.tx { table-layout: auto; }
	.link { border: 0; background: none; padding: 0; font-size: 12px; color: var(--ink-3); cursor: pointer; text-decoration: underline dotted; }
	.empty { padding: 32px 0; color: var(--ink-2); }
	.pager { display: flex; gap: 16px; justify-content: center; margin-top: 18px; font-size: 13px; }
	@media (max-width: 760px) {
		.acct, th:nth-child(4), th:nth-child(6), td:last-child { display: none; }
	}
</style>
