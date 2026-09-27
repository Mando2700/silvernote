# SilverNote Score — methodology

The SilverNote Score is a 0–100 rating of a listed company built only from filed financials, market prices and (when available) consensus estimates. It lives in `src/lib/score/` as a standalone module with no UI or database dependencies:

| File | Role |
|---|---|
| `types.ts` | Input and result types (`ScoreInput`, `SilverNoteScore`, `SubScore`, `MetricResult`) |
| `constants.ts` | Component weights, evidence-group weights, missing-data prior, version |
| `normalization.ts` | Threshold curves that map a raw metric to 0–1, plus math helpers |
| `metrics.ts` | Every metric: formula, thresholds, weight, required flag, explanation |
| `confidence.ts` | Missing-data shrinkage and confidence levels |
| `engine.ts` | `calculateSilverNoteScore(input)`: metrics → components → overall |
| `explanations.ts` | Labels, one-line reasons, strengths, weaknesses and watch items |
| `input.ts` | `buildScoreInput(source)`: turns statements, quotes and candles into a `ScoreInput` (FX to USD, Altman Z, interest coverage) |
| `engine.test.ts` | Unit tests (rich, sparse, bank, negative and missing P/E, determinism, FX) |

The methodology was ported from an earlier private project and is numerically identical to it. The code, names, types, wording and tests are SilverNote's own.

## 1. Inputs

`buildScoreInput` assembles one `ScoreInput` per company:

- **Statements** — up to 12 annual and 16 quarterly periods from SEC XBRL `companyfacts`, standardized by `src/lib/finance/sec-standardize.ts`, plus a trailing-twelve-month view. Foreign filers' figures are converted to USD at the current rate; if no rate is available, the fundamentals are not scored rather than scored in the wrong currency.
- **Market data** — price, market value, 52-week range and one year of daily candles (Nasdaq), SPY candles for beta, and moving averages.
- **Ratios** — margins, returns, leverage, liquidity and valuation multiples derived from the statements and the price.
- **Optional** — forward P/E, PEG and growth estimates when Finnhub is configured, and sector medians from the universe.

## 2. Metric normalization

Each metric is mapped to a 0–1 value by one of five curves (`normalization.ts`):

| Curve | Behaviour | Example |
|---|---|---|
| `scoreHigher(v, weak, strong)` | Linear from 0 at *weak* to 1 at *strong* | Gross margin: 18% → 0, 62% → 1 |
| `scoreLower(v, strong, weak)` | Linear from 1 at *strong* to 0 at *weak* | Debt/equity: 0.35 → 1, 2.6 → 0 |
| `scoreRange(v, lowIdeal, highIdeal, lowWeak, highWeak)` | 1 inside the ideal band, fading to 0 at either weak bound | Current ratio: ideal 1.2–2.6, zero below 0.65 or above 5 |
| `scoreReasonableLower(v, attractive, expensive, floor)` | Lower is better, but non-positive multiples score 0 and anything under the distress floor is capped at 0.58: cheap is not automatically good | P/E: 18 → 1, 65 → 0, capped below 5 |
| `scoreGrowth(v)` | 0 below −25%, then linear from −5% (0) to +25% (1) | Revenue growth |

A metric with no data is **unavailable**, never zero; missing evidence is handled by shrinkage toward a prior in step 4.

## 3. Evidence groups

About 70 metrics are organized into eight evidence groups. A group's weight scales every metric inside it (a metric's effective weight is *group weight × metric weight*):

| Group | Weight | Main metrics (★ = required) |
|---|---:|---|
| Financial strength | 18 | Debt/equity ★, net debt/EBITDA ★, current ratio ★, quick ratio, cash/current liabilities, FCF/total debt ★, interest coverage, debt trend. Banks use capital ratio ★, equity/assets ★, ROA ★, ROE, profitable years ★ and capital trend instead |
| Profitability & efficiency | 18 | Gross ★, operating ★, EBITDA and net ★ margins; ROE, ROA, ROIC; asset turnover; net-margin trend |
| Growth quality | 18 | Revenue growth 1Y ★ and 3Y CAGR ★, EPS growth 1Y and 3Y CAGR, FCF growth ★, EBITDA growth, forward revenue/EPS growth, growth consistency, cash-backed growth |
| Valuation | 16 | P/E ★ (skipped when earnings are negative, with P/S taking its weight), forward P/E, PEG, P/S ★ (band depends on margins), P/B, EV/EBITDA, EV/sales, P/FCF ★, FCF yield ★, earnings yield, quality-adjusted valuation |
| Market momentum | 10 | 1/3/6/12-month returns, moving-average structure (price vs 50/200-day), distance from 52-week high, volume trend |
| Risk & stability | 10 | Beta (ideal 0.55–1.1), annualized and downside volatility, maximum drawdown, earnings and revenue volatility, balance-sheet risk, Altman Z-score |
| Earnings quality | 5 | FCF/net income ★, operating cash flow/net income ★, accrual ratio, share-count trend, cash-conversion consistency |
| Data quality | 5 | Core field coverage ★, statement coverage ★, quote freshness, years of history, sector context, analyst estimates, source completeness |

