<script lang="ts">
	import { enhance } from '$app/forms';
	const stay = () => async ({ update }: { update: (o?: { reset?: boolean; navigate?: boolean }) => Promise<void> }) =>
		update({ reset: false, navigate: false });
	const KIND_OPTS = [
		{ v: 'subscription', l: 'Subscription' },
		{ v: 'bill', l: 'Bill' },
		{ v: 'obligation', l: 'Fixed obligation' }
	];
	import BeatStrip from '#lib/components/BeatStrip.svelte';
	import SortTh from '#lib/components/SortTh.svelte';
	import { Sorter } from '#lib/sort.svelte.ts';
	import { money, money2, dateShort, dateLabel, cadenceLabel } from '#lib/format.ts';

	let { data } = $props();
	type S = (typeof data.series)[number];

	const DAY = 86_400_000;
	const ago = (d: string, n: number) => new Date(Date.parse(d) - n * DAY).toISOString().slice(0, 10);
	const yearAgo = $derived(ago(data.today, 365));
	const in30 = $derived(ago(data.today, -30));

	const live = $derived(data.series.filter((s) => s.status !== 'stopped' && s.mark !== 'cancelled'));
	const stopped = $derived(
		data.series.filter((s) => (s.status === 'stopped' || s.mark === 'cancelled') && s.lastDate >= ago(data.today, 540))
	);

	const tabs = [
		{ id: 'subscription', label: 'Subscriptions' },
		{ id: 'bill', label: 'Bills' },
		{ id: 'obligation', label: 'Fixed obligations' },
		{ id: 'all', label: 'All' }
	] as const;
	let tab = $state<(typeof tabs)[number]['id']>('subscription');
	const shown = $derived(live.filter((s) => tab === 'all' || s.kind === tab || (tab === 'subscription' && s.kind === 'other')));
	const totalOf = (xs: S[]) => xs.reduce((a, s) => a + s.annualCents, 0);

	const recentIncrease = (s: S) => s.priceChanges.filter((p) => p.toCents > p.fromCents && p.date >= yearAgo).at(-1);
	const increases = $derived(live.filter((s) => recentIncrease(s)));
	const increaseCost = $derived(
		increases.reduce((a, s) => {
			const p = recentIncrease(s)!;
			return a + ((p.toCents - p.fromCents) * 365.25) / s.cadenceDays;
		}, 0)
	);
	const upcoming = $derived(
		live.filter((s) => s.cadenceDays >= 90 && s.nextDate <= in30).sort((a, b) => a.nextDate.localeCompare(b.nextDate))
	);
	const dupes = $derived.by(() => {
		const by = new Map<string, S[]>();
		for (const s of live) if (s.siblings) (by.get(s.merchantKey) ?? by.set(s.merchantKey, []).get(s.merchantKey)!).push(s);
		return [...by.values()].filter((g) => g.length > 1);
	});
	const late = $derived(live.filter((s) => s.status === 'late'));
	const planned = $derived(live.filter((s) => s.mark === 'cancel'));
	const stoppedSaving = $derived(stopped.filter((s) => s.lastDate >= yearAgo && (s.kind === 'subscription' || s.kind === 'other')).reduce((a, s) => a + (s.currentCents * 365.25) / s.cadenceDays, 0));

	const acct = (a: string) => {
		const last4 = a.match(/\(\.\.\.(\w+)\)/)?.[1];
		const name = a.replace(/\s*\(.*\)/, '').replace(/®/g, '');
		return /^credit card$/i.test(name) && last4 ? `card ··${last4}` : last4 ? `${name} ··${last4}` : name;
	};
	const per = (s: S) => ({ weekly: '/wk', biweekly: '/2 wk', monthly: '/mo', quarterly: '/qtr', semiannual: '/6 mo', annual: '/yr' })[s.cadence];
	const priceFmt = (s: S) => (s.variable ? `~${money(s.currentCents)}` : money2(s.currentCents));
	const MARKS = [
		{ v: '', l: 'No decision' },
		{ v: 'keep', l: 'Keep' },
		{ v: 'cancel', l: 'Cancel this' },
		{ v: 'cancelled', l: 'Already cancelled' },
		{ v: 'not_recurring', l: 'Not recurring' }
	];

	const liveSort = new Sorter<S>({
		merchant: { get: (s) => s.merchant },
		billed: { get: (s) => s.cadenceDays, first: 'asc' },
		kind: { get: (s) => KIND_OPTS.find((k) => k.v === s.kind)?.l ?? 'Other' },
		price: { get: (s) => s.currentCents },
		annual: { get: (s) => s.annualCents },
		next: { get: (s) => s.nextDate },
		// undecided rows sink to the bottom
		mark: { get: (s) => (s.mark ? MARKS.find((m) => m.v === s.mark)?.l : null) }
	});
	const shownSorted = $derived(liveSort.apply(shown));
	const stoppedSort = new Sorter<S>({
		merchant: { get: (s) => s.merchant },
		billed: { get: (s) => s.cadenceDays, first: 'asc' },
		price: { get: (s) => s.currentCents },
		annual: { get: (s) => (s.currentCents * 365.25) / s.cadenceDays },
		last: { get: (s) => s.lastDate, first: 'desc' }
	});
	const stoppedSorted = $derived(stoppedSort.apply(stopped));
