<script lang="ts">
	import { goto } from '$app/navigation';
	import MonthlyBars from '#lib/components/MonthlyBars.svelte';
	import Spark from '#lib/components/Spark.svelte';
	import RangeCategories from '#lib/components/RangeCategories.svelte';
	import { rangeTotals } from '#lib/rangeTotals.ts';
	import SortTh from '#lib/components/SortTh.svelte';
	import { Sorter } from '#lib/sort.svelte.ts';
	import type { CategoryRow } from '#lib/server/queries.ts';
	import { money, monthLabel, pct, addMonths, dateShort } from '#lib/format.ts';

	let { data } = $props();
	const s = $derived(data.summary);
	const daysIn = $derived(new Date(Number(data.month.slice(0, 4)), Number(data.month.slice(5)), 0).getDate());
	// share of the month elapsed: used to set the "expected by today" mark on each category
	const pace = $derived(s.isCurrent ? s.dayOfMonth / daysIn : 1);
	const trendMonths = $derived(Array.from({ length: 13 }, (_, i) => addMonths(data.month, i - 12)));
	let showAll = $state(false);
	// chart range (reported by the slider); with rangeMode on, the page describes that range instead of one month
	let rangeFrom = $state('');
	let rangeTo = $state('');
	let rangeMode = $state(false);
	const partialMonth = $derived(data.bars[data.bars.length - 1].month === data.today.slice(0, 7) ? data.today.slice(0, 7) : null);
	const ranged = $derived(rangeMode && rangeFrom !== '');
	const r = $derived(rangeTotals(data.bars, rangeFrom, rangeTo));
	const perMo = (v: number) => money(v / Math.max(1, r.months));
	const rangeIncludesNow = $derived(partialMonth != null && rangeTo === partialMonth);
	const rangeTitle = $derived.by(() => {
		if (!rangeFrom) return '';
		const [a, b] = [monthLabel(rangeFrom, true), monthLabel(rangeTo, true)];
		return rangeFrom.slice(0, 4) === rangeTo.slice(0, 4) ? `${a.split(' ')[0]} – ${b}` : `${a} – ${b}`;
	});
	const rNet = $derived(r.recurring - r.spent);
	// fixed costs land once a month, so compare them to the full average, not to pace
	const expected = (c: CategoryRow) => (c.fixed ? c.avg : c.avg * pace);
	const catSort = new Sorter<CategoryRow>({
		category: { get: (c) => c.category },
		month: { get: (c) => c.month },
		// how far ahead of (or behind) the usual pace; categories with no history sort as most ahead
		vs: { get: (c) => (expected(c) > 0 ? c.month / expected(c) : c.month > 0 ? Infinity : null) },
		avg: { get: (c) => c.avg },
		total12: { get: (c) => c.total12 }
	});
	const sortedCats = $derived(catSort.apply(data.categories));
	const cats = $derived(showAll ? sortedCats : sortedCats.slice(0, 18));
	const mMax = $derived(Math.max(1, ...data.merchants.map((m) => m.total)));
	// picking a month on the chart leaves range mode and shows that month
	const go = (m: string) => {
		rangeMode = false;
		goto(m === data.latest ? '/' : `/?month=${m}`);
	};
	const vsPrev = $derived(s.prevSameDay ? s.spent / s.prevSameDay - 1 : 0);
	const vsAvgFlex = $derived(s.avg12Flexible ? s.flexible / (s.avg12Flexible * pace) - 1 : 0);
	const net = $derived(data.income.recurring - s.spent);
</script>

<svelte:head><title>{ranged ? rangeTitle : monthLabel(data.month, true)} · Spendless</title></svelte:head>

