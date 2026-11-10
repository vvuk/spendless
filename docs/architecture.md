# Architecture

How Spendless is put together. For setup, see the [README](../README.md).

## Demo mode

The **Demo mode** button in the header swaps your data for two years of made-up but plausible finances
(a salaried renter with savings, a car loan, the usual subscriptions, and a Sapphire Reserve and Amex Platinum with credits used, missed and still open), so you can take
screenshots or show the app without revealing anything real. Click it again to go back.

- The demo data lives only in memory (`src/lib/server/demo/`). It's never written to disk and your
  `data/spendless.db` isn't read or written while demo mode is on.
- It ends today and is rebuilt each day; a given date always gets the same made-up transactions.
  Edits you make in demo mode (rules, categories, recurring marks) last until the server restarts.
- Sync and LLM classification are turned off in demo mode; the demo comes with canned answers for the
  benefit questions the LLM would normally settle. The setting is a cookie, so it's per browser; command-line tasks
  (`sync`, `import:csv`, `recurring`) always use your real data.

## How it's put together

- `src/lib/server/db.ts`: schema and migrations. `raw_transactions` is exactly what Monarch reports and
  is only written by imports/syncs. Your edits live in `overrides` (one transaction) and `rules`.
  The `txns` view merges them: your edit > your rule > Monarch.
- `src/lib/server/rules.ts`: rules combine any of merchant / statement (is, contains, regex), amount
  (exact or range), direction, account, Monarch's category, and dates. They can set a category, rename
  the merchant, and/or declare the matches a recurring series (e.g. rent paid over Venmo). When several
  match, explicit priority wins, then the rule with more conditions, then the newest. Edit them at
  `/rules`, or start one from any transaction with its » button.
- `src/lib/server/recurring.ts`: recurring-charge detection. Per normalized merchant, it chains charges
  that land one billing period apart (weekly → yearly, tolerating a skipped period). Exact prices go
  first, then near prices for FX or usage-based bills. Runs that hand off to each other are stitched
  into one series with its price changes. Busy merchants (Amazon, rideshare) need stronger evidence.
  `mise run recurring` prints what it finds.
- `src/lib/server/sync/monarchMcp.ts`: the MCP client and OAuth flow.
- `src/lib/server/benefits/`: credit card benefits (see below).
- Pages: `/` overview, `/recurring`, `/benefits`, `/transactions`, `/rules`.

"Fixed" vs "flexible" spending is defined in `src/lib/categories-shared.ts`.

## Credit card benefits

`/benefits` (and `mise run benefits`) shows, for each card you hold, which credits you used, which you
missed, and which purchases on other cards would have earned a credit had they gone on this one, net of
the points you'd give up and of credits the move would cost the other card.

Cards are data. Each lives in `src/lib/server/benefits/cards/` as a `CardDef`: annual fee, point value,
earn rates, how to recognise the account (institution, name, annual-fee line), and its benefits. A benefit
is an amount per period (month, quarter, half, year, cardmember year, four years), a date range, what
qualifies (merchant/statement regexes, categories, amount bounds), how it pays out (statement credit,
in-app credit, free membership), whether it needs enrolling, and optionally a booking channel (The Edit,
Amex Travel) for credits that only work when booked a certain way. To add a card, write one file and list
it in `cards/index.ts`.

Fuzzy rules ("an airline incidental fee", "a restaurant on Resy", "a hotel stay") are rubrics in
`rubrics.ts`. Candidates that the regexes can't settle are sent in batches to a cheap model through
OpenRouter, and each answer is cached per transaction in `llm_labels`; changing a rubric's wording re-asks.
Put `OPENROUTER_API_KEY=…` in `.env` (and optionally `SPENDLESS_LLM_MODEL`, default
`google/gemini-3.1-flash-lite`). After that, every sync (the **Sync now** button or `mise run sync`) asks
about new purchases automatically; the **Classify** button on `/benefits` and `mise run benefits -- --classify`
do the same on demand. Purchases waiting for an answer aren't counted, and a failed call never fails the sync.

Other commands: `mise run benefits -- --detail amex-platinum/digital-entertainment` prints period by period
with the transactions; `-- --json` dumps everything.

Known limits: in-app credits (Uber Cash, Lyft, DoorDash) never appear on a statement, so a month with
qualifying use on the card is assumed used. Amex sometimes posts credits under the merchant's own name,
so a small refund at an eligible merchant can look like a credit. Enrollment is tracked by hand (or inferred
once a credit posts); `enroll.ts` holds the to-do list and the `Enroller` interface for signing up automatically later.
