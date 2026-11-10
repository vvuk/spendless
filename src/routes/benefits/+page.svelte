<script lang="ts">
	import { enhance } from '$app/forms';
	import { money, money2, dateLabel } from '#lib/format.ts';

	let { data, form } = $props();
	type B = (typeof data.benefits)[number];
	type P = B['periods'][number];
	type A = (typeof data.actions)[number];

	const stay = () => async ({ update }: { update: (o?: { reset?: boolean; navigate?: boolean }) => Promise<void> }) =>
		update({ reset: false, navigate: false });

	let classifying = $state(false);
	let open = $state<Record<string, boolean>>({});
	const toggle = (k: string) => (open[k] = !open[k]);

	const acct = (a: string) => {
		const last4 = a.match(/\(\.\.\.(\w+)\)/)?.[1];
		const name = a.replace(/\s*\(.*\)/, '').replace(/®/g, '');
		return /^credit card$/i.test(name) && last4 ? `card ··${last4}` : last4 ? `${name} ··${last4}` : name;
	};
	const last4 = (a: string) => a.match(/\(\.\.\.(\w+)\)/)?.[1];
	const cardLabel = (name: string, account: string) => (last4(account) ? `${name} ··${last4(account)}` : name);

	const STATUS: Record<string, { label: string; glyph: string; cls: string }> = {
		used: { label: 'Credit received', glyph: '✓', cls: 'good' },
		likely: { label: 'Used in the app (assumed)', glyph: '✓', cls: 'good soft' },
		partial: { label: 'Partly used', glyph: '½', cls: 'part' },
		awaiting: { label: 'Credit not posted yet', glyph: '…', cls: 'part' },
		no_credit: { label: 'Qualifying spend, no credit', glyph: '?', cls: 'warn' },
		not_enrolled: { label: 'Not enrolled', glyph: '✗', cls: 'warn' },
		missed: { label: 'Spend went elsewhere', glyph: '↗', cls: 'bad' },
		paying: { label: 'Paying for it', glyph: '$', cls: 'bad' },
		unused: { label: 'Not used', glyph: '', cls: 'none' },
		open: { label: 'In progress', glyph: '', cls: 'open' }
	};
	const LEGEND = ['used', 'likely', 'partial', 'no_credit', 'missed', 'paying', 'unused', 'open'];

	const PER: Record<string, string> = { month: '/mo', quarter: '/qtr', half: '/half', year: '/yr', cardmember_year: '/card yr', four_years: '/4 yrs' };
	const KIND: Record<A['kind'], string> = { move: 'Switch card', book: 'Book differently', activate: 'Activate', enroll: 'Enroll', use: 'Use' };
	const VERDICT: Record<string, string> = { yes: '', manual: 'your call', llm: 'LLM', heuristic: 'guess' };

	const byCard = $derived(
		data.cards.map((c) => ({ ...c, benefits: data.benefits.filter((b) => b.account === c.account) }))
	);
	let showAll = $state(false);
	const actions = $derived(showAll ? data.actions : data.actions.slice(0, 8));
	const pendingByRubric = $derived(data.pending.map((p) => `${p.rubric.replace(/-/g, ' ')} ${p.txnIds.length}`).join(', '));
	const tip = (p: P) =>
		`${p.label}: ${STATUS[p.status].label}. Credit ${money2(p.capturedCents)} of ${money2(p.amountCents)}` +
		(p.onCardCents ? `, ${money(p.onCardCents)} qualifying on this card` : '') +
		(p.elsewhereCents ? `, ${money(p.elsewhereCents)} on other accounts` : '') +
		(p.open && p.daysLeft != null ? `, ${p.daysLeft} days left` : '');
	const showEnroll = (b: B) => b.enrollmentRequired || b.redemption !== 'statement_credit';
</script>

<svelte:head><title>Card benefits · Spendless</title></svelte:head>

<header class="head">
	<div>
		<h1>Card benefits</h1>
		<p class="muted">Totals cover periods that closed between {dateLabel(data.windowStart)} and today; the strips also show the periods running now.</p>
	</div>
</header>

