<script lang="ts">
	import { FIXED_CATEGORIES } from '#lib/categories-shared.ts';
	import { money } from '#lib/format.ts';
	import { Sorter } from '#lib/sort.svelte.ts';
	import SortTh from './SortTh.svelte';

	/** "Where it went" for a range of months: each category's total, monthly average and share of spending. */
	interface CatMonth { category: string; grp: string; month: string; s: number }
	interface Cat { category: string; group: string; fixed: boolean; total: number; avg: number; share: number }

	let { categoryMonths, from, to, months, spent }: { categoryMonths: CatMonth[]; from: string; to: string; months: number; spent: number } = $props();

	const cats = $derived.by(() => {
		const by = new Map<string, Cat>();
		for (const r of categoryMonths) {
			if (r.month < from || r.month > to) continue;
			const c = by.get(r.category) ?? by.set(r.category, { category: r.category, group: r.grp, fixed: FIXED_CATEGORIES.includes(r.category), total: 0, avg: 0, share: 0 }).get(r.category)!;
			c.total += r.s;
		}
		const list = [...by.values()].filter((c) => c.total !== 0);
		for (const c of list) {
			c.avg = c.total / Math.max(1, months);
			c.share = spent > 0 ? c.total / spent : 0;
		}
		return list.sort((a, b) => b.total - a.total);
	});
	const sorter = new Sorter<Cat>({
		category: { get: (c) => c.category },
		total: { get: (c) => c.total },
		avg: { get: (c) => c.avg },
		share: { get: (c) => c.share }
	});
	let showAll = $state(false);
	const sorted = $derived(sorter.apply(cats));
	const shown = $derived(showAll ? sorted : sorted.slice(0, 18));
	const maxShare = $derived(Math.max(0.0001, ...cats.map((c) => c.share)));
</script>

<table class="data">
	<thead>
		<tr>
			<SortTh {sorter} key="category" rows={cats}>Category</SortTh>
			<SortTh {sorter} key="total" rows={cats} right>Spent</SortTh>
			<SortTh {sorter} key="avg" rows={cats} right>Avg / mo</SortTh>
			<SortTh {sorter} key="share" rows={cats}>Share of spending</SortTh>
		</tr>
	</thead>
	<tbody>
		{#each shown as c (c.category)}
			<tr>
				<td>
					<a class="cat" href="/transactions?category={encodeURIComponent(c.category)}">{c.category}</a>
					<span class="grp">{c.group}</span>
				</td>
				<td class="r num">{money(c.total)}</td>
				<td class="r num ink2">{money(c.avg)}</td>
				<td class="sharecell">
					<span class="bar"><span class:fixed={c.fixed} style="width:{(Math.max(0, c.share) / maxShare) * 100}%"></span></span>
					<span class="pct num">{Math.round(c.share * 100)}%</span>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
{#if cats.length > 18}
	<button class="btn more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${cats.length} categories`}</button>
{/if}

<style>
	.cat { text-decoration: none; font-weight: 500; }
	.cat:hover { text-decoration: underline; }
	.grp { color: var(--ink-3); font-size: 12px; margin-left: 6px; }
	.sharecell { width: 36%; white-space: nowrap; }
	.bar { display: inline-block; vertical-align: middle; width: calc(100% - 44px); height: 10px; background: var(--wash); border-radius: 2px; }
	.bar span { display: block; height: 100%; background: var(--flex); border-radius: 0 3px 3px 0; }
	.bar span.fixed { background: var(--fixed); }
	.pct { display: inline-block; width: 38px; text-align: right; color: var(--ink-2); font-size: 12.5px; }
	.more { margin-top: 10px; }
</style>
