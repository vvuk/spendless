<script lang="ts">
	import { money2, dateLabel } from '#lib/format.ts';
	/**
	 * A timeline of every charge in a recurring series over the last `months`.
	 * Tick height = price, so rhythm, price increases and gaps read at a glance.
	 */
	let {
		charges, nextDate, today, increases = [], months = 24, w = 260, h = 26, stopped = false
	}: {
		charges: { date: string; cents: number }[]; nextDate: string; today: string;
		increases?: string[]; months?: number; w?: number; h?: number; stopped?: boolean;
	} = $props();

	const DAY = 86_400_000;
	const end = $derived(Date.parse(today) + 45 * DAY);
	const start = $derived(end - (months * 30.44 + 45) * DAY);
	const xs = (d: string) => ((Date.parse(d) - start) / (end - start)) * (w - 4) + 2;
	const visible = $derived(charges.filter((c) => Date.parse(c.date) >= start));
	const max = $derived(Math.max(1, ...charges.map((c) => c.cents)));
	const th = (c: number) => 5 + (c / max) * (h - 8);
	const incSet = $derived(new Set(increases));
	let hover = $state<number | null>(null);
	const yearTicks = $derived.by(() => {
		const out: { x: number; label: string }[] = [];
		const y0 = new Date(start).getUTCFullYear();
		for (let y = y0 + 1; Date.UTC(y, 0, 1) < end; y++) out.push({ x: xs(`${y}-01-01`), label: String(y) });
		return out;
	});
</script>

<span class="beat">
	<svg width={w} height={h} role="img" aria-label="{visible.length} charges in the last {months} months">
		<line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} class="axis" />
		{#each yearTicks as t}<line x1={t.x} x2={t.x} y1={h - 6} y2={h} class="yr" /><title>{t.label}</title>{/each}
		<line x1={xs(today)} x2={xs(today)} y1="0" y2={h} class="today" />
		{#each visible as c, i}
			<rect x={xs(c.date) - 1.25} y={h - 1 - th(c.cents)} width="2.5" height={th(c.cents)} rx="1.25"
				class:inc={incSet.has(c.date)} class:hov={hover === i} />
		{/each}
		{#if !stopped}
			<rect x={xs(nextDate) - 1.25} y={h - 1 - th(charges[charges.length - 1].cents)} width="2.5"
				height={th(charges[charges.length - 1].cents)} rx="1.25" class="next" />
		{/if}
		{#each visible as c, i}
			<rect x={xs(c.date) - 4} y="0" width="8" height={h} fill="transparent" role="presentation"
				onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} />
		{/each}
	</svg>
	{#if hover != null}
		{@const c = visible[hover]}
		<span class="tip" style="left:{Math.min(xs(c.date) - 20, w - 120)}px; top:-34px">
			{dateLabel(c.date)}: <b>{money2(c.cents)}</b>{#if incSet.has(c.date)} <span class="up">↑ new price</span>{/if}
		</span>
	{/if}
</span>

<style>
	.beat { position: relative; display: inline-block; line-height: 0; vertical-align: middle; }
	.axis { stroke: var(--rule); }
	.yr { stroke: var(--ink-3); }
	.today { stroke: var(--ink-3); stroke-dasharray: 2 2; }
	rect { fill: var(--ink-2); }
	rect.inc { fill: var(--up-mark); }
	rect.hov { fill: var(--ink); }
	rect.next { fill: none; stroke: var(--ink-3); stroke-width: 1; }
	.tip { line-height: 1.3; }
</style>
