<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import RuleEditor from '#lib/components/RuleEditor.svelte';
	import { blankDraft, draftFromRule, draftToRule, type Draft } from '#lib/ruleDraft.ts';

	let { data } = $props();
	const groups = $derived.by(() => {
		const m = new Map<string, string[]>();
		for (const c of data.categories) (m.get(c.grp) ?? m.set(c.grp, []).get(c.grp)!).push(c.name);
		return [...m.entries()];
	});
	let editing = $state<Draft | null>(null);
	let toast = $state<string | null>(null);

	async function saved(msg: string) {
		editing = null;
		toast = msg;
		await invalidateAll();
		setTimeout(() => (toast = null), 4000);
	}
	async function toggle(r: (typeof data.rules)[number]) {
		const rule = { ...draftToRule(draftFromRule(r)), enabled: r.enabled ? 0 : 1 };
		await fetch('/api/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'save', rule }) });
		await invalidateAll();
	}
</script>

<svelte:head><title>Rules · Spendless</title></svelte:head>

<div class="bar">
	<h1>Rules</h1>
	<button class="btn primary" onclick={() => (editing = blankDraft())}>New rule</button>
</div>
<p class="lede">
	Rules recategorize transactions as they arrive, and re-run over your whole history whenever a rule changes.
	When several rules match, the more specific one wins (more conditions), then the newer one. A category you set by hand on a single transaction always wins.
	You can also start a rule from any transaction with the » button.
</p>

{#if toast}<p class="note" role="status">{toast}</p>{/if}

{#if data.rules.length}
	<table class="data">
		<thead><tr><th class="r">Order</th><th>When</th><th>Then</th><th class="r">Matches</th><th>On</th><th></th></tr></thead>
		<tbody>
			{#each data.rules as r (r.id)}
				<tr class:off={!r.enabled}>
					<td class="r num muted">{r.order}</td>
					<td>{#each r.when as w, i}{#if i}<span class="and">and</span>{/if}<span class="chip">{w}</span>{/each}</td>
					<td>
						{#if r.set_category}<b>{r.set_category}</b>{/if}
						{#if r.set_merchant}<span class="muted">{r.set_category ? ', ' : ''}rename to “{r.set_merchant}”</span>{/if}
						{#if r.recurring_kind}<div class="muted">Tracked as a {r.recurring_cadence} {({ obligation: 'fixed obligation', bill: 'bill', subscription: 'subscription' })[r.recurring_kind]}</div>{/if}
					</td>
					<td class="r num"><a href="/transactions?source=rule">{r.matches}</a></td>
					<td><input type="checkbox" checked={!!r.enabled} onchange={() => toggle(r)} aria-label="Rule {r.order} enabled" /></td>
					<td class="r"><button class="btn" onclick={() => (editing = draftFromRule(r))}>Edit</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p class="empty">No rules yet. Open a transaction’s » button on the Transactions page to start one from a real example, or create one here.</p>
{/if}

{#if editing}
	<RuleEditor bind:draft={editing} categories={groups} accounts={data.accounts} onclose={() => (editing = null)} onsaved={saved} />
{/if}

<style>
	.bar { display: flex; align-items: center; gap: 16px; }
	h1 { font-size: 26px; letter-spacing: -0.025em; }
	.lede { color: var(--ink-2); max-width: 76ch; margin: 8px 0 18px; }
	.primary { background: var(--flex); color: #fff; border-color: var(--flex); }
	.note { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 12px; font-size: 13px; }
	.chip { display: inline-block; background: var(--wash); border-radius: 5px; padding: 1px 7px; margin: 2px 0; font-size: 12.5px; }
	.and { color: var(--ink-3); font-size: 12px; margin: 0 6px; }
	tr.off td { color: var(--ink-3); }
	.empty { color: var(--ink-2); padding: 24px 0; }
</style>
