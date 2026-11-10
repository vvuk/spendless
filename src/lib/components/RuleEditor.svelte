<script lang="ts">
	import { tick } from 'svelte';
	import { draftToRule, type Draft } from '#lib/ruleDraft.ts';
	import { money2, dateShort } from '#lib/format.ts';

	let {
		draft = $bindable(),
		categories,
		accounts,
		onclose,
		onsaved
	}: {
		draft: Draft;
		categories: [string, string[]][];
		accounts: string[];
		onclose: () => void;
		onsaved: (msg: string) => void;
	} = $props();

	type Row = { id: string; date: string; merchant: string | null; statement: string | null; account: string; amount_cents: number; current: string; next: string; outcome: 'change' | 'same' | 'manual' | 'other_rule'; other_rule?: number };
	let preview = $state<{ counts: Record<string, number>; rows: Row[] } | null>(null);
	let problem = $state<string | null>(null);
	let saving = $state(false);
	let panel: HTMLElement;

	const ruleJson = $derived(JSON.stringify(draftToRule(draft)));

	async function api(op: string) {
		const res = await fetch('/api/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, rule: JSON.parse(ruleJson) }) });
		return res.json();
	}

	let timer: ReturnType<typeof setTimeout>;
	let seq = 0;
	$effect(() => {
		ruleJson; // re-run on any change
		clearTimeout(timer);
		const mine = ++seq;
		timer = setTimeout(async () => {
			const r = await api('preview');
			if (mine !== seq) return;
			problem = r.problem ?? null;
			preview = r.problem ? null : r;
		}, 220);
	});

	async function save() {
		saving = true;
		const r = await api('save');
		saving = false;
		if (r.problem) { problem = r.problem; return; }
		const n = preview?.counts.change ?? 0;
		onsaved(draft.id ? `Rule updated. ${n} transaction${n === 1 ? '' : 's'} changed.` : `Rule saved. ${n} transaction${n === 1 ? '' : 's'} changed.`);
	}
	async function remove() {
		if (!draft.id) return;
		await api('delete');
		onsaved('Rule deleted.');
	}

	$effect(() => {
		tick().then(() => panel?.querySelector<HTMLElement>('input:not([type=checkbox]), select')?.focus());
	});

	const OUTCOME: Record<Row['outcome'], string> = { change: '', same: 'already', manual: 'your edit wins', other_rule: 'another rule wins' };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" onclick={onclose} role="presentation"></div>
<aside class="panel" bind:this={panel} aria-label={draft.id ? 'Edit rule' : 'New rule'}>
	<header>
		<h2>{draft.id ? 'Edit rule' : 'New rule'}</h2>
		<button class="x" onclick={onclose} aria-label="Close">×</button>
	</header>

	<div class="body">
		<p class="hint">Rules look at what Monarch reported. Turn on the conditions that pin down the transactions you mean.</p>

		<fieldset>
			<legend>When a transaction</legend>

			<label class="cond" class:off={!draft.merchant.on}>
				<input type="checkbox" bind:checked={draft.merchant.on} />
				<span class="lab">Merchant</span>
				<select bind:value={draft.merchant.op} disabled={!draft.merchant.on}>
					<option value="is">is</option><option value="contains">contains</option><option value="regex">matches regex</option>
				</select>
				<input type="text" bind:value={draft.merchant.value} disabled={!draft.merchant.on} />
			</label>

			<label class="cond" class:off={!draft.statement.on}>
				<input type="checkbox" bind:checked={draft.statement.on} />
				<span class="lab">Statement</span>
				<select bind:value={draft.statement.op} disabled={!draft.statement.on}>
					<option value="contains">contains</option><option value="is">is</option><option value="regex">matches regex</option>
				</select>
				<input type="text" bind:value={draft.statement.value} disabled={!draft.statement.on} placeholder="bank description text" />
			</label>

			<label class="cond" class:off={!draft.amount.on}>
				<input type="checkbox" bind:checked={draft.amount.on} />
				<span class="lab">Amount</span>
				<select bind:value={draft.amount.mode} disabled={!draft.amount.on}>
					<option value="exactly">exactly</option><option value="between">between</option>
					<option value="atleast">at least</option><option value="atmost">at most</option>
				</select>
				<span class="amts">
					<span class="money"><span>$</span><input type="text" inputmode="decimal" bind:value={draft.amount.a} disabled={!draft.amount.on} /></span>
					{#if draft.amount.mode === 'between'}
						<span class="and">and</span>
						<span class="money"><span>$</span><input type="text" inputmode="decimal" bind:value={draft.amount.b} disabled={!draft.amount.on} /></span>
					{/if}
				</span>
			</label>

			<label class="cond" class:off={!draft.direction.on}>
				<input type="checkbox" bind:checked={draft.direction.on} />
				<span class="lab">Direction</span>
				<select class="wide" bind:value={draft.direction.value} disabled={!draft.direction.on}>
					<option value="out">Money out (charges, payments)</option><option value="in">Money in (refunds, deposits)</option>
				</select>
			</label>

			<label class="cond" class:off={!draft.account.on}>
				<input type="checkbox" bind:checked={draft.account.on} />
				<span class="lab">Account</span>
				<select class="wide" bind:value={draft.account.value} disabled={!draft.account.on}>
					<option value="" disabled>Choose an account</option>
					{#each accounts as a}<option value={a}>{a}</option>{/each}
				</select>
			</label>

			<label class="cond" class:off={!draft.monarch.on}>
				<input type="checkbox" bind:checked={draft.monarch.on} />
				<span class="lab">Monarch said</span>
				<select class="wide" bind:value={draft.monarch.value} disabled={!draft.monarch.on}>
					<option value="" disabled>Choose a category</option>
					{#each categories as [g, cs]}<optgroup label={g}>{#each cs as c}<option value={c}>{c}</option>{/each}</optgroup>{/each}
				</select>
			</label>

			<label class="cond" class:off={!draft.dates.on}>
				<input type="checkbox" bind:checked={draft.dates.on} />
				<span class="lab">Dates</span>
				<span class="amts span">
					<input type="date" bind:value={draft.dates.from} disabled={!draft.dates.on} aria-label="From" />
					<span class="and">to</span>
					<input type="date" bind:value={draft.dates.to} disabled={!draft.dates.on} aria-label="To" />
				</span>
			</label>
		</fieldset>

		<fieldset>
			<legend>Then</legend>
			<label class="cond">
				<span></span><span class="lab">Category</span>
				<select class="wide" bind:value={draft.set_category}>
					<option value="">Leave as is</option>
					{#each categories as [g, cs]}<optgroup label={g}>{#each cs as c}<option value={c}>{c}</option>{/each}</optgroup>{/each}
				</select>
			</label>
			<label class="cond">
				<span></span><span class="lab">Rename to</span>
				<input class="wide" type="text" bind:value={draft.set_merchant} placeholder="optional, e.g. Landlord" />
			</label>
			<label class="cond" class:off={!draft.recurring.on}>
				<input type="checkbox" bind:checked={draft.recurring.on} />
				<span class="lab">Recurring</span>
				<select bind:value={draft.recurring.kind} disabled={!draft.recurring.on} aria-label="Recurring type">
					<option value="obligation">Fixed obligation</option><option value="bill">Bill</option><option value="subscription">Subscription</option>
				</select>
				<select bind:value={draft.recurring.cadence} disabled={!draft.recurring.on} aria-label="Billed">
					<option value="weekly">weekly</option><option value="biweekly">every 2 weeks</option><option value="monthly">monthly</option>
					<option value="quarterly">quarterly</option><option value="semiannual">every 6 months</option><option value="annual">yearly</option>
				</select>
			</label>
			{#if draft.recurring.on}<p class="sub-hint">Everything this rule matches shows on the Recurring page as one series, even if it hasn’t repeated enough to be detected.</p>{/if}
		</fieldset>

		<section class="preview" aria-live="polite">
			{#if problem}
				<p class="problem">{problem}</p>
			{:else if preview}
				<p class="summary">
					{#if preview.counts.total === 0}
						Matches no transactions yet.
					{:else}
						Matches <b>{preview.counts.total}</b>
						{preview.counts.total === 1 ? 'transaction' : 'transactions'}{#if draft.set_category && draft.set_category !== '(preview)'}: <b>{preview.counts.change}</b> will change{/if}{#if preview.counts.same}, {preview.counts.same} already {draft.set_category}{/if}{#if preview.counts.manual}, {preview.counts.manual} keep your own edit{/if}{#if preview.counts.other_rule}, {preview.counts.other_rule} taken by an earlier rule{/if}.
					{/if}
				</p>
				<ul>
					{#each preview.rows as r (r.id)}
						<li class:muted={r.outcome !== 'change'}>
							<span class="d num">{dateShort(r.date)} <span class="y">{r.date.slice(2, 4)}</span></span>
							<span class="who">{r.merchant ?? r.statement}<small>{r.account.replace(/\s*\(\.\.\.(\w+)\)/, ' ··$1')}</small></span>
							<span class="amt num">{money2(r.amount_cents)}</span>
							<span class="out">
								{#if r.outcome === 'change'}{r.current} <span class="arrow">→</span> <b>{r.next}</b>{:else}{r.current}<small>{OUTCOME[r.outcome]}</small>{/if}
							</span>
						</li>
					{/each}
				</ul>
				{#if preview.counts.total > preview.rows.length}<p class="more muted">and {preview.counts.total - preview.rows.length} more</p>{/if}
			{/if}
		</section>
	</div>

	<footer>
		{#if draft.id}<button class="btn danger" onclick={remove}>Delete rule</button>{/if}
		<span class="grow"></span>
		<button class="btn" onclick={onclose}>Cancel</button>
		<button class="btn primary" onclick={save} disabled={saving || !!problem}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save rule'}</button>
	</footer>
</aside>

<style>
	.scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.18); z-index: 40; }
	.panel {
		position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); z-index: 41;
		background: var(--surface); border-left: 1px solid var(--rule); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.12);
		display: flex; flex-direction: column;
	}
	header { display: flex; align-items: center; padding: 16px 20px 8px; }
	header h2 { font-size: 18px; }
	.x { margin-left: auto; border: 0; background: none; font-size: 22px; cursor: pointer; color: var(--ink-2); line-height: 1; padding: 2px 8px; border-radius: 6px; }
	.x:hover { background: var(--wash); }
	.body { overflow: auto; padding: 0 20px 16px; flex: 1; }
	.hint { color: var(--ink-2); font-size: 13px; margin: 0 0 12px; }
	fieldset { border: 0; padding: 0; margin: 0 0 14px; }
	legend { font-weight: 600; font-size: 13px; margin-bottom: 4px; padding: 0; }
	.cond { display: grid; grid-template-columns: 18px 96px 128px 1fr; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
	.cond.off .lab { color: var(--ink-3); }
	.cond .wide { grid-column: 3 / -1; }
	.cond .amts { display: flex; align-items: center; gap: 6px; min-width: 0; }
	.cond input[type='text'], .cond input[type='date'], .cond select {
		border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); padding: 4px 7px; font-size: 13px; min-width: 0; width: 100%;
	}
	.cond input:disabled, .cond select:disabled { opacity: 0.45; }
	.cond .amts.span { grid-column: 3 / -1; }
	.cond .amts.span input { flex: 1; }
	.money { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; }
	.money span { color: var(--ink-3); }
	.and { color: var(--ink-3); }
	.sub-hint { font-size: 12px; color: var(--ink-3); margin: 2px 0 0 114px; }
	.preview { border-top: 1px solid var(--rule); padding-top: 12px; }
	.summary { margin: 0 0 8px; font-size: 13px; }
	.problem { color: var(--up); font-size: 13px; margin: 0; }
	.preview ul { list-style: none; margin: 0; padding: 0; font-size: 12.5px; }
	.preview li { display: grid; grid-template-columns: 62px 1fr auto; gap: 2px 10px; padding: 5px 0; border-bottom: 1px solid var(--grid); }
	.preview li.muted { color: var(--ink-3); }
	.d { color: var(--ink-3); }
	.y { font-size: 11px; }
	.who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.who small, .out small { display: block; color: var(--ink-3); font-size: 11.5px; }
	.out small { display: inline; margin-left: 6px; }
	.amt { text-align: right; }
	.out { grid-column: 2 / -1; }
	.arrow { color: var(--flex); }
	.more { font-size: 12.5px; }
	footer { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--rule); align-items: center; }
	.grow { flex: 1; }
	.primary { background: var(--flex); color: #fff; border-color: var(--flex); }
	.primary:hover { background: var(--flex); filter: brightness(1.08); }
	.danger { color: var(--up); }
	@media (max-width: 560px) {
		.cond { grid-template-columns: 18px 1fr; }
		.cond > :nth-child(n + 3) { grid-column: 2; }
	}
</style>
