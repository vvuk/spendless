<script lang="ts">
	import { untrack } from 'svelte';
	import { money, moneyShort, monthLabel } from '#lib/format.ts';

	interface Pt { month: string; fixed: number; flexible: number; income: number; otherIn: number }
	// money in, drawn as lines over the spending bars
	const LINES = [
		{ key: 'income', label: 'Recurring income', color: 'var(--income)', dash: false },
		{ key: 'otherIn', label: 'Other money in', color: 'var(--other-in)', dash: true }
	] as const;
	type LineKey = (typeof LINES)[number]['key'];
	// `all` is the whole history; the brush under the chart picks the window [lo, hi] that's drawn.
	// `from`/`to` report the window's months to the page; `rangeMode` is the "show overview for selected range" box.
	let {
		data: all, selected, partial = false, onselect,
		from = $bindable(''), to = $bindable(''), rangeMode = $bindable(false)
	}: {
		data: Pt[]; selected: string; partial?: boolean; onselect?: (m: string) => void;
		from?: string; to?: string; rangeMode?: boolean;
	} = $props();

	const DEFAULT_SPAN = 6;
	const MIN_SPAN = 3;
	const n = $derived(all.length);
	const selIdx = $derived(all.findIndex((d) => d.month === selected));
	// default: the last 6 months, always ending at the latest (possibly partial) month; if the page opened on
	// an older month, the window reaches back far enough to include it
	function initialWindow(): [number, number] {
		const N = all.length, s = all.findIndex((d) => d.month === selected);
		const l = Math.max(0, N - DEFAULT_SPAN);
		return [s >= 0 ? Math.min(l, s) : l, N - 1];
	}
	const [lo0, hi0] = initialWindow();
	let lo = $state(lo0);
	let hi = $state(hi0);
	// when the selected month changes (month arrows, clicking a bar) and falls outside the window, stretch the
	// window to include it. Only the selection triggers this, so dragging the brush away is fine.
	$effect(() => {
		const s = selIdx, N = n;
		untrack(() => {
			if (hi > N - 1) hi = N - 1;
			if (lo > hi - MIN_SPAN + 1) lo = Math.max(0, hi - MIN_SPAN + 1);
			if (s < 0) return;
			if (s < lo) lo = s;
			else if (s > hi) hi = s;
		});
	});

	const data = $derived(all.slice(lo, hi + 1));
	$effect(() => {
		from = all[lo]?.month ?? '';
		to = all[hi]?.month ?? '';
	});
	const vPartial = $derived(partial && hi === n - 1); // the month in progress is in view

	let width = $state(800);
	const height = 236;
	const m = { top: 8, right: 8, bottom: 26, left: 44 };

	const allTotals = $derived(all.map((d) => d.fixed + d.flexible));
	// trailing average of the 12 months before each bar (needs 12 months of history), over the whole history
	const allAvg = $derived(
		allTotals.map((_, i) => (i < 12 ? null : allTotals.slice(i - 12, i).reduce((a, b) => a + b, 0) / 12))
	);
	const totals = $derived(allTotals.slice(lo, hi + 1));
	const avg = $derived(allAvg.slice(lo, hi + 1));
	// the axis is sized to spending: a windfall month (stock sale, bonus) shouldn't flatten every bar.
	// Money in above the top is pinned to it and labelled with its real value.
	const yMax = $derived(niceMax(Math.max(1, ...totals, ...avg.map((a) => a ?? 0))));
	// round tick steps: 50k → 10k steps, 40k → 10k, 30k → 10k, 25k → 5k, 20k → 5k
	const ticks = $derived.by(() => {
		const lead = yMax / 10 ** Math.floor(Math.log10(yMax));
		const n = lead === 2 || lead === 4 ? 4 : lead === 3 ? 3 : 5;
		return Array.from({ length: n + 1 }, (_, i) => (i * yMax) / n);
	});
	const iw = $derived(Math.max(10, width - m.left - m.right));
	const ih = height - m.top - m.bottom;
	const step = $derived(iw / data.length);
	const bw = $derived(Math.max(4, Math.min(44, step * 0.62)));
	const x = (i: number) => m.left + step * i + step / 2;
	const y = (v: number) => m.top + ih - (v / yMax) * ih;

	function niceMax(v: number) {
		const p = 10 ** Math.floor(Math.log10(v));
		const n = v / p;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p;
	}
	// rounded top corners only (data end), square at the baseline / segment join
	function topRounded(cx: number, y0: number, y1: number, w: number, r = 4) {
		const h = y0 - y1;
		if (h <= 0) return '';
		r = Math.min(r, h, w / 2);
		const l = cx - w / 2, rt = cx + w / 2;
		return `M${l},${y0} V${y1 + r} Q${l},${y1} ${l + r},${y1} H${rt - r} Q${rt},${y1} ${rt},${y1 + r} V${y0} Z`;
	}
	const yIn = (v: number) => y(Math.min(v, yMax));
	// a month in progress has barely any income yet, so the line stops before it (its dot stays, hollow)
	const linePath = (k: LineKey) =>
		data.slice(0, vPartial ? -1 : undefined).map((d, i) => `${i ? 'L' : 'M'}${x(i)},${yIn(d[k])}`).join(' ');
	// one label per run of off-scale months, at the run's last month: "↑ $445k, $76k"
	const pinLabels = $derived(
		LINES.flatMap((l) => {
			const out: { i: number; text: string; key: LineKey }[] = [];
			let run: number[] = [];
			data.forEach((d, i) => {
				if (d[l.key] > yMax) run.push(d[l.key]);
				if (run.length && (d[l.key] <= yMax || i === data.length - 1)) {
					out.push({ i: d[l.key] > yMax ? i : i - 1, text: '↑ ' + run.map(moneyShort).join(', '), key: l.key });
					run = [];
				}
			});
			return out;
		})
	);
	const avgPath = $derived(
		avg.map((a, i) => (a == null ? null : `${x(i)},${y(a)}`)).filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ')
	);

	let hover = $state<number | null>(null);
	const GAP = 2;
	// label every month when there's room, else every 2nd, 3rd, 6th or 12th (labels need ~48px)
	const every = $derived([1, 2, 3, 6, 12].find((k) => step * k >= 48) ?? 12);

	// ---- brush: the whole history in miniature, with a draggable window ----
	const BH = 34; // mini-chart height
	const bstep = $derived(iw / Math.max(1, n));
	const bx = (i: number) => m.left + bstep * i;
	const bMax = $derived(Math.max(1, ...allTotals));
	const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
	let drag: { mode: 'lo' | 'hi' | 'pan'; x0: number; lo0: number; hi0: number } | null = $state(null);
	function startDrag(e: PointerEvent, mode: 'lo' | 'hi' | 'pan') {
		e.preventDefault();
		e.stopPropagation();
		drag = { mode, x0: e.clientX, lo0: lo, hi0: hi };
	}
	function onMove(e: PointerEvent) {
		if (!drag) return;
		const dm = Math.round((e.clientX - drag.x0) / bstep);
		if (drag.mode === 'lo') lo = clamp(drag.lo0 + dm, 0, hi - MIN_SPAN + 1);
		else if (drag.mode === 'hi') hi = clamp(drag.hi0 + dm, lo + MIN_SPAN - 1, n - 1);
		else {
			const sh = clamp(dm, -drag.lo0, n - 1 - drag.hi0);
			[lo, hi] = [drag.lo0 + sh, drag.hi0 + sh];
		}
	}
	// a press on the track outside the window centres the window there, then drags it
	function trackDown(e: PointerEvent) {
		const svg = (e.currentTarget as SVGElement).getBoundingClientRect();
		const i = clamp(Math.floor((e.clientX - svg.left - m.left) / bstep), 0, n - 1);
		const w = hi - lo;
		const l = clamp(i - Math.floor(w / 2), 0, n - 1 - w);
		[lo, hi] = [l, l + w];
		startDrag(e, 'pan');
	}
	function handleKey(e: KeyboardEvent, which: 'lo' | 'hi') {
		const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
		const big = e.key === 'PageUp' ? 12 : e.key === 'PageDown' ? -12 : 0;
		const by = d || big;
		if (!by) return;
		e.preventDefault();
		if (which === 'lo') lo = clamp(lo + by, 0, hi - MIN_SPAN + 1);
		else hi = clamp(hi + by, lo + MIN_SPAN - 1, n - 1);
	}
	// presets end at the latest month; each says where the window starts
	const PRESETS: { label: string; title: string; start: () => number }[] = [
		{ label: '6M', title: 'Last 6 months', start: () => n - 6 },
		{ label: 'YTD', title: 'Year to date', start: () => all.findIndex((d) => d.month >= all[n - 1].month.slice(0, 4) + '-01') },
		{ label: '1Y', title: 'Last 12 months', start: () => n - 12 },
		{ label: '2Y', title: 'Last 24 months', start: () => n - 24 },
		{ label: 'All', title: 'All history', start: () => 0 }
	];
	const span = $derived(hi - lo + 1);
	const presetStart = (p: (typeof PRESETS)[number]) => clamp(p.start(), 0, Math.max(0, n - MIN_SPAN));
	function preset(p: (typeof PRESETS)[number]) {
		[lo, hi] = [presetStart(p), n - 1];
	}