{#if form?.error}<p class="err" role="alert">{form.error}</p>{/if}
{#if form?.classified}
	<p class="note" role="status">
		Classified {form.classified.asked}: {form.classified.yes} yes, {form.classified.no} no, {form.classified.unsure} unsure
		{#if form.classified.costUsd != null}(${form.classified.costUsd.toFixed(4)}){/if}.
	</p>
{/if}

{#if !data.cards.length}
	<p class="empty">No tracked cards found. Pick which account is which card under <a href="#accounts">Accounts</a>.</p>
{/if}

<section class="tiles">
	{#each data.cards as c}
		{@const pct = c.feeCents ? Math.min(1, c.capturedCents / c.feeCents) : 0}
		<div class="tile">
			<div class="tname">{cardLabel(c.cardName, c.account)}</div>
			<div class="tval">{money(c.capturedCents)}</div>
			<div class="tsub">captured of {money(c.possibleCents)} on offer · fee {money(c.feeCents)}</div>
			<div class="meter" role="img" aria-label="Credits cover {Math.round(pct * 100)}% of the annual fee">
				<span style:width="{pct * 100}%" class:full={pct >= 1}></span>
			</div>
			<div class="tsub">{Math.round((c.capturedCents / Math.max(1, c.feeCents)) * 100)}% of the fee back</div>
			<dl>
				<dt>Missed</dt><dd class="num">{money(c.missedCents)}</dd>
				<dt>qualifying spend went on other cards</dt><dd class="num">{money(c.moveableCents)}</dd>
				<dt>stays not booked through its portal</dt><dd class="num">{money(c.opportunityCents)}</dd>
				<dt>no qualifying spend</dt><dd class="num">{money(Math.max(0, c.missedCents - c.moveableCents - c.opportunityCents))}</dd>
				{#if c.lifestyleUnusedCents}<dt class="sep">Lifestyle credits unused</dt><dd class="num muted sep">{money(c.lifestyleUnusedCents)}</dd>{/if}
			</dl>
		</div>
	{/each}
</section>

<div class="cols">
	<section class="panel">
		<h2>What to do <span class="muted small">this year</span></h2>
		{#if !data.actions.length}<p class="muted">Nothing found. Nice.</p>{/if}
		<ol class="acts">
			{#each actions as x, i (x.benefitKey + x.title)}
				<li>
					<div class="arow">
						<span class="aval num">{money(x.valueCents)}</span>
						<span class="kind k-{x.kind}">{KIND[x.kind]}</span>
						<span class="atitle">{x.title}</span>
						{#if !x.ongoing}<span class="muted small">not recent</span>{/if}
					</div>
					<p class="adet">{x.detail}</p>
					{#if x.moves?.length}
						<button class="link" onclick={() => toggle('a' + i)} aria-expanded={!!open['a' + i]}>
							{open['a' + i] ? 'Hide' : 'Show'} {x.moves.length} purchase{x.moves.length > 1 ? 's' : ''}
						</button>
						{#if open['a' + i]}
							<table class="data mini">
								<thead><tr><th>Date</th><th>On</th><th class="r">Amount</th><th class="r">Credit</th><th class="r">Points lost</th><th class="r">Net</th></tr></thead>
								<tbody>
									{#each x.moves as m}
										<tr class:earlier={m.txn.date < data.yearStart} title={m.txn.date < data.yearStart ? 'Last year: shown for context, not counted' : undefined}>
											<td>{dateLabel(m.txn.date)}</td>
											<td>{acct(m.fromAccount)}</td>
											<td class="r">{money2(m.txn.cents)}</td>
											<td class="r">{money2(m.gainCents)}</td>
											<td class="r">{m.pointsCostCents + m.benefitLossCents ? money2(m.pointsCostCents + m.benefitLossCents) : '—'}</td>
											<td class="r">{money2(m.netCents)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							{#if x.moves.some((m) => m.txn.date < data.yearStart)}
								<p class="muted small indent">Grayed rows are from before {dateLabel(data.yearStart)}: shown for context, not counted.</p>
							{/if}
						{/if}
					{:else if x.txns?.length}
						<button class="link" onclick={() => toggle('a' + i)} aria-expanded={!!open['a' + i]}>
							{open['a' + i] ? 'Hide' : 'Show'} {x.txns.length} purchase{x.txns.length > 1 ? 's' : ''}
						</button>
						{#if open['a' + i]}
							<table class="data mini">
								<thead><tr><th>Date</th><th>Merchant</th><th>On</th><th class="r">Amount</th></tr></thead>
								<tbody>
									{#each x.txns as t}
										<tr class:earlier={t.date < data.yearStart}>
											<td>{dateLabel(t.date)}</td>
											<td>{t.merchant}</td>
											<td>{acct(t.account)}</td>
											<td class="r">{money2(t.cents)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
		{#if data.actions.length > 8}
			<button class="link" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${data.actions.length}`}</button>
		{/if}
		<p class="muted small">
			Values count purchases since {dateLabel(data.yearStart)}, since credits reset at least yearly. They're net of points you'd give up on the other card (each card's points at 1.5¢; other credit cards at 1%).
			Hotel credits on different cards compete for the same stays, so don't add those up.
		</p>
	</section>

	<section class="panel">
		<h2>Still open this period</h2>
		{#if !data.actNow.length}<p class="muted">Nothing left to use right now.</p>{/if}
		<table class="data">
			<tbody>
				{#each data.actNow as x}
					<tr>
						<td>
							{x.name}
							<div class="muted small">{x.cardName} · {x.periodLabel}</div>
						</td>
						<td class="r num">{money(x.remainingCents)}</td>
						<td class="r num" class:soon={x.daysLeft <= 10}>{x.daysLeft} days</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if data.llm.pending}
			<div class="llm">
				<h3>{data.llm.pending} transactions need a judgement call</h3>
				<p class="muted small">
					Fuzzy rules ({pendingByRubric}) are answered by {data.llm.model} through OpenRouter, once per transaction.
					Until then those purchases aren't counted.
				</p>
				{#if data.llm.configured}
					<form method="POST" action="?/classify" use:enhance={() => { classifying = true; return async ({ update }) => { classifying = false; await update({ reset: false, navigate: false }); }; }}>
						<button class="btn" disabled={classifying}>{classifying ? 'Asking…' : `Classify ${Math.min(400, data.llm.pending)}`}</button>
					</form>
				{:else}
					<p class="small">Add <code>OPENROUTER_API_KEY=…</code> to <code>.env</code> and restart, or run <code>mise run benefits -- --classify</code>.</p>
				{/if}
			</div>
		{/if}
	</section>
</div>

{#each byCard as c}
	<section class="panel card">
		<div class="chead">
			<h2>{cardLabel(c.cardName, c.account)}</h2>
			<span class="muted small">Card year starts {c.anniversary}{c.anniversarySource === 'fee' ? ' (from the annual fee)' : c.anniversarySource === 'default' ? ' (assumed)' : ''}</span>
		</div>
		<table class="data bens">
			<thead>
				<tr>
					<th>Benefit</th>
					<th class="r">Worth</th>
					<th>History</th>
					<th class="r">Got</th>
					<th class="r">Missed</th>
					<th>Enrollment</th>
				</tr>
			</thead>
			<tbody>
				{#each c.benefits as b (b.key)}
					<tr class:life={b.lifestyle}>
						<td>
							<button class="link name" onclick={() => toggle(b.key)} aria-expanded={!!open[b.key]}>{b.name}</button>
							{#if b.lifestyle}<span class="muted small">lifestyle</span>{/if}
						</td>
						<td class="r num">{money2(b.amountCents)}<span class="muted">{PER[b.period]}</span></td>
						<td>
							<span class="strip" role="list" aria-label="{b.name} by period">
								{#each b.periods as p}
									<span role="listitem" class="cell {STATUS[p.status].cls}" title={tip(p)} aria-label={tip(p)}>{STATUS[p.status].glyph}</span>
								{/each}
							</span>
						</td>
						<td class="r num">{b.totals.capturedCents ? money(b.totals.capturedCents) : '—'}</td>
						<td class="r num">{b.totals.missedCents ? money(b.totals.missedCents) : '—'}</td>
						<td>
							{#if showEnroll(b)}
								<form method="POST" action="?/enroll" use:enhance={stay}>
									<input type="hidden" name="account" value={b.account} />
									<input type="hidden" name="key" value={b.key} />
									<select name="status" onchange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Enrollment for {b.name}">
										<option value="" selected={b.enrollment === 'unknown' || b.enrollmentInferred}>{b.enrollmentInferred ? 'Enrolled (seen credits)' : 'Unknown'}</option>
										<option value="enrolled" selected={b.enrollment === 'enrolled' && !b.enrollmentInferred}>Enrolled</option>
										<option value="not_enrolled" selected={b.enrollment === 'not_enrolled'}>Not enrolled</option>
									</select>
								</form>
							{:else}
								<span class="muted small">automatic</span>
							{/if}
						</td>
					</tr>
					{#if open[b.key]}
						<tr class="detail">
							<td colspan="6">
								<div class="dwrap">
									{#if b.channel}<p class="small"><b>How:</b> {b.channel}</p>{/if}
									{#if b.enrollHow && b.enrollmentRequired}
										<p class="small"><b>Enroll:</b> {b.enrollHow} {#if b.enrollUrl}<a href={b.enrollUrl} target="_blank" rel="noreferrer">Open</a>{/if}</p>
									{/if}
									{#if b.notes}<p class="small muted">{b.notes}</p>{/if}
									{#each [...b.periods].reverse() as p}
										<div class="period">
											<div class="phead">
												<span class="cell {STATUS[p.status].cls}" aria-hidden="true">{STATUS[p.status].glyph}</span>
												<b>{p.label}</b>
												<span class="muted">{STATUS[p.status].label}</span>
												<span class="num">credit {money2(p.capturedCents)} of {money2(p.amountCents)}</span>
												{#if p.moveableCents}<span class="num">· {money2(p.moveableCents)} could move here</span>{/if}
												{#if p.opportunityCents}<span class="num">· {money2(p.opportunityCents)} bookable</span>{/if}
											</div>
											{#if p.credits.length + p.onCard.length + p.elsewhere.length}
												<table class="data mini">
													<tbody>
														{#each p.credits as t}
															<tr><td>{dateLabel(t.date)}</td><td>Credit · {t.merchant}</td><td></td><td class="r good">+{money2(t.cents)}</td><td></td></tr>
														{/each}
														{#each [...p.onCard.map((t) => ({ t, here: true })), ...p.elsewhere.map((t) => ({ t, here: false }))] as { t, here }}
															<tr>
																<td>{dateLabel(t.date)}</td>
																<td>{t.merchant} {#if VERDICT[t.verdict]}<span class="tag">{VERDICT[t.verdict]}</span>{/if}</td>
																<td class="muted">{here ? 'this card' : acct(t.account)}</td>
																<td class="r">{money2(t.cents)}</td>
																<td class="r">
																	<form method="POST" action="?/override" use:enhance={stay}>
																		<input type="hidden" name="key" value={b.key} />
																		<input type="hidden" name="txn" value={t.id} />
																		<input type="hidden" name="eligible" value="0" />
																		<button class="link small" title="This purchase doesn't qualify">doesn't count</button>
																	</form>
																</td>
															</tr>
														{/each}
													</tbody>
												</table>
											{/if}
										</div>
									{/each}
								</div>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
		<p class="legend small">
			{#each LEGEND as s}<span><span class="cell {STATUS[s].cls}" aria-hidden="true">{STATUS[s].glyph}</span>{STATUS[s].label}</span>{/each}
		</p>
	</section>
{/each}

{#if data.enrollQueue.length}
	<section class="panel">
		<h2>Enrollment to-do</h2>
		<p class="muted small">Benefits that need signing up and aren't marked enrolled, by how much qualifying spend you had. Automatic sign-up will work from this list.</p>
		<table class="data">
			<tbody>
				{#each data.enrollQueue as t}
					<tr>
						<td>{t.name}<div class="muted small">{t.cardName}</div></td>
						<td class="r num">{t.spendCents ? money(t.spendCents) : '—'}</td>
						<td class="small">{t.how} {#if t.url}<a href={t.url} target="_blank" rel="noreferrer">Open</a>{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<section class="panel" id="accounts">
	<h2>Accounts</h2>
	<p class="muted small">Which credit card account is which card. Detected from the institution, the name, and the annual fee; change it if it's wrong. The card year anchors yearly credits like the Sapphire travel credit.</p>
	<table class="data">
		<thead><tr><th>Account</th><th>Card</th><th>Card year starts (MM-DD)</th></tr></thead>
		<tbody>
			{#each data.accounts as a}
				<tr>
					<td>{a.account}<div class="muted small">{a.institution ?? ''}</div></td>
					<td colspan="2">
						<form class="mapf" method="POST" action="?/map" use:enhance={stay}>
							<input type="hidden" name="account" value={a.account} />
							<select name="card" aria-label="Card for {a.account}">
								<option value="" selected={a.mapping !== 'manual'}>Automatic{a.mapping === 'detected' ? ` (${data.cardDefs.find((c) => c.id === a.cardId)?.name})` : ' (none)'}</option>
								{#each data.cardDefs as c}<option value={c.id} selected={a.mapping === 'manual' && a.cardId === c.id}>{c.name}</option>{/each}
								<option value="none" selected={a.mapping === 'manual' && !a.cardId}>Not a tracked card</option>
							</select>
							<input name="anniversary" placeholder={a.anniversary ?? 'MM-DD'} value={a.anniversarySource === 'manual' ? a.anniversary : ''} size="6" aria-label="Card year start for {a.account}" />
							<button class="btn">Save</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if data.exclusions.length}
		<h3>Your calls on transactions</h3>
		<table class="data mini">
			<tbody>
				{#each data.exclusions as x}
					<tr>
						<td>{dateLabel(x.date)}</td>
						<td>{x.merchant}</td>
						<td class="muted">{x.benefit_id}</td>
						<td>{x.eligible ? 'counts' : "doesn't count"}</td>
						<td class="r">
							<form method="POST" action="?/override" use:enhance={stay}>
								<input type="hidden" name="key" value={x.benefit_id} />
								<input type="hidden" name="txn" value={x.txn_id} />
								<input type="hidden" name="eligible" value="" />
								<button class="link small">undo</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.head { margin-bottom: 16px; }
	h1 { font-size: 22px; }
	h3 { font-size: 13px; margin: 12px 0 4px; }
	.small { font-size: 12px; }
	.err { color: var(--up); }
	.note { color: var(--good); }
	.empty { padding: 24px 0; }
	code { font-size: 12px; background: var(--wash); padding: 1px 4px; border-radius: 3px; }

	.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 16px; }
	.tile, .panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 16px 18px; }
	.tname { color: var(--ink-2); font-weight: 550; }
	.tval { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; margin-top: 2px; }
	.tsub { color: var(--ink-3); font-size: 12px; }
	.meter { height: 8px; border-radius: 4px; background: var(--flex-soft); margin: 10px 0 4px; overflow: hidden; }
	.meter span { display: block; height: 100%; background: var(--flex); border-radius: 4px; }
	.meter span.full { background: var(--good-mark); }
	dl { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; margin: 12px 0 0; font-size: 13px; }
	dt { color: var(--ink-2); }
	dt:not(:first-child) { padding-left: 12px; color: var(--ink-3); }
	dd { margin: 0; text-align: right; }
	dt.sep, dd.sep { margin-top: 6px; padding-left: 0; }

	.cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; margin-bottom: 16px; align-items: start; }
	@media (max-width: 960px) { .cols { grid-template-columns: 1fr; } }
	.panel h2 { margin-bottom: 10px; }
	.panel.card { margin-bottom: 16px; }

	.acts { list-style: none; padding: 0; margin: 0 0 10px; }
	.acts li { padding: 8px 0; border-bottom: 1px solid var(--grid); }
	.arow { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
	.aval { min-width: 56px; text-align: right; font-weight: 600; }
	.atitle { font-weight: 550; }
	.adet { margin: 2px 0 0 66px; color: var(--ink-2); font-size: 13px; }
	.acts .link, .acts table, .acts .indent { margin-left: 66px; }
	.acts tr.earlier td { color: var(--ink-3); }
	.kind { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--wash); color: var(--ink-2); white-space: nowrap; }

	.link { all: unset; cursor: pointer; color: var(--flex); font-size: 12px; }
	.link:hover { text-decoration: underline; }
	.link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.link.name { color: var(--ink); font-size: 14px; }

	table.mini { font-size: 12px; margin: 4px 0 6px; width: auto; min-width: 60%; }
	table.mini td { padding: 3px 8px; }
	.soon { color: var(--up); font-weight: 550; }
	.llm { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--grid); }

	.chead { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
	.bens tr.life td { color: var(--ink-2); }
	.strip { display: inline-flex; gap: 2px; flex-wrap: wrap; max-width: 260px; }
	.cell {
		display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px;
		font-size: 10px; font-weight: 700; line-height: 1; color: #fff; background: var(--grid);
	}
	.cell.good { background: var(--good-mark); }
	.cell.good.soft { background: color-mix(in srgb, var(--good-mark) 55%, var(--surface)); color: var(--ink); }
	.cell.part { background: var(--flex); }
	.cell.warn { background: #fab219; color: #0b0b0b; }
	.cell.bad { background: var(--up-mark); }
	.cell.none { background: var(--grid); }
	.cell.open { background: transparent; box-shadow: inset 0 0 0 1.5px var(--rule); }
	.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 10px 0 0; color: var(--ink-2); }
	.legend > span { display: inline-flex; gap: 5px; align-items: center; }

	tr.detail > td { background: var(--plane); }
	tr.detail:hover > td { background: var(--plane) !important; }
	.dwrap { padding: 6px 4px 10px; }
	.dwrap p { margin: 2px 0 6px; }
	.period { margin: 8px 0; }
	.phead { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
	.tag { font-size: 10px; color: var(--ink-3); border: 1px solid var(--rule); border-radius: 3px; padding: 0 3px; margin-left: 4px; }
	.mapf { display: flex; gap: 8px; align-items: center; }
	select, input { border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); padding: 3px 6px; font-size: 13px; }
</style>
