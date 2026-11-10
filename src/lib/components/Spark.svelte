<script lang="ts">
	import { money, monthLabel } from '#lib/format.ts';
	let { values, months, w = 96, h = 22 }: { values: number[]; months: string[]; w?: number; h?: number } = $props();
	const max = $derived(Math.max(1, ...values));
	const bw = $derived(w / values.length);
	let hover = $state<number | null>(null);
</script>

<span class="spark">
	<svg width={w} height={h} aria-hidden="true">
		{#each values as v, i}
			{@const bh = v > 0 ? Math.max(1.5, (v / max) * (h - 2)) : 0}
			<rect x={i * bw + 0.5} y={h - bh} width={Math.max(1, bw - 1.5)} height={bh} rx="1" class="bar"
				class:last={i === values.length - 1} class:hov={hover === i} />
			<rect x={i * bw} y="0" width={bw} height={h} class="hit"
				role="presentation" onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} />
		{/each}
	</svg>
	{#if hover != null}<span class="tip" style="left:{hover * bw}px; top:-30px">{monthLabel(months[hover])}: <b>{money(values[hover])}</b></span>{/if}
</span>

<style>
	.spark { position: relative; display: inline-block; vertical-align: middle; line-height: 0; }
	/* only the bars: the full-height hover targets stay invisible */
	.bar { fill: var(--ink-3); opacity: 0.55; }
	.bar.last { fill: var(--flex); opacity: 1; }
	.bar.hov { opacity: 1; fill: var(--ink); }
	.hit { fill: transparent; }
	.tip { line-height: 1.3; }
</style>
