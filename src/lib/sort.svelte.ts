export type Dir = 'asc' | 'desc';
type Value = string | number | null | undefined;

export interface Column<T> {
	get: (row: T) => Value;
	/** direction of the first click; defaults to asc for text, desc for numbers */
	first?: Dir;
}

/**
 * Click-to-sort state for a table. Clicking a column sorts by it, clicking again
 * flips the direction, and a third click goes back to the table's own order.
 * Empty values always sink to the bottom.
 */
export class Sorter<T> {
	key = $state<string | null>(null);
	dir = $state<Dir>('desc');
	#cols: Record<string, Column<T>>;

	constructor(cols: Record<string, Column<T>>) {
		this.#cols = cols;
	}

	toggle(key: string, rows: T[] = []) {
		const col = this.#cols[key];
		if (!col) return;
		const sample = rows.map(col.get).find((v) => v != null && v !== '');
		const first = col.first ?? (typeof sample === 'string' ? 'asc' : 'desc');
		if (this.key !== key) {
			this.key = key;
			this.dir = first;
		} else if (this.dir === first) {
			this.dir = first === 'asc' ? 'desc' : 'asc';
		} else {
			this.key = null;
		}
	}

	ariaSort(key: string): 'ascending' | 'descending' | 'none' {
		return this.key === key ? (this.dir === 'asc' ? 'ascending' : 'descending') : 'none';
	}

	apply(rows: T[]): T[] {
		const col = this.key ? this.#cols[this.key] : null;
		if (!col) return rows;
		const sign = this.dir === 'asc' ? 1 : -1;
		return rows
			.map((row, i) => ({ row, i, v: col.get(row) }))
			.sort((a, b) => {
				const ea = a.v == null || a.v === '', eb = b.v == null || b.v === '';
				if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
				const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base', numeric: true });
				return c ? c * sign : a.i - b.i;
			})
			.map((x) => x.row);
	}
}