</script>

<div class="legend" aria-hidden="true">
	<span><i class="sw" style="background:var(--flex)"></i>Flexible</span>
	<span><i class="sw" style="background:var(--fixed)"></i>Fixed (housing, insurance, utilities, loans)</span>
	<span><i class="ln"></i>Spending, average of the prior 12 months</span>
	{#each LINES as l}
		<span>
			<svg width="20" height="10" class="lsw"><line x1="0" x2="20" y1="5" y2="5" stroke={l.color} stroke-width="2" stroke-dasharray={l.dash ? '4 3' : undefined} /><circle cx="10" cy="5" r="3.5" fill={l.color} /></svg>{l.label}
		</span>
	{/each}
</div>
<svelte:window onpointermove={onMove} onpointerup={() => (drag = null)} onpointercancel={() => (drag = null)} />
<div class="wrap" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label="Monthly spending and income, {monthLabel(data[0].month, true)} to {monthLabel(data[data.length - 1].month, true)}">
		{#each ticks as t}
			<line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} class={t === 0 ? 'base' : 'grid'} />
			<text x={m.left - 8} y={y(t)} dy="0.32em" text-anchor="end" class="tick">{moneyShort(t)}</text>
		{/each}

		{#each data as d, i}
			{@const yf = y(d.fixed)}
			{@const yt = y(d.fixed + d.flexible)}
			{@const isPartial = vPartial && i === data.length - 1}
			<g class:sel={d.month === selected} class:dim={hover != null && hover !== i} opacity={isPartial ? 0.55 : 1}>
				{#if d.flexible > 0}
					<path d={d.fixed > 0 ? topRounded(x(i), yf - GAP, yt, bw) : topRounded(x(i), y(0), yt, bw)} fill="var(--flex)" />
				{/if}
				{#if d.fixed > 0}
					<path d={d.flexible > 0 ? `M${x(i) - bw / 2},${y(0)} V${yf} H${x(i) + bw / 2} V${y(0)} Z` : topRounded(x(i), y(0), yf, bw)} fill="var(--fixed)" />
				{/if}
			</g>
			{#if d.month === selected}
				<line x1={x(i)} x2={x(i)} y1={height - m.bottom + 3} y2={height - m.bottom + 7} class="selmark" />
			{/if}
			{#if i % every === (data.length - 1) % every}
				<text x={x(i)} y={height - 6} text-anchor="middle" class="tick" class:strong={d.month === selected}>{monthLabel(d.month)}</text>
			{/if}
		{/each}

		<path d={avgPath} class="avg" />

		{#each LINES as l}
			<path d={linePath(l.key)} class="inline" class:dash={l.dash} class:dim={hover != null} style="--c:{l.color}" />
			{#each data as d, i}
				<!-- in wide ranges the lines alone read better; the hovered month still gets its dots -->
				{#if (d[l.key] > 0 || l.key === 'income') && (step >= 16 || hover === i || (vPartial && i === data.length - 1))}
					<circle cx={x(i)} cy={yIn(d[l.key])} r={hover === i ? 5 : 4} class="indot" class:partial={vPartial && i === data.length - 1}
						class:dim={hover != null && hover !== i} style="--c:{l.color}" />
				{/if}
			{/each}
		{/each}
		{#each pinLabels as p}
			{@const atEnd = x(p.i) > width - m.right - 90}
			<text x={atEnd ? x(p.i) - 8 : x(p.i) + 8} y={m.top} dy="0.32em" text-anchor={atEnd ? 'end' : 'start'} class="tick strong">{p.text}</text>
		{/each}

		{#each data as d, i}
			<rect
				x={m.left + step * i} y={m.top} width={step} height={ih} fill="transparent"
				role="button" tabindex="0" aria-label="{monthLabel(d.month, true)}: spent {money(d.fixed + d.flexible)}, recurring income {money(d.income)}, other money in {money(d.otherIn)}"
				onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}
				onfocus={() => (hover = i)} onblur={() => (hover = null)}
				onclick={() => onselect?.(d.month)}
				onkeydown={(e) => e.key === 'Enter' && onselect?.(d.month)}
				style="cursor:pointer"
			/>
		{/each}
	</svg>
	{#if hover != null && data[hover]}
		{@const d = data[hover]}
		<div class="tip" style="left:{Math.min(x(hover) + 12, width - 220)}px; top:{Math.max(0, Math.min(y(d.fixed + d.flexible), yIn(d.income)) - 90)}px">
			<b>{monthLabel(d.month, true)}{vPartial && hover === data.length - 1 ? ' so far' : ''}</b><br />
			<span class="k" style="--c:var(--flex)"></span>Flexible {money(d.flexible)}<br />
			<span class="k" style="--c:var(--fixed)"></span>Fixed {money(d.fixed)}<br />
			Total spent {money(d.fixed + d.flexible)}{#if avg[hover] != null}<span class="muted"> · avg {money(avg[hover]!)}</span>{/if}<br />
			<span class="k" style="--c:var(--income); border-radius:50%"></span>Recurring income {money(d.income)}
			<span class="muted">· {d.income >= d.fixed + d.flexible ? '+' : '−'}{money(Math.abs(d.income - d.fixed - d.flexible))} net</span><br />
			<span class="k" style="--c:var(--other-in); border-radius:50%"></span>Other money in {money(d.otherIn)}
		</div>
	{/if}
</div>

<div class="brushbar">
	<span class="range">
		{monthLabel(data[0].month)} – {monthLabel(data[data.length - 1].month)}
		<span class="muted">· {span} months</span>
	</span>
	<span class="presets" role="group" aria-label="Time range">
		{#each PRESETS as p}
			<button type="button" title={p.title} class:on={hi === n - 1 && lo === presetStart(p)} onclick={() => preset(p)}>{p.label}</button>
		{/each}
	</span>
	<label class="rangemode"><input type="checkbox" bind:checked={rangeMode} /> Show overview for selected range</label>
</div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg class="brush" class:dragging={drag} {width} height={BH + 16} onpointerdown={trackDown}>
	{#each all as d, i}
		{@const h = (allTotals[i] / bMax) * (BH - 4)}
		<rect x={bx(i) + bstep * 0.15} y={BH - h} width={Math.max(1, bstep * 0.7)} height={h} rx="1" class="mini" class:in={i >= lo && i <= hi} />
		{#if d.month.endsWith('-01')}
			<line x1={bx(i)} x2={bx(i)} y1={BH} y2={BH + 4} class="base" />
			<text x={bx(i) + 3} y={BH + 13} class="tick">{d.month.slice(0, 4)}</text>
		{/if}
	{/each}
	<line x1={m.left} x2={width - m.right} y1={BH} y2={BH} class="base" />
	<!-- the window: drag its middle to pan, its edges to widen or narrow -->
	<rect x={bx(lo)} y="0" width={bx(hi + 1) - bx(lo)} height={BH} rx="4" class="win" onpointerdown={(e) => startDrag(e, 'pan')} />
	{#each [['lo', lo], ['hi', hi]] as const as [which, idx]}
		{@const hx = which === 'lo' ? bx(idx) : bx(idx + 1)}
		<g class="handle" role="slider" tabindex="0"
			aria-label={which === 'lo' ? 'Start of range' : 'End of range'}
			aria-valuemin={which === 'lo' ? 0 : lo + MIN_SPAN - 1} aria-valuemax={which === 'lo' ? hi - MIN_SPAN + 1 : n - 1}
			aria-valuenow={idx} aria-valuetext={monthLabel(all[idx].month, true)}
			onpointerdown={(e) => startDrag(e, which)} onkeydown={(e) => handleKey(e, which)}>
			<rect x={hx - 10} y="-4" width="20" height={BH + 8} fill="transparent" />
			<rect x={hx - 4} y="4" width="8" height={BH - 8} rx="3" class="grip" />
			<line x1={hx - 1} x2={hx - 1} y1="11" y2={BH - 11} class="gripline" />
			<line x1={hx + 1} x2={hx + 1} y1="11" y2={BH - 11} class="gripline" />
		</g>
	{/each}
</svg>

<style>
	.wrap { position: relative; width: 100%; }
	svg { display: block; overflow: visible; }
	.grid { stroke: var(--grid); stroke-width: 1; }
	.base { stroke: var(--rule); stroke-width: 1; }
	.tick { font-size: 11px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }
	.tick.strong { fill: var(--ink); font-weight: 600; }
	.avg { fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-dasharray: 1 0; stroke-linejoin: round; }
	.selmark { stroke: var(--ink); stroke-width: 2; }
	g.dim { opacity: 0.45; }
	.inline { fill: none; stroke: var(--c); stroke-width: 2; stroke-linejoin: round; transition: opacity 0.12s; }
	.inline.dash { stroke-dasharray: 5 4; }
	.inline.dim { opacity: 0.6; }
	/* 2px surface ring keeps dots legible where they cross bars */
	.indot { fill: var(--c); stroke: var(--surface); stroke-width: 2; transition: opacity 0.12s; }
	.indot.partial { fill: var(--surface); stroke: var(--c); }
	.indot.dim { opacity: 0.45; }
	.lsw { display: inline-block; overflow: visible; }
	g { transition: opacity 0.12s; }
	.legend { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 12px; color: var(--ink-2); margin-bottom: 8px; }
	.legend span { display: inline-flex; align-items: center; gap: 6px; }
	.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
	.ln { width: 16px; height: 2px; background: var(--ink-2); display: inline-block; }
	.brushbar { display: flex; align-items: center; gap: 12px; margin: 14px 0 4px; padding-left: 44px; font-size: 12px; color: var(--ink-2); }
	.presets { margin-left: auto; display: inline-flex; gap: 2px; }
	.presets button { border: 0; background: none; padding: 2px 8px; border-radius: 5px; font-size: 12px; color: var(--ink-2); cursor: pointer; }
	.presets button:hover { background: var(--wash); color: var(--ink); }
	.presets button.on { background: var(--wash); color: var(--ink); font-weight: 600; }
	.rangemode { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
	.rangemode input { margin: 0; accent-color: var(--flex); }
	.brush { display: block; overflow: visible; cursor: pointer; touch-action: none; user-select: none; }
	.mini { fill: var(--ink-3); opacity: 0.35; }
	.mini.in { fill: var(--flex); opacity: 0.8; }
	.win { fill: var(--wash); stroke: var(--ink-3); stroke-width: 1; cursor: grab; }
	.brush.dragging, .brush.dragging .win { cursor: grabbing; }
	.handle { cursor: ew-resize; outline: none; }
	.grip { fill: var(--surface); stroke: var(--ink-2); stroke-width: 1; }
	.gripline { stroke: var(--ink-3); stroke-width: 1; }
	.handle:hover .grip, .handle:focus-visible .grip { stroke: var(--ink); stroke-width: 1.5; }
	.handle:focus-visible .grip { stroke: var(--focus); stroke-width: 2; }
	.k { display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: var(--c); margin-right: 6px; }
</style>
