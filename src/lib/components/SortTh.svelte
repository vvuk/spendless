<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { Sorter } from '#lib/sort.svelte.ts';

	let { sorter, key, rows, right = false, children }: { sorter: Sorter<T>; key: string; rows: T[]; right?: boolean; children: Snippet } = $props();
	const st = $derived(sorter.ariaSort(key));
</script>

<th class:r={right} aria-sort={st}>
	<button type="button" class="sortbtn" class:on={st !== 'none'} onclick={() => sorter.toggle(key, rows)}>
		{#if right}<span class="arr" aria-hidden="true">{st === 'ascending' ? '↑' : '↓'}</span>{/if}
		{@render children()}
		{#if !right}<span class="arr" aria-hidden="true">{st === 'ascending' ? '↑' : '↓'}</span>{/if}
	</button>
</th>
