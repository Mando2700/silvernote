# SilverNote

A private, single-user investment research workstation: every US-listed stock with SEC fundamentals and a 0–100 **SilverNote Score**, watchlists and alerts, portfolio analytics, simulations, per-company research notes with version history, a pitch builder that exports to PDF and slides, headlines and filings, and a Grok assistant that sees what you are looking at.

It runs on your machine with no accounts and no paid data. Supabase (hosted Postgres plus sign-in) is optional and takes a few minutes to switch on.

## Quick start

Requires Node.js 20.9 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://127.0.0.1:3000. On first launch SilverNote downloads the US stock list (a few seconds), SEC fundamentals for about 5,000 companies (roughly two minutes) and then scores them in the background. The top bar shows progress.

Everything works without keys. Add these to `.env.local` when you want more:

| Setting | What it adds | Where to get it |
|---|---|---|
| `SEC_USER_AGENT` | Identifies you to SEC EDGAR as its fair-access policy asks. Put your own contact email in it. | — |
| `FINNHUB_API_KEY` | Real-time streaming prices for your holdings, watchlist and the open company, richer company and market news, peers, forward estimates and analyst data | finnhub.io (free) |
| `FMP_API_KEY` | Company profiles and descriptions, statement fallback (budgeted to 240 calls a day) | financialmodelingprep.com (free) |
| `XAI_API_KEY` | The Grok assistant: filing summaries, thesis challenges, pitch drafting | console.x.ai |

Restart `npm run dev` after editing `.env.local`. Keys are read only on the server and never reach the browser.

## What's inside

- **Dashboard** — portfolio snapshot, WebGL hero, a live market heatmap by sector and market value (click a sector to zoom, switch to score mode), movers, score leaders, sector performance, headlines.
- **Explorer** — the whole universe in a virtualized table: sector and industry navigation, filters, sortable columns, sector-relative ranks, saved screens, CSV export.
- **Company pages** — price chart (1M to 10Y, line or candles, your thesis events and target price on the chart), key statistics, visual income statement, balance sheet and cash flow from SEC XBRL (annual and quarterly), SilverNote Score breakdown with every metric, peer and sector comparison, news and filings, and the research workspace.
- **Watchlists** — several lists, custom columns, tags, notes, price and score alerts.
- **Portfolio** — trade ledger, holdings with average cost and realized/unrealized P&L, allocation, sector exposure, beta, volatility, Sharpe, Sortino, max drawdown, VaR/CVaR, correlation matrix, concentration and risk contribution, time-weighted performance against a benchmark.
- **Tax** — lot-level cost basis (FIFO, LIFO or HIFO) per portfolio, short- vs long-term gains, wash sales (disallowed loss and holding period carried into the replacement shares), realized gains and estimated tax by year, tax-loss harvesting ideas with wash-sale guard rails and same-industry replacements, gains worth holding until they turn long-term, and a Form 8949-style CSV. Taxable, tax-deferred and tax-free account types.
- **Bonds** — individual Treasuries, agencies, corporates, munis and CDs valued on the live FRED Treasury curve plus the spread implied at purchase (or your quoted price): yield to maturity, accrued interest, duration, convexity, DV01, rate-shock repricing, an income calendar and a maturity ladder. Bonds count toward portfolio value.
- **Simulations** — Monte Carlo (bootstrap or lognormal, in a web worker), stress tests replaying 2008, 2020 and 2022, and what-if trades.
- **Backtest** — test rules such as “Score above 80 and momentum rising” across ten years. A background job rebuilds month-end SilverNote Scores for the largest companies from the SEC filings public at each date (no look-ahead); rules combine thresholds, trends, cross-sectional ranks and price returns, with exit rules, position limits, rebalancing, trading costs, and results against SPY and an equal-weight universe.
- **Notes & theses** — per-company thesis, drivers, risks, catalysts and "what would prove me wrong", each change timestamped and versioned with a diff view, plus free-form notes.
- **Pitches** — pre-filled from the workspace, score and filings; reorder and toggle sections, draft or rewrite any section with Grok, export a PDF or a PowerPoint deck.
- **News** — headlines for everything you hold or watch, the wider market, and fresh SEC filings, with "Brief me" and one-click filing summaries.
- **Grok** — a side panel (⌘J) and a full page. It gets the current company or portfolio as context: statements, score, your thesis, headlines, holdings. Calls go server-side to xAI.
- **⌘K** — jump to any company, list, note, pitch or page.
- **Settings** — green/red or colorblind-friendly blue/orange market colors, motion, benchmark, risk-free rate, Grok model, data-source status, background jobs.

