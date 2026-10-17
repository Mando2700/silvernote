# SilverNote

**Designed and built by [Michal Mucha](https://github.com/Mando2700).**

> [!NOTE]
> SilverNote is my personal investment research tool. The code is public so you can read it, but it is
> **not open source**: it is not licensed for anyone else to use, copy, deploy or redistribute (see
> [LICENSE](LICENSE)). The hosted instance only admits my own account. Nothing here is investment advice.

A private, single-user investment research workstation: every US-listed stock with SEC fundamentals and a 0–100 **SilverNote Score**, watchlists and alerts, portfolio analytics, simulations, per-company research notes with version history, a pitch builder that exports to PDF and slides, headlines and filings, and a Grok assistant that sees what you are looking at.

It runs on your machine with no accounts and no paid data. Supabase (hosted Postgres plus sign-in) is optional and takes a few minutes to switch on.

## Running it

These are my own setup notes. Requires Node.js 20.9 or newer.

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

- **Dashboard** — a cross-asset macro tape (VIX, 10Y, dollar, oil, gold, bitcoin, FX; editable), your portfolio at a glance (also in your base currency), the week ahead for your names (earnings, ex-dividend dates, major US releases), Grok's morning brief and red teams, a live market heatmap by sector and market value (click a sector to zoom, switch to score mode), movers, score leaders, sector performance, headlines.
- **Terminal** — your own multi-panel screen: chart, quote, financials, news, insiders, comps, DCF, score, peers, thesis, market map and macro panels, sized and arranged freely. Panels share a colored link group (A/B/C) so changing the ticker in one moves the whole group. Presets plus saved layouts.
- **Explorer** — the whole universe in a virtualized table: sector and industry navigation, filters, sortable columns, sector-relative ranks, saved screens, CSV and Excel export.
- **Macro** — FRED rates and policy, inflation, growth and labor, credit and liquidity series with charts, the Treasury yield curve today vs 1 month and 1 year ago, and one-click APA citations.
- **Calendar** — earnings (with consensus EPS and timing), ex-dividend dates and US economic releases (with consensus and prior), highlighting your holdings and watchlists; set an earnings reminder or get a Grok earnings preview from any row.
- **Company pages** — price chart (1D to 10Y, line or candles, your thesis events and target price) with SMA/EMA/Bollinger overlays, RSI and MACD panes, other tickers compared on a % scale, and price-level and trend-line drawings; key statistics, visual income statement, balance sheet and cash flow from SEC XBRL (annual and quarterly, Excel export), DCF, a comps table with peer statistics and implied value, SilverNote Score breakdown, peers, news and filings (with copy-ready citations), Form 4 insider transactions, year-over-year 10-K risk-factor changes, and the research workspace.
- **Watchlists & alerts** — several lists, custom columns, tags, notes. Alerts on price, daily moves, score, new filings (10-K/10-Q/8-K/proxy/13D), insider purchases, upcoming earnings and fundamental thresholds — delivered in the app, as push notifications (install SilverNote on your phone's home screen) and to Telegram.
- **Portfolio** — trade ledger, holdings with average cost and realized/unrealized P&L, allocation, sector exposure, beta, volatility, Sharpe, Sortino, max drawdown, VaR/CVaR, correlation matrix, concentration and risk contribution, time-weighted performance against a benchmark. Fama-French five-factor + momentum exposure with t-statistics, Brinson-Fachler attribution against S&P 500 sectors, a 12-month dividend income forecast, and target weights with a rebalancing trade plan.
- **Decision journal** — log each call with entry, target, stop, deadline and confidence; SilverNote scores it as prices move and shows your hit rate, Brier score and calibration by confidence band.
- **Sharing** — the Share button on a portfolio opens a studio with two outputs that share one privacy control. *Image*: five templates (snapshot, holdings, allocation, performance, sectors) in square, 4:5, 9:16 and 16:9, four themes, per-stock colors with logos, downloaded, copied or sent through the system share sheet as a 2× PNG. *Link*: a read-only page at `/s/<token>` that is live or a frozen snapshot, can expire, can need a passcode, can be turned off, and counts views. Privacy is applied on the server before anything is sent: dollar amounts exact, scaled to a $100K model, or hidden; share counts, returns, cash and the number of holdings shown (down to sectors only, which hides every ticker) are each optional. Links only open for other people once SilverNote runs somewhere they can reach (see Supabase below).
- **Tax** — lot-level cost basis (FIFO, LIFO or HIFO) per portfolio, short- vs long-term gains, wash sales (disallowed loss and holding period carried into the replacement shares), realized gains and estimated tax by year, tax-loss harvesting ideas with wash-sale guard rails and same-industry replacements, gains worth holding until they turn long-term, and a Form 8949-style CSV. Taxable, tax-deferred and tax-free account types. Switch Settings → Tax rules to Poland for PIT-38: FIFO lots converted at the NBP rate from the business day before each trade, 19% on the year's net income, five-year loss carry-forward, and a CSV of every matched lot.
- **Bonds** — individual Treasuries, agencies, corporates, munis and CDs valued on the live FRED Treasury curve plus the spread implied at purchase (or your quoted price): yield to maturity, accrued interest, duration, convexity, DV01, rate-shock repricing, an income calendar and a maturity ladder. Bonds count toward portfolio value.
- **Simulations** — Monte Carlo (bootstrap or lognormal, in a web worker), stress tests replaying 2008, 2020 and 2022, and what-if trades.
- **Backtest** — test rules such as “Score above 80 and momentum rising” across ten years. A background job rebuilds month-end SilverNote Scores for the largest companies from the SEC filings public at each date (no look-ahead); rules combine thresholds, trends, cross-sectional ranks and price returns, with exit rules, position limits, rebalancing, trading costs, and results against SPY and an equal-weight universe.
- **Notes & theses** — per-company thesis, drivers, risks, catalysts and "what would prove me wrong", each change timestamped and versioned with a diff view, plus free-form notes. Paste screenshots or charts straight into any note. Kill criteria turn "what would prove me wrong" into alerts on a metric or price.
- **Research lab** — market-model event studies (earnings releases from 8-K item 2.02, all 8-Ks, or your own dates) with abnormal returns and t-statistics, and a comparable-companies builder; everything exports to Excel with a Sources sheet and citations.
- **Pitches** — pre-filled from the workspace, score and filings; reorder and toggle sections, draft or rewrite any section with Grok, export a PDF or a PowerPoint deck.
- **News** — headlines for everything you hold or watch, the wider market, and fresh SEC filings, with "Brief me" and one-click filing summaries.
- **Learn** — an investing and investment-banking course built from what the standard programs teach (bank analyst training, modeling courses, CFA Level I, NYU/MIT/Wharton valuation and investments, hedge-fund pitch guides). 17 lessons in five tracks — foundations, valuation (DCF, WACC, reverse DCF, comps), risk (Sharpe, correlation and beta, Monte Carlo, VaR), deals (accretion/dilution, LBO, bonds) and research (theses, pitching) — each with interactive labs on real companies and prices, a quiz, and links to where you use it in SilverNote. Plus a practice lab of randomized problems with worked solutions, 43 technical interview questions (flashcards, or written answers graded by Grok), a pitch studio that scores your pitch live against a competition-style rubric and has Grok grade it like a PM, a case library of famous theses that worked and failed, and an analyst rank from Intern to MD.
- **Grok** — a side panel (⌘J) and a full page. It gets the current company or portfolio as context and can call SilverNote tools itself: statements, screens, comps, event studies, filings (read any 10-K section), insider trades, risk-factor changes, the calendar, macro series and your journal, plus web and X search. On a schedule it writes a morning brief before the US open, red-teams your theses every Sunday and previews earnings for your holdings the evening before.
- **⌘K command line** — jump anywhere, or type terminal-style commands: `NVDA FA`, `AAPL DCF`, `MSFT COMP`, `NVDA vs AMD INTC`, `TSLA INS`, `ECO`, `MACRO`, `ATTR`, `WL add TSM`, `ALERT MSFT < 400`, `? what moved yields today`. Keyboard: `/` command line, `g` + letter to jump (g p portfolio, g c calendar…), `j`/`k` through table rows, `?` for all shortcuts.
- **Settings** — green/red or colorblind-friendly blue/orange market colors, compact density, motion, benchmark, risk-free rate, base currency, tax rules (US or Poland), notifications (push, Telegram, morning brief, weekly red team), macro tape, Grok model, data-source status, background jobs.
- **Phone** — installable as an app (home-screen icon, push notifications) with a bottom tab bar and drawer navigation.

## Notifications and the background worker

Run locally (`npm run dev` or `npm start`), the server does its own background work every minute. On Vercel it does none, so the site stays within the free Hobby limits; the **Worker** workflow (`.github/workflows/worker.yml`) does it instead on GitHub Actions, every 10 minutes through the US trading day and hourly otherwise. Each run executes `scripts/worker.ts` (also `npm run worker`) straight against the database: price sweep, fundamentals and scores when due, alerts, notifications and briefs.

1. Add repository secrets on GitHub: `DATABASE_URL` (the Supabase session pooler URI) and whichever of `OWNER_EMAIL`, `SEC_USER_AGENT`, `FINNHUB_API_KEY`, `FMP_API_KEY`, `XAI_API_KEY`, `XAI_MODEL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `APP_URL` you use.
2. Runs may overlap: each job claims its row in the jobs table, and a long sweep stopped by the 3-hour limit resumes on the next run. Logs show only step names, since workflow logs in a public repository are public.
3. To have Vercel do the work itself again (needs a paid plan for the 5-minute cadence), set `SERVERLESS_SCHEDULER=on` and call `/api/cron` with `Authorization: Bearer $CRON_SECRET`.
4. Push notifications: generate keys once with `npx web-push generate-vapid-keys`, set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, then press **Enable** in Settings → Notifications on each device. On iPhone, first add SilverNote to the Home Screen and enable it from the installed app.
4. Telegram (optional): create a bot with @BotFather, send it a message, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (from `https://api.telegram.org/bot<token>/getUpdates`), and `APP_URL` for links back.

## Switching to Supabase

Use Supabase when you want your data in a managed Postgres, or before running SilverNote anywhere other than your own computer (local mode has no sign-in and only listens on 127.0.0.1).

1. Create a free organization and project at supabase.com.
2. In **Project Settings → Database → Connection string**, copy the **Session pooler** URI (port 5432) and set it as `DATABASE_URL`.
3. In **Project Settings → API**, copy the project URL and the anon key into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Set `OWNER_EMAIL` to the email address allowed to use the app (comma-separate more addresses to let others register; each gets their own separate data).
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
| Nasdaq (public endpoints) | Stock universe with prices and market values, quotes, 10-year daily history, company summaries, headlines, earnings/dividend/economic calendars |
| SEC EDGAR | Company tickers and CIKs, XBRL frames (fundamentals for the whole market), companyfacts (standardized statements), submissions and filing documents, Form 4 insider filings, 10-K risk factors |
| FRED | Treasury curve, macro series (inflation, labor, credit, financial conditions), Nasdaq Composite history for the 2008 stress test, 3-month bill as the risk-free rate |
| Kenneth R. French Data Library | Daily Fama-French five factors and momentum for factor exposure |
| NBP (Narodowy Bank Polski) | USD/PLN table A rates for the Polish PIT-38 report |
| open.er-api.com | FX rates for converting foreign filers' statements to USD |
| Yahoo Finance (chart API) | Index levels, the macro tape (VIX, yields, dollar, commodities, crypto, FX) and stock split history (prices are split-adjusted; splits are inferred from prices if unavailable) |
| Financial Modeling Prep | Company logos (public image endpoint, no key); profiles and statements when `FMP_API_KEY` is set |
| Finnhub | Optional: real-time quotes, news, peers, estimates, analyst data |

Everything fetched is cached in Postgres, so each source is called only as often as the data actually changes.

## Architecture

- **Next.js 16** (App Router, Turbopack, React 19.2 view transitions for the row → company-page morph), TypeScript, Tailwind CSS v4.
- **Motion** for UI animation and scroll-linked charts, **D3** for the treemap and SVG charts, **Lightweight Charts** for price charts, **three.js** for the sign-in page's point field, **ExcelJS** for exports, **web-push** for notifications.
- **Database**: one SQL migration set in `supabase/migrations/` runs on either the built-in PGlite (Postgres compiled to WebAssembly, stored in `./.silvernote/db`) or Supabase Postgres. Personal tables have owner-only row-level security; market cache tables are server-only.
- **Server**: route handlers under `src/app/api` are the only way the browser reaches data or Grok. The scheduler refreshes prices every 5 minutes during market hours (plus a real-time Finnhub stream for the stocks on screen when a key is set), fundamentals and scores weekly (failed runs retry with backoff), evaluates alerts, delivers notifications and writes scheduled briefs. Locally it runs inside the server process; for the Vercel deployment it runs on GitHub Actions (see the background worker above).
- **Auth**: in Supabase mode `src/proxy.ts` refreshes the session on each request and admits only the emails in `OWNER_EMAIL`; in local mode there is no sign-in and the server binds to 127.0.0.1.

## SilverNote Score

A 0–100 rating from ten weighted components (growth, profitability, valuation, financial health, earnings quality, competitive position, momentum, efficiency, risk, future outlook), built from about 70 normalized metrics with penalties for missing data and an explicit confidence level. The full methodology is in [docs/silvernote-score.md](docs/silvernote-score.md), and every company's Score tab shows each metric's value, weight and source.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server on 127.0.0.1:3000 |
| `npm run build` then `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Smoke tests of every page on desktop and phone widths (Playwright; `npx playwright install chromium` once) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` | Apply migrations to the configured database |
| `npm run worker` | One background-worker run against the configured database |

Only one process can open the local PGlite database at a time, so stop the dev server before running `npm run db:migrate` against it.

## Disclaimer

SilverNote is a research tool. Scores, simulations and AI output are not investment advice, and the free data sources can be delayed or incomplete.

## License

Copyright © 2026 Michal Mucha. All rights reserved. The source is visible for reading only; using, copying, deploying or redistributing it needs my written permission. See [LICENSE](LICENSE). Security issues: [SECURITY.md](SECURITY.md).