</script>

<svelte:head><title>Recurring · Spendless</title></svelte:head>

<h1>Recurring charges</h1>
<p class="lede">Found by reading your transaction history for charges that repeat on a regular beat. Each strip shows the last two years; a taller tick means a higher price.</p>

<dl class="figures">
	<div>
		<dt>Subscriptions</dt>
		<dd class="big num">{money(totalOf(live.filter((s) => s.kind === 'subscription' || s.kind === 'other')))}<span class="unit">/yr</span></dd>
		<dd class="sub">{live.filter((s) => s.kind === 'subscription' || s.kind === 'other').length} active</dd>
	</div>
	<div>
		<dt>Bills and fixed obligations</dt>
		<dd class="big num">{money(totalOf(live.filter((s) => s.kind === 'bill' || s.kind === 'obligation')))}<span class="unit">/yr</span></dd>
		<dd class="sub">{live.filter((s) => s.kind === 'bill' || s.kind === 'obligation').length} active</dd>
	</div>
	<div>
		<dt>Price increases, last 12 months</dt>
		<dd class="big num up">+{money(increaseCost)}<span class="unit">/yr</span></dd>
		<dd class="sub">across {increases.length} {increases.length === 1 ? 'charge' : 'charges'}</dd>
	</div>
	<div>
		<dt>Marked to cancel</dt>
		<dd class="big num">{money(totalOf(planned))}<span class="unit">/yr</span></dd>
		<dd class="sub">{planned.length ? `${planned.length} to cancel` : 'Use “Your call” to plan cuts'}</dd>
	</div>
	<div>
		<dt>Stopped in the last year</dt>
		<dd class="big num good">{money(stoppedSaving)}<span class="unit">/yr</span></dd>
		<dd class="sub">subscriptions no longer charged</dd>
	</div>
</dl>