<section class="head">
	{#if ranged}
	<div class="monthnav">
		<h1>{rangeTitle}</h1>
		<span class="muted">{r.months} {r.months === 1 ? 'month' : 'months'}{rangeIncludesNow ? `, through ${dateShort(data.today)}` : ''}</span>
	</div>
	<dl class="figures" class:nw={data.netWorth}>
		<div class="spent">
			<div>
				<dt>Spent</dt>
				<dd class="big num">{money(r.spent)}</dd>
				<dd class="sub">{perMo(r.spent)}/mo avg</dd>
			</div>
			<div class="split">
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--flex)"></i>Flexible</span>
					<span class="val num">{money(r.flexible)}</span>
					<span class="note">{perMo(r.flexible)}/mo</span>
				</dd>
				<dd title="Housing, insurance, utilities, loans">
					<span class="lbl"><i class="sw" style="background:var(--fixed)"></i>Fixed</span>
					<span class="val num">{money(r.fixed)}</span>
					<span class="note">{perMo(r.fixed)}/mo · housing, insurance, utilities, loans</span>
				</dd>
			</div>
		</div>
		<div class="spent">
			<div>
				<dt>Income</dt>
				<dd class="big num">{money(r.income)}</dd>
				<dd class="sub">
					<span class={rNet < 0 ? 'up' : 'good'}>{rNet < 0 ? '−' : '+'}{money(Math.abs(rNet))}</span> recurring after spending
				</dd>
			</div>
			<div class="split">
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--income)"></i>Recurring</span>
					<span class="val num">{money(r.recurring)}</span>
					<span class="note">{perMo(r.recurring)}/mo · paychecks, rent</span>
				</dd>
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--other-in)"></i>Other</span>
					<span class="val num">{money(r.other)}</span>
					<span class="note">stock sales, refunds, one-offs</span>
				</dd>
			</div>
		</div>
		{#if data.netWorth}
			<div>
				<dt>Net worth</dt>
				<dd class="big num">{money(data.netWorth.cents)}</dd>
				<dd class="sub">across synced accounts</dd>
			</div>
		{/if}
	</dl>
	{:else}
	<div class="monthnav">
		<a class="arrow" href="/?month={addMonths(data.month, -1)}" aria-label="Previous month" data-sveltekit-noscroll>‹</a>
		<h1>{monthLabel(data.month, true)}</h1>
		{#if data.month < data.latest}
			<a class="arrow" href={addMonths(data.month, 1) === data.latest ? '/' : `/?month=${addMonths(data.month, 1)}`} aria-label="Next month" data-sveltekit-noscroll>›</a>
		{:else}<span class="arrow off">›</span>{/if}
		{#if s.isCurrent}<span class="muted">through {dateShort(data.today)}</span>{/if}
	</div>

	<dl class="figures" class:nw={data.netWorth}>
		<div class="spent">
			<div>
				<dt>Spent{s.isCurrent ? ' so far' : ''}</dt>
				<dd class="big num">{money(s.spent)}</dd>
				<dd class="sub">
					{#if s.prevSameDay}
						<span class={vsPrev > 0.05 ? 'up' : vsPrev < -0.05 ? 'good' : ''}>{pct(vsPrev)}</span>
						vs {money(s.prevSameDay)} {s.isCurrent ? `by ${dateShort(data.today).split(' ')[1]} ${monthLabel(addMonths(data.month, -1)).split(' ')[0]}` : 'last month'}
					{/if}
				</dd>
			</div>
			<!-- the two parts of Spent -->
			<div class="split">
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--flex)"></i>Flexible</span>
					<span class="val num">{money(s.flexible)}</span>
					<span class="note">
						<span class={vsAvgFlex > 0.1 ? 'up' : vsAvgFlex < -0.1 ? 'good' : ''}>{pct(vsAvgFlex)}</span> vs usual pace ({money(s.avg12Flexible)}/mo)
					</span>
				</dd>
				<dd title="Housing, insurance, utilities, loans">
					<span class="lbl"><i class="sw" style="background:var(--fixed)"></i>Fixed</span>
					<span class="val num">{money(s.fixed)}</span>
					<span class="note">housing, insurance, utilities, loans</span>
				</dd>
			</div>
		</div>
		<div class="spent">
			<div>
				<dt>Income{s.isCurrent ? ' so far' : ''}</dt>
				<dd class="big num">{money(data.income.recurring + data.income.other)}</dd>
				<dd class="sub">
					<span class={net < 0 ? 'up' : 'good'}>{net < 0 ? '−' : '+'}{money(Math.abs(net))}</span> recurring after spending
				</dd>
			</div>
			<div class="split">
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--income)"></i>Recurring</span>
					<span class="val num">{money(data.income.recurring)}</span>
					<span class="note">{money(data.income.avg12)}/mo avg · paychecks, rent</span>
				</dd>
				<dd>
					<span class="lbl"><i class="sw" style="background:var(--other-in)"></i>Other</span>
					<span class="val num">{money(data.income.other)}</span>
					<span class="note">stock sales, refunds, one-offs</span>
				</dd>
			</div>
		</div>
		{#if data.netWorth}
			<div>
				<dt>Net worth</dt>
				<dd class="big num">{money(data.netWorth.cents)}</dd>
				<dd class="sub">across synced accounts</dd>
			</div>
		{/if}
	</dl>
	{/if}
</section>

<section class="chart">
	<MonthlyBars data={data.bars} selected={ranged ? '' : data.month} partial={partialMonth != null} onselect={go}
		bind:from={rangeFrom} bind:to={rangeTo} bind:rangeMode />
</section>

<div class="cols">
	<section>
		<div class="sechead">
			<h2>Where it went</h2>
			{#if ranged}
			<span class="key muted">
				<span><i class="sw" style="background:var(--flex)"></i>Flexible</span>
				<span><i class="sw" style="background:var(--fixed)"></i>Fixed</span>
				<span>{monthLabel(rangeFrom)} – {monthLabel(rangeTo)}</span>
			</span>
			{:else}
			<span class="key muted">
				<span><i class="sw" style="background:var(--flex)"></i>{s.isCurrent ? 'Spent so far' : 'Spent'}</span>
				<span><i class="sw" style="background:var(--up-mark)"></i>Over 15% ahead of usual</span>
				<span><i class="tk"></i>{s.isCurrent ? 'Where you’d usually be by today' : '12-month average'}</span>
			</span>
			{/if}
		</div>
		{#if ranged}
		<RangeCategories categoryMonths={data.categoryMonths} from={rangeFrom} to={rangeTo} months={r.months} spent={r.spent} />
		{:else}
		<table class="data">
			<thead>
				<tr>
					<SortTh sorter={catSort} key="category" rows={data.categories}>Category</SortTh>
					<SortTh sorter={catSort} key="month" rows={data.categories} right>{monthLabel(data.month)}</SortTh>
					<SortTh sorter={catSort} key="vs" rows={data.categories}>vs usual</SortTh>
					<SortTh sorter={catSort} key="avg" rows={data.categories} right>Avg / mo</SortTh>
					<th>13 months</th>
					<SortTh sorter={catSort} key="total12" rows={data.categories} right>Last 12 mo</SortTh>
				</tr>
			</thead>
			<tbody>
				{#each cats as c}
					{@const expect = expected(c)}
					{@const scale = Math.max(c.month, expect, 1) * 1.08}
					<tr>
						<td>
							<a class="cat" href="/transactions?category={encodeURIComponent(c.category)}&month={data.month}">{c.category}</a>
							<span class="grp">{c.group}</span>
						</td>
						<td class="r num">{c.month ? money(c.month) : '—'}</td>
						<td class="bulletcell">
							<span class="bullet" title="{money(c.month)} vs {money(expect)} expected">
								<span class="fill" class:fixed={c.fixed} class:over={c.month > expect * 1.15 && !c.fixed} style="width:{(Math.max(0, c.month) / scale) * 100}%"></span>
								{#if expect > 0}<span class="mark" style="left:{(expect / scale) * 100}%"></span>{/if}
							</span>
						</td>
						<td class="r num ink2">{money(c.avg)}</td>
						<td><Spark values={c.trend} months={trendMonths} /></td>
						<td class="r num">{money(c.total12)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if data.categories.length > 18}
			<button class="btn more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${data.categories.length} categories`}</button>
		{/if}
		{/if}
	</section>

	<section>
		<div class="sechead"><h2>Top merchants</h2><span class="muted">flexible spending, last 90 days</span></div>
		<ol class="merchants">
			{#each data.merchants as m}
				<li>
					<a href="/transactions?q={encodeURIComponent(m.merchant)}">
						<span class="mname">{m.merchant}</span>
						<span class="mval num">{money(m.total)}</span>
						<span class="mbar"><span style="width:{(m.total / mMax) * 100}%"></span></span>
						<span class="mmeta muted">{m.n} {m.n === 1 ? 'charge' : 'charges'}, {m.category}</span>
					</a>
				</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.head { margin-bottom: 20px; }
	.monthnav { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; }
	h1 { font-size: 26px; letter-spacing: -0.025em; font-weight: 600; }
	.arrow { text-decoration: none; font-size: 22px; color: var(--ink-2); padding: 0 6px; border-radius: 6px; line-height: 1; }
	.arrow:hover { background: var(--wash); }
	.arrow.off { color: var(--grid); }

	.figures { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); margin: 0; border-top: 1px solid var(--rule); }
	.figures.nw { grid-template-columns: minmax(0, 1.9fr) minmax(0, 1.9fr) minmax(0, 1fr); }
	.spent { display: flex; gap: 24px; align-items: flex-start; }
	.split { display: grid; gap: 6px; padding-top: 2px; min-width: 0; }
	.split dd { display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 10px; }
	.split .lbl { font-size: 12.5px; color: var(--ink-2); display: inline-flex; align-items: center; gap: 6px; }
	.split .val { font-size: 16px; font-weight: 550; letter-spacing: -0.01em; text-align: right; }
	.split .note { grid-column: 1 / -1; font-size: 12px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.figures > div { padding: 12px 20px 4px 0; }
	.figures > div + div { padding-left: 20px; border-left: 1px solid var(--grid); }
	dt { font-size: 12.5px; color: var(--ink-2); display: flex; align-items: center; gap: 6px; }
	dd { margin: 0; }
	.big { font-size: 28px; font-weight: 550; letter-spacing: -0.025em; line-height: 1.15; margin-top: 2px; }
	.sub { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
	.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

	.chart { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 16px 18px 10px; margin-bottom: 28px; }

	.cols { display: grid; grid-template-columns: minmax(0, 2.1fr) minmax(280px, 1fr); gap: 40px; }
	.sechead { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
	.sechead .muted { font-size: 12.5px; }
	.key { display: inline-flex; flex-wrap: wrap; gap: 4px 14px; }
	.key span { display: inline-flex; align-items: center; gap: 5px; }
	.tk { display: inline-block; width: 2px; height: 12px; background: var(--ink); border-radius: 1px; }
	.cat { text-decoration: none; font-weight: 500; }
	.cat:hover { text-decoration: underline; }
	.grp { color: var(--ink-3); font-size: 12px; margin-left: 6px; }
	.bulletcell { width: 22%; min-width: 120px; }
	.bullet { position: relative; display: block; height: 10px; background: var(--wash); border-radius: 2px; }
	.bullet .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--flex); border-radius: 0 3px 3px 0; max-width: 100%; }
	.bullet .fill.fixed { background: var(--fixed); }
	.bullet .fill.over { background: var(--up-mark); }
	.bullet .mark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--ink); border-radius: 1px; }
	.more { margin-top: 10px; }

	.merchants { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
	.merchants li { border-bottom: 1px solid var(--grid); }
	.merchants a { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 7px 0; text-decoration: none; }
	.merchants a:hover { background: var(--wash); }
	.mname { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mbar { grid-column: 1 / -1; height: 4px; background: transparent; }
	.mbar span { display: block; height: 4px; background: var(--flex); border-radius: 0 2px 2px 0; }
	.mmeta { grid-column: 1 / -1; font-size: 12px; }

	@media (max-width: 1100px) {
		.figures, .figures.nw { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.figures > div:nth-child(3) { border-left: 0; padding-left: 0; }
		.cols { grid-template-columns: 1fr; }
	}
	@media (max-width: 640px) {
		.figures, .figures.nw { grid-template-columns: minmax(0, 1fr); }
		.figures > div { border-left: 0 !important; padding-left: 0 !important; }
		table.data th:nth-child(4), table.data td:nth-child(4), table.data th:nth-child(5), table.data td:nth-child(5) { display: none; }
	}
</style>