## 4. Components

Ten components form the visible breakdown. The score rates the *business*, so fundamentals carry ~88% of the weight and price-driven signals (momentum, most of risk) only ~12%. Each component takes a defined subset of metrics, with overlap kept small (see `selectComponentMetrics` in `engine.ts`):

| Component | Weight | Draws on |
|---|---:|---|
| Growth | 15 | Growth quality |
| Profitability | 15 | Margins, ROE (skipped on negative equity), ROA, ROIC, margin trend |
| Financial health | 13 | Financial strength |
| Valuation | 12 | Valuation |
| Earnings quality | 11 | Cash conversion, accruals, dilution |
| Competitive position | 10 | Market scale, gross margin, ROIC, 3Y revenue CAGR, growth consistency |
| Future outlook | 8 | Forward estimates, multi-year growth, cash-backed growth, margin trend, PEG |
| Efficiency | 7 | Asset turnover, ROA, cash-conversion consistency |
| Risk | 6 | Risk & stability + FCF debt coverage, interest coverage |
| Momentum | 3 | Market momentum |

### Sector-aware bands

Margins, ROA, asset turnover, debt/equity and net debt/EBITDA are scored on bands that depend on the business model (`sectorBands` in `metrics.ts`): retailers/distributors, utilities, real estate, consumer staples and industrials/materials/energy each get their own scale; everything else uses the default. A 6% operating margin is excellent for a grocer and weak for software.

### Missing data

Weights sum to 100. A component score is:

```
prior = 0.40                         (unknown is treated as slightly below average)
reliability = 0.7 × share of metric weight available + 0.3 × share of required metrics available
score = prior + (weighted mean of available metrics − prior) × reliability, × 100, rounded
```

Thin data pulls a component toward 40 — it can't look flattering, but a coverage gap (no analyst estimates, short price history) no longer reads as a collapse in the business.

## 5. Overall score, label and confidence

- **Overall** = weighted mean of the ten component scores (0–100, rounded), then capped by red flags that rest on real evidence (component confidence above Insufficient):
  - Financial health below 25 → overall capped at 45
  - Earnings quality below 25 → capped at 55
  - Profitability below 15 → capped at 50

  A triggered cap is listed first among the watch items.
- **Label**: 85+ Excellent · 75–84 Strong · 65–74 Good · 50–64 Mixed · below 50 Weak.
- **Component confidence** comes from blended coverage (62% metric-weight coverage + 38% required coverage): ≥ 0.82 High, ≥ 0.62 Medium, ≥ 0.34 Low, otherwise Insufficient.
- **Overall confidence** is the weight-averaged confidence rank (Insufficient 0 … High 3): ≥ 2.55 High, ≥ 1.75 Medium, ≥ 0.85 Low.
- The result also lists up to three strengths (components scoring 70+), up to three weaknesses (below 65), the three components to watch, every missing input with the reason, and the sources used.

## 6. Where it runs

- **Universe scores** — a weekly background job (`src/lib/jobs.ts`) scores every company with SEC fundamentals, largest first, including large foreign filers.
- **Detailed scores** — opening a company computes a fresh score from full statements (about a second) and stores it with a history row, which drives trend lines and score alerts.
- **In the UI** — score rings everywhere (hover for the component breakdown), the company **Score** tab (components, every metric with its raw value, normalized value, weight and source, and the history), explorer columns and sector-relative ranks, heatmap mode, peer comparisons and the pitch builder.

## 7. Using it well

The score summarizes what filings and prices already say. It cannot see management quality, product cycles, regulation, litigation, or anything that hasn't reached the numbers yet. Use it to rank and to find questions, then write the answers into the company workspace (thesis, drivers, risks and "what would prove me wrong").