{#if increases.length || dupes.length || upcoming.length || late.length}
	<section class="look">
		<h2>Worth a look</h2>
		<ul>
			{#each dupes as g}
				<li>
					<span class="tag">Overlap</span>
					{g.length} {g[0].merchant} plans billed {cadenceLabel[g[0].cadence].toLowerCase()}: {g.map((s) => `${money2(s.currentCents)}${per(s)} on ${acct(s.account)}`).join(' and ')}.
					Two accounts, or a plan you meant to replace?
				</li>
			{/each}
			{#each increases.sort((a, b) => recentIncrease(b)!.date.localeCompare(recentIncrease(a)!.date)) as s}
				{@const p = recentIncrease(s)!}
				<li>
					<span class="tag up">↑ Price up</span>
					{s.merchant} went from {money2(p.fromCents)} to {money2(p.toCents)}{per(s)} on {dateShort(p.date)}
					<span class="muted">(+{money(((p.toCents - p.fromCents) * 365.25) / s.cadenceDays)}/yr)</span>
				</li>
			{/each}
			{#each upcoming as s}
				<li>
					<span class="tag">Renews</span>
					{s.merchant} {s.nextDate < data.today ? 'was due' : 'renews around'} {dateShort(s.nextDate)} for {priceFmt(s)}
					<span class="muted">({cadenceLabel[s.cadence].toLowerCase()})</span>
				</li>
			{/each}
			{#each late as s}
				<li>
					<span class="tag">Missed</span>
					No {s.merchant} charge since {dateShort(s.lastDate)}; expected around {dateShort(s.nextDate)}. Cancelled, or billing elsewhere?
				</li>
			{/each}
		</ul>
	</section>
{/if}

<div class="tabs" role="tablist">
	{#each tabs as t}
		{@const n = live.filter((s) => t.id === 'all' || s.kind === t.id || (t.id === 'subscription' && s.kind === 'other')).length}
		<button role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>{t.label} <span class="muted num">{n}</span></button>
	{/each}
	<span class="tabsum muted">{money(totalOf(shown))}/yr</span>
</div>

<table class="data rec">
	<thead>
		<tr>
			<SortTh sorter={liveSort} key="merchant" rows={shown}>Merchant</SortTh>
			<SortTh sorter={liveSort} key="billed" rows={shown}>Billed</SortTh>
			<SortTh sorter={liveSort} key="kind" rows={shown}>Type</SortTh>
			<SortTh sorter={liveSort} key="price" rows={shown} right>Price</SortTh>
			<SortTh sorter={liveSort} key="annual" rows={shown} right>Per year</SortTh>
			<th>Last 24 months</th>
			<SortTh sorter={liveSort} key="next" rows={shown}>Next</SortTh>
			<SortTh sorter={liveSort} key="mark" rows={shown}>Your call</SortTh>
		</tr>
	</thead>
	<tbody>
		{#each shownSorted as s (s.key)}
			{@const inc = recentIncrease(s)}
			<tr class:planned={s.mark === 'cancel'}>
				<td>
					<a class="m" href="/transactions?q={encodeURIComponent(s.merchant)}">{s.merchant}</a>
					{#if s.siblings}<span class="tag">Overlap</span>{/if}
					<div class="meta">{s.category}, {acct(s.account)}</div>
				</td>
				<td class="ink2">{cadenceLabel[s.cadence]}{#if s.status === 'late'}<div class="meta up">Late</div>{/if}</td>
				<td>
					{#if s.ruleId}
					<a class="byrule" href="/rules" title="This series comes from a rule. Edit the rule to change its type.">{KIND_OPTS.find((k) => k.v === s.kind)?.l} (rule)</a>
					{:else}
					<form method="POST" action="?/kind" use:enhance={stay}>
						<input type="hidden" name="key" value={s.key} />
						<select class="kind" class:set={s.kindSet} name="kind" aria-label="Type of {s.merchant}"
							value={s.kindSet ? s.kind : ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							<option value="">{KIND_OPTS.find((k) => k.v === s.detectedKind)?.l ?? 'Other'} (auto)</option>
							{#each KIND_OPTS as k}<option value={k.v}>{k.l}</option>{/each}
						</select>
					</form>
					{/if}
				</td>
				<td class="r num">
					{priceFmt(s)}
					{#if inc}<div class="meta up">↑ from {money2(inc.fromCents)}</div>{:else if s.variable}<div class="meta">varies</div>{/if}
				</td>
				<td class="r num strong">{money(s.annualCents)}</td>
				<td>
					<BeatStrip charges={s.charges} nextDate={s.nextDate} today={data.today} increases={s.priceChanges.filter((p) => p.toCents > p.fromCents).map((p) => p.date)} />
				</td>
				<td class="ink2 num" title={dateLabel(s.nextDate)}>{dateShort(s.nextDate)}</td>
				<td>
					<form method="POST" action="?/mark" use:enhance={stay}>
						<input type="hidden" name="key" value={s.key} />
						<select name="status" aria-label="Decision for {s.merchant}" value={s.mark ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							{#each MARKS as m}<option value={m.v}>{m.l}</option>{/each}
						</select>
					</form>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

{#if stopped.length}
	<details class="stopped">
		<summary><h2>Stopped recently</h2> <span class="muted">{stopped.length} in the last 18 months</span></summary>
		<table class="data">
			<thead>
				<tr>
					<SortTh sorter={stoppedSort} key="merchant" rows={stopped}>Merchant</SortTh>
					<SortTh sorter={stoppedSort} key="billed" rows={stopped}>Billed</SortTh>
					<SortTh sorter={stoppedSort} key="price" rows={stopped} right>Last price</SortTh>
					<SortTh sorter={stoppedSort} key="annual" rows={stopped} right>Was per year</SortTh>
					<th>Last 24 months</th>
					<SortTh sorter={stoppedSort} key="last" rows={stopped}>Last charge</SortTh>
				</tr>
			</thead>
			<tbody>
				{#each stoppedSorted as s (s.key)}
					<tr>
						<td><a class="m" href="/transactions?q={encodeURIComponent(s.merchant)}">{s.merchant}</a><div class="meta">{s.category}</div></td>
						<td class="ink2">{cadenceLabel[s.cadence]}</td>
						<td class="r num">{priceFmt(s)}</td>
						<td class="r num">{money((s.currentCents * 365.25) / s.cadenceDays)}</td>
						<td><BeatStrip charges={s.charges} nextDate={s.nextDate} today={data.today} stopped /></td>
						<td class="ink2">{dateLabel(s.lastDate)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
{/if}

<style>
	h1 { font-size: 26px; letter-spacing: -0.025em; }
	.lede { color: var(--ink-2); margin: 6px 0 18px; max-width: 68ch; }
	.figures { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0 0 24px; border-top: 1px solid var(--rule); }
	.figures > div { padding: 12px 20px 4px 0; }
	.figures > div + div { padding-left: 20px; border-left: 1px solid var(--grid); }
	dt { font-size: 12.5px; color: var(--ink-2); }
	dd { margin: 0; }
	.big { font-size: 26px; font-weight: 550; letter-spacing: -0.025em; line-height: 1.2; margin-top: 2px; }
	.unit { font-size: 14px; color: var(--ink-3); font-weight: 450; margin-left: 2px; }
	.sub { font-size: 12.5px; color: var(--ink-3); }

	.look { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 18px; margin-bottom: 26px; }
	.look ul { list-style: none; padding: 0; margin: 8px 0 0; columns: 2 420px; column-gap: 40px; }
	.look li { padding: 5px 0; break-inside: avoid; border-bottom: 1px solid var(--grid); }
	.tag { display: inline-block; font-size: 11.5px; font-weight: 550; padding: 0 6px; border-radius: 4px; background: var(--wash); color: var(--ink-2); margin-right: 6px; line-height: 18px; }
	.tag.up { color: var(--up); }

	.tabs { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
	.tabs button { border: 0; background: none; padding: 8px 12px; cursor: pointer; color: var(--ink-2); border-bottom: 2px solid transparent; margin-bottom: -1px; }
	.tabs button[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--ink); font-weight: 550; }
	.tabsum { margin-left: auto; font-size: 13px; }

	.rec td { padding-top: 7px; padding-bottom: 7px; }
	.m { text-decoration: none; font-weight: 550; }
	.m:hover { text-decoration: underline; }
	.meta { font-size: 12px; color: var(--ink-3); }
	.meta.up { color: var(--up); }
	.strong { font-weight: 550; }
	tr.planned td { background: color-mix(in srgb, var(--up-mark) 9%, transparent); }
	.byrule { font-size: 12.5px; color: var(--ink); text-decoration: underline dotted; padding-left: 7px; }
	select.kind { border-color: transparent; background: transparent; color: var(--ink-2); }
	select.kind:hover, select.kind:focus { border-color: var(--rule); background: var(--surface); }
	select.kind.set { color: var(--ink); font-weight: 550; }
	select { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); padding: 3px 6px; font-size: 12.5px; }

	.stopped { margin-top: 32px; }
	.stopped summary { cursor: pointer; display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
	.stopped summary h2 { display: inline; }

	@media (max-width: 1100px) {
		.figures { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.figures > div:nth-child(4) { border-left: 0; padding-left: 0; }
	}
	@media (max-width: 760px) {
		.figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.figures > div { border-left: 0 !important; padding-left: 0 !important; }
		table.data th:nth-child(6), table.data td:nth-child(6), table.data th:nth-child(2), table.data td:nth-child(2), table.data th:nth-child(3), table.data td:nth-child(3) { display: none; }
	}
</style>