## Switching to Supabase

Use Supabase when you want your data in a managed Postgres, or before running SilverNote anywhere other than your own computer (local mode has no sign-in and only listens on 127.0.0.1).

1. Create a free organization and project at supabase.com.
2. In **Project Settings → Database → Connection string**, copy the **Session pooler** URI (port 5432) and set it as `DATABASE_URL`.
3. In **Project Settings → API**, copy the project URL and the anon key into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Set `OWNER_EMAIL` to the one email address allowed to use the app.
5. Create the tables and row-level security policies:

   ```bash
   npm run db:migrate
   ```

   (The server also applies pending migrations on startup.)
6. In Supabase, make sure **Confirm email** is on (**Authentication → Sign In / Providers → Email**): without it, anyone who knows `OWNER_EMAIL` could register it before you, and SilverNote refuses sign-ups that come back already signed in. Restart the server, open `/login`, choose **Create the owner account**, and confirm the email Supabase sends. In the Supabase dashboard set **Authentication → URL configuration → Site URL** to where SilverNote runs, then turn off new sign-ups under **Authentication → Sign In / Providers** once your account exists.

Market data re-downloads into the new database on first start; your local data in `./.silvernote/db` is left untouched.

## Data sources

| Source | Used for |
|---|---|
| Nasdaq (public endpoints) | Stock universe with prices and market values, quotes, 10-year daily history, company summaries, headlines |
| SEC EDGAR | Company tickers and CIKs, XBRL frames (fundamentals for the whole market), companyfacts (standardized statements), submissions and filing documents |
| FRED | Nasdaq Composite history for the 2008 stress test, 3-month Treasury bill as the risk-free rate |
| open.er-api.com | FX rates for converting foreign filers' statements to USD |
| Yahoo Finance (chart API) | Stock split history, to restate trades in today's share units (prices are split-adjusted); if unavailable, splits are inferred from prices |
| Financial Modeling Prep | Company logos (public image endpoint, no key); profiles and statements when `FMP_API_KEY` is set |
| Finnhub | Optional: real-time quotes, news, peers, estimates, analyst data |

Everything fetched is cached in Postgres, so each source is called only as often as the data actually changes.

## Architecture

- **Next.js 16** (App Router, Turbopack, React 19.2 view transitions for the row → company-page morph), TypeScript, Tailwind CSS v4.
- **Motion** for UI animation, **GSAP ScrollTrigger** for scroll-linked charts, **D3** for the treemap and SVG charts, **Lightweight Charts** for price charts, **three.js** for the hero point field.
- **Database**: one SQL migration set in `supabase/migrations/` runs on either the built-in PGlite (Postgres compiled to WebAssembly, stored in `./.silvernote/db`) or Supabase Postgres. Personal tables have owner-only row-level security; market cache tables are server-only.
- **Server**: route handlers under `src/app/api` are the only way the browser reaches data or Grok. A small scheduler inside the server process refreshes prices every 5 minutes during market hours (plus a real-time Finnhub stream for the stocks on screen when a key is set), fundamentals and scores weekly, and evaluates alerts after every refresh.
- **Auth**: in Supabase mode `src/proxy.ts` refreshes the session on each request and admits only `OWNER_EMAIL`; in local mode there is no sign-in and the server binds to 127.0.0.1.

A note on the brief: it suggested Supabase Edge Functions for the data and AI proxies. SilverNote uses Next.js route handlers instead, so the same code runs locally without Docker or the Supabase CLI and on any Node host. The data never leaves your server either way.

## SilverNote Score

A 0–100 rating from ten weighted components (growth, profitability, valuation, financial health, earnings quality, competitive position, momentum, efficiency, risk, future outlook), built from about 70 normalized metrics with penalties for missing data and an explicit confidence level. The full methodology is in [docs/silvernote-score.md](docs/silvernote-score.md), and every company's Score tab shows each metric's value, weight and source.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server on 127.0.0.1:3000 |
| `npm run build` then `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` | Apply migrations to the configured database |

Only one process can open the local PGlite database at a time, so stop the dev server before running `npm run db:migrate` against it.

## Disclaimer

SilverNote is a research tool. Scores, simulations and AI output are not investment advice, and the free data sources can be delayed or incomplete.
