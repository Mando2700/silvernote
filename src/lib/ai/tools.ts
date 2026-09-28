import 'server-only';

import { evaluate } from '@/lib/ai/calc';
import { ACTION_TOOLS, isActionTool, proposeAction } from '@/lib/ai/actions';
import { money, portfolioContext, snapshotLine } from '@/lib/ai/context';
import { parseChanges, PLATFORM_TOOLS, resolvePortfolio, riskFreeForUser, runPlatformTool } from '@/lib/ai/platform-tools';
import type { StatementPeriod } from '@/lib/finance/statement-types';
import { pct } from '@/lib/format';
import { getPeerSymbols } from '@/lib/services/market';
import { getHoldings, type PortfolioRow } from '@/lib/services/portfolio';
import { getCandles } from '@/lib/services/prices';
import { getListings, METRIC_KEYS, type MetricKey, type UniverseEntry } from '@/lib/services/screener';
import { simulateChanges, type SimFunding } from '@/lib/services/simulations';
import { getCompanyStatements } from '@/lib/services/statements';

/**
 * Functions Grok can call mid-answer to pull SilverNote data on demand, so questions like
 * "market-cap-weighted 5y revenue CAGR of the 3 biggest peers of X" don't depend on what the
 * pre-built DATA block happened to include.
 */
export type ToolDefinition = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> };

const symbolsParam = { type: 'array', items: { type: 'string' }, description: 'Tickers, e.g. ["MSFT", "CRM"].' };

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_companies',
    description:
      'Snapshot for up to 25 tickers: name, sector/industry, price, market value, latest fiscal-year revenue, revenue growth, 3y revenue CAGR, margins, P/E, P/S, EV/EBITDA, FCF yield, ROE, debt/equity, SilverNote Score.',
    parameters: { type: 'object', properties: { symbols: symbolsParam }, required: ['symbols'] },
  },
  {
    type: 'function',
    name: 'get_peers',
    description: "A company's peer group, sorted by market value (largest first), each with the same snapshot as get_companies.",
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string' }, limit: { type: 'integer', description: 'Max peers, default 10, up to 20.' } },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'get_financials',
    description:
      'Reported financial statements (SEC XBRL, FMP fallback) for one or more tickers: annual or quarterly periods, newest first, with income, balance-sheet, cash-flow items and margins. Use for multi-year growth, CAGR, margins trends, etc.',
    parameters: {
      type: 'object',
      properties: {
        symbols: symbolsParam,
        frequency: { type: 'string', enum: ['annual', 'quarterly'], description: 'Default annual.' },
        periods: { type: 'integer', description: 'How many periods per company, default 6, up to 12.' },
        items: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Line items to return, e.g. ["revenue","operatingIncome","freeCashFlow"]. Omit for a standard set. Available: revenue, grossProfit, operatingIncome, netIncome, epsDiluted, sharesDiluted, ebitda, researchAndDevelopment, operatingCashFlow, capex, freeCashFlow, stockBasedCompensation, buybacks, dividendsPaid, acquisitions, cash, totalDebt, netDebt, totalAssets, totalEquity, deferredRevenue, grossMargin, operatingMargin, netMargin, fcfMargin, and more.',
        },
      },
      required: ['symbols'],
    },
  },
  {
    type: 'function',
    name: 'screen',
    description: `Screen the US stock universe. Filter by sector/industry text and metric ranges, sort by any metric. Metrics: ${METRIC_KEYS.join(', ')}. Ratios are decimals (0.15 = 15%); marketCap/revenue in USD.`,
    parameters: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'Case-insensitive substring match on sector.' },
        industry: { type: 'string', description: 'Case-insensitive substring match on industry.' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { metric: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } },
            required: ['metric'],
          },
        },
        sort_by: { type: 'string', description: 'Metric to sort by, default marketCap.' },
        order: { type: 'string', enum: ['desc', 'asc'] },
        limit: { type: 'integer', description: 'Default 15, up to 40.' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_price_history',
    description: 'Split-adjusted daily closes for tickers (up to 10 years): total return and annualized return over the window, max drawdown, plus month-end closes.',
    parameters: {
      type: 'object',
      properties: {
        symbols: symbolsParam,
        from: { type: 'string', description: 'Start date YYYY-MM-DD, default 1 year ago.' },
        to: { type: 'string', description: 'End date YYYY-MM-DD, default today.' },
      },
      required: ['symbols'],
    },
  },
  {
    type: 'function',
    name: 'get_portfolio',
    description:
      "The investor's portfolio: every holding with shares, cost, value, weight, P&L, sector and SilverNote Score, sector exposure, and risk stats (return, volatility, beta, Sharpe, drawdown, VaR, risk contributions). Also lists all their portfolios by id. Omit portfolio_id for the one in view (or their first).",
    parameters: { type: 'object', properties: { portfolio_id: { type: 'string', description: 'Portfolio id (uuid) from a previous get_portfolio call.' } } },
  },
  {
    type: 'function',
    name: 'simulate_portfolio',
    description:
      'Hypothetical only — never trades. Applies dollar buys (positive amount) and sells (negative) to the investor\'s real portfolio and compares before vs after: risk stats over the last 2 years at the new weights, concentration, sector weights, weighted fundamentals (P/E, growth, margins, FCF yield, Score), stress tests (2008, 2020, 2022), and per changed name its correlation with the current portfolio, beta, volatility and share of risk. Use it for "what if I add/trim X" questions.',
    parameters: {
      type: 'object',
      properties: {
        portfolio_id: { type: 'string', description: 'Omit for the portfolio in view (or their first).' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { symbol: { type: 'string' }, amount: { type: 'number', description: 'USD. Positive buys, negative sells.' } },
            required: ['symbol', 'amount'],
          },
        },
        funding: {
          type: 'string',
          enum: ['new_money', 'cash', 'trim'],
          description: 'How net buys are paid for: new_money (default, deposit on top), cash (from the portfolio cash balance), trim (sell the untouched holdings pro rata, total unchanged).',
        },
      },
      required: ['changes'],
    },
  },
  {
    type: 'function',
    name: 'calculate',
    description:
      'Exact arithmetic. Evaluate one or more expressions with + - * / ^ %, parentheses, and functions sqrt, ln, log, exp, abs, pow, min, max, sum, avg, round(x, digits), cagr(start, end, years). Use it for every non-trivial computation (weights, CAGRs, weighted averages) instead of doing math in your head.',
    parameters: {
      type: 'object',
      properties: { expressions: { type: 'array', items: { type: 'string' }, description: 'e.g. ["cagr(12.5e9, 21.3e9, 4)", "(0.2*3.1 + 0.15*1.2)/(3.1+1.2)"]' } },
      required: ['expressions'],
    },
  },
  ...PLATFORM_TOOLS,
  ...ACTION_TOOLS,
];

const DEFAULT_ITEMS = ['revenue', 'grossMargin', 'operatingIncome', 'operatingMargin', 'netIncome', 'epsDiluted', 'operatingCashFlow', 'capex', 'freeCashFlow', 'totalDebt', 'cash'];
const RATIOS = new Set(['grossMargin', 'operatingMargin', 'ebitdaMargin', 'netMargin', 'fcfMargin']);

const upper = (value: unknown) => String(value ?? '').trim().toUpperCase().replace('$', '');
const clampInt = (value: unknown, fallback: number, max: number) => Math.max(1, Math.min(max, Math.round(Number(value) || fallback)));
const list = (value: unknown) => (Array.isArray(value) ? value : []).map(upper).filter(Boolean);

async function listingLookup() {
  const listings = await getListings();
  const bySymbol = new Map(listings.map((entry) => [entry.symbol, entry]));
  return (symbol: string) => bySymbol.get(symbol) ?? bySymbol.get(symbol.replace('.', '-')) ?? bySymbol.get(symbol.replace('-', '.'));
}

function formatItem(key: string, value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return `${key} n/a`;
  if (RATIOS.has(key)) return `${key} ${(value * 100).toFixed(1)}%`;
  if (key === 'epsDiluted' || key === 'epsBasic') return `${key} ${value.toFixed(2)}`;
  if (key === 'sharesDiluted') return `${key} ${(value / 1e6).toFixed(1)}M`;
  // Exact figures so Grok can compute from them without rounding drift.
  return `${key} ${money(value, currency)} (${Math.round(value)})`;
}

async function getFinancials(args: Record<string, unknown>) {
  const symbols = list(args.symbols).slice(0, 8);
  const frequency = args.frequency === 'quarterly' ? 'quarterly' : 'annual';
  const periods = clampInt(args.periods, 6, 12);
  const items = Array.isArray(args.items) && args.items.length ? args.items.map(String).slice(0, 20) : DEFAULT_ITEMS;
  const blocks = await Promise.all(
    symbols.map(async (symbol) => {
      const statements = await getCompanyStatements(symbol).catch(() => null);
      const rows: StatementPeriod[] = statements?.[frequency]?.slice(0, periods) ?? [];
      if (!rows.length) return `${symbol}: no ${frequency} statements available.`;
      return [
        `${symbol} ${frequency} (${statements!.currency}, source ${statements!.source}, newest first):`,
        ...rows.map((period) => `- ${period.label} (ended ${period.periodEnd}): ${items.map((key) => formatItem(key, period[key as keyof StatementPeriod] as number | null, period.currency ?? statements!.currency)).join('; ')}`),
      ].join('\n');
    }),
  );
  return blocks.join('\n\n');
}

async function screen(args: Record<string, unknown>) {
  const listings = await getListings();
  const sector = String(args.sector ?? '').toLowerCase();
  const industry = String(args.industry ?? '').toLowerCase();
  const sortBy = (METRIC_KEYS as readonly string[]).includes(String(args.sort_by)) ? (args.sort_by as MetricKey) : 'marketCap';
  const filters = (Array.isArray(args.filters) ? args.filters : []) as Array<{ metric?: string; min?: number; max?: number }>;
  const unknown = filters.filter((filter) => !(METRIC_KEYS as readonly string[]).includes(String(filter.metric)));
  if (unknown.length) return `Unknown metric(s): ${unknown.map((filter) => filter.metric).join(', ')}. Valid: ${METRIC_KEYS.join(', ')}.`;
  const rows = listings
    .filter((entry) => entry.primaryClass)
    .filter((entry) => !sector || (entry.sector ?? '').toLowerCase().includes(sector))
    .filter((entry) => !industry || (entry.industry ?? '').toLowerCase().includes(industry))
    .filter((entry) =>
      filters.every((filter) => {
        const value = entry[filter.metric as MetricKey];
        if (value == null) return false;
        return (filter.min == null || value >= filter.min) && (filter.max == null || value <= filter.max);
      }),
    )
    .filter((entry) => entry[sortBy] != null)
    .sort((a, b) => (args.order === 'asc' ? 1 : -1) * ((a[sortBy] as number) - (b[sortBy] as number)));
  const limit = clampInt(args.limit, 15, 40);
  if (!rows.length) return 'No companies matched.';
  return [`${rows.length} matches, sorted by ${sortBy} ${args.order === 'asc' ? 'ascending' : 'descending'} (showing ${Math.min(limit, rows.length)}):`, ...rows.slice(0, limit).map((entry, index) => `${index + 1}. ${snapshotLine(entry)}`)].join('\n');
}

async function priceHistory(args: Record<string, unknown>) {
  const to = args.to ? new Date(String(args.to)) : new Date();
  const from = args.from ? new Date(String(args.from)) : new Date(to.getTime() - 365 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return 'Invalid date range.';
  const years = Math.min(10, Math.ceil((Date.now() - from.getTime()) / (365.25 * 86_400_000)) + 1);
  const symbols = list(args.symbols).slice(0, 8);
  const blocks = await Promise.all(
    symbols.map(async (symbol) => {
      const candles = await getCandles(symbol, years).catch(() => []);
      const ms = (t: number) => (t < 1e12 ? t * 1000 : t);
      const window = candles.filter((candle) => ms(candle.t) >= from.getTime() && ms(candle.t) <= to.getTime() + 86_400_000);
      if (window.length < 2) return `${symbol}: no price history for that window.`;
      const first = window[0];
      const last = window[window.length - 1];
      const day = (candle: { t: number }) => new Date(ms(candle.t)).toISOString().slice(0, 10);
      const span = (ms(last.t) - ms(first.t)) / (365.25 * 86_400_000);
      let peak = first.c;
      let drawdown = 0;
      const monthEnds = new Map<string, number>();
      for (const candle of window) {
        peak = Math.max(peak, candle.c);
        drawdown = Math.min(drawdown, candle.c / peak - 1);
        monthEnds.set(day(candle).slice(0, 7), candle.c);
      }
      const total = last.c / first.c - 1;
      return [
        `${symbol}: ${day(first)} close ${first.c.toFixed(2)} → ${day(last)} close ${last.c.toFixed(2)}; total return ${(total * 100).toFixed(2)}%${span >= 1 ? `, annualized ${(((1 + total) ** (1 / span) - 1) * 100).toFixed(2)}%` : ''}; max drawdown ${(drawdown * 100).toFixed(2)}%.`,
        `Month-end closes: ${[...monthEnds].slice(-60).map(([month, close]) => `${month} ${close.toFixed(2)}`).join(', ')}`,
      ].join('\n');
    }),
  );
  return blocks.join('\n\n');
}

/** Who is asking, so portfolio tools only ever see that user's data. */
export type ToolContext = { userId: string; portfolioId?: string | null; threadId?: string | null };

const portfolioList = (all: PortfolioRow[], current: PortfolioRow) =>
  `ALL PORTFOLIOS: ${all.map((portfolio) => `${portfolio.name} (id ${portfolio.id})${portfolio.id === current.id ? ' ← this one' : ''}`).join('; ')}`;

/** Value-weighted fundamentals of a set of positions (P/E as the inverse of the weighted earnings yield). */
function weightedFundamentals(positions: Array<{ symbol: string; marketValue: number }>, find: (symbol: string) => UniverseEntry | undefined) {
  const average = (key: MetricKey) => {
    let weight = 0;
    let sum = 0;
    for (const position of positions) {
      const value = find(position.symbol)?.[key];
      if (value == null || !Number.isFinite(value)) continue;
      weight += position.marketValue;
      sum += position.marketValue * value;
    }
    return weight ? sum / weight : null;
  };
  let peWeight = 0;
  let earningsYield = 0;
  for (const position of positions) {
    const pe = find(position.symbol)?.pe;
    if (pe == null || !(pe > 0)) continue;
    peWeight += position.marketValue;
    earningsYield += position.marketValue / pe;
  }
  const score = average('score');
  return `P/E ${peWeight && earningsYield ? (peWeight / earningsYield).toFixed(1) : 'n/a'}, revenue growth ${pct(average('revenueGrowth'))}, 3y revenue CAGR ${pct(average('revenueCagr3'))}, operating margin ${pct(average('operatingMargin'))}, FCF yield ${pct(average('fcfYield'))}, SilverNote Score ${score?.toFixed(0) ?? 'n/a'}`;
}

type Snapshot = Awaited<ReturnType<typeof simulateChanges>>['baseline'];

function snapshotBlock(label: string, snapshot: Snapshot) {
  const stats = snapshot.stats;
  return [
    `${label}: total ${money(snapshot.total)}; ${
      stats
        ? `annualized return ${pct(stats.annualReturn)}, volatility ${pct(stats.volatility)}, beta ${stats.beta?.toFixed(2) ?? 'n/a'}, Sharpe ${stats.sharpe?.toFixed(2) ?? 'n/a'}, Sortino ${stats.sortino?.toFixed(2) ?? 'n/a'}, max drawdown ${pct(stats.maxDrawdown)}, 1-day VaR95 ${pct(stats.var95)}`
        : 'risk stats n/a (too little price history)'
    }`,
    `  concentration: top holding ${pct(snapshot.concentration.top1)}, top 5 ${pct(snapshot.concentration.top5)}, effective # of positions ${snapshot.concentration.effectiveN.toFixed(1)}`,
    `  sectors: ${snapshot.sectors.map((item) => `${item.sector} ${pct(item.weight)}`).join(', ')}`,
    `  stress tests: ${snapshot.stress.map((scenario) => `${scenario.name} ${pct(scenario.portfolioReturn)} (max drawdown ${pct(scenario.maxDrawdown)})`).join('; ') || 'n/a'}`,
    ...(snapshot.excluded.length ? [`  left out of risk stats (short price history): ${snapshot.excluded.join(', ')}`] : []),
  ].join('\n');
}

async function getPortfolioTool(ctx: ToolContext, args: Record<string, unknown>) {
  const { all, portfolio } = await resolvePortfolio(ctx, args.portfolio_id);
  if (!portfolio) return 'The investor has no portfolios yet.';
  const { holdings } = await getHoldings(portfolio);
  const detail = holdings.map(
    (holding) => `- ${holding.symbol} (${holding.name}): ${holding.shares.toFixed(4).replace(/\.?0+$/, '')} sh, avg cost ${holding.avgCost.toFixed(2)}, price ${holding.price?.toFixed(2) ?? 'n/a'}, first bought ${holding.firstBought ?? 'n/a'}`,
  );
  return [portfolioList(all, portfolio), await portfolioContext(ctx.userId, portfolio.id), 'POSITION DETAIL:', ...detail].join('\n');
}

async function simulatePortfolioTool(ctx: ToolContext, args: Record<string, unknown>) {
  const { all, portfolio } = await resolvePortfolio(ctx, args.portfolio_id);
  if (!portfolio) return 'The investor has no portfolios yet, so there is nothing to simulate against.';
  const changes = parseChanges(args.changes);
  if (!changes.length) return 'No valid changes: pass [{symbol, amount}] with amount in USD (negative to sell).';
  const find = await listingLookup();
  const unknown = changes.filter((change) => change.amount > 0 && !find(change.symbol)).map((change) => change.symbol);
  if (unknown.length) return `Not in the SilverNote universe: ${unknown.join(', ')}. Check the tickers.`;
  const funding: SimFunding = args.funding === 'cash' || args.funding === 'trim' ? args.funding : 'new_money';
  const [{ holdings }, riskFree] = await Promise.all([getHoldings(portfolio), riskFreeForUser(ctx.userId)]);
  const result = await simulateChanges(holdings, portfolio.cash ?? 0, portfolio.benchmark, riskFree, changes, funding);
  const fundingText = { new_money: 'new money added on top', cash: 'paid from portfolio cash', trim: 'untouched holdings trimmed pro rata' }[funding];
  return [
    portfolioList(all, portfolio),
    `SIMULATION (hypothetical, nothing traded) on ${portfolio.name}, benchmark ${portfolio.benchmark}. Net flow ${money(result.netFlow)}, ${fundingText}; cash ${money(result.cashBefore)} → ${money(result.cashAfter)}.`,
    'CHANGED NAMES (weight before → after; correlation of daily returns with the rest of the current portfolio over 2y; beta; volatility; share of portfolio variance after):',
    ...result.changes.map(
      (change) =>
        `- ${change.symbol} ${change.amount > 0 ? 'buy' : 'sell'} ${money(Math.abs(change.amount))} · ${change.sector ?? 'n/a'} · ${pct(change.weightBefore)} → ${pct(change.weightAfter)} · corr ${change.correlationToPortfolio?.toFixed(2) ?? 'n/a'} · beta ${change.beta?.toFixed(2) ?? 'n/a'} · vol ${pct(change.volatility)} · risk share ${pct(change.riskContribution)}`,
    ),
    snapshotBlock('BEFORE', result.baseline),
    snapshotBlock('AFTER', result.proposed),
    `WEIGHTED FUNDAMENTALS (stocks only): before ${weightedFundamentals(holdings, find)}; after ${weightedFundamentals(result.positionsAfter, find)}`,
    `HOLDINGS AFTER: ${result.positionsAfter
      .sort((a, b) => b.marketValue - a.marketValue)
      .map((position) => `${position.symbol} ${pct(position.weight)}`)
      .join(', ')}`,
    ...(result.notes.length ? [`NOTES: ${result.notes.join(' ')}`] : []),
    'Risk stats replay the last 2 years of prices at the new weights; they describe past behaviour, not a forecast.',
  ].join('\n');
}

async function run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (name) {
    case 'get_companies': {
      const find = await listingLookup();
      return list(args.symbols)
        .slice(0, 25)
        .map((symbol) => {
          const entry = find(symbol);
          return entry ? `- ${snapshotLine(entry)}` : `- ${symbol}: not in the SilverNote universe.`;
        })
        .join('\n');
    }
    case 'get_peers': {
      const symbol = upper(args.symbol);
      const find = await listingLookup();
      const peers = await getPeerSymbols(symbol, clampInt(args.limit, 10, 20));
      const rows = peers.symbols.map(find).filter((entry): entry is UniverseEntry & { primaryClass: boolean } => Boolean(entry));
      rows.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      if (!rows.length) return `No peers found for ${symbol}.`;
      return [`Peers of ${symbol} (source: ${peers.source}), largest market value first:`, ...rows.map((entry, index) => `${index + 1}. ${snapshotLine(entry)}`)].join('\n');
    }
    case 'get_financials':
      return getFinancials(args);
    case 'screen':
      return screen(args);
    case 'get_price_history':
      return priceHistory(args);
    case 'get_portfolio':
      return getPortfolioTool(ctx, args);
    case 'simulate_portfolio':
      return simulatePortfolioTool(ctx, args);
    case 'calculate':
      return (Array.isArray(args.expressions) ? args.expressions : [])
        .slice(0, 40)
        .map((expression) => {
          try {
            return `${expression} = ${evaluate(String(expression))}`;
          } catch (error) {
            return `${expression} → error: ${(error as Error).message}`;
          }
        })
        .join('\n');
    default:
      return (await runPlatformTool(name, args, ctx)) ?? `Unknown tool ${name}.`;
  }
}

/** Run one tool call from Grok. Never throws: errors go back to the model as text so it can recover. */
export async function runTool(name: string, rawArguments: string, ctx: ToolContext): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
  } catch {
    return 'Arguments were not valid JSON.';
  }
  try {
    const output = isActionTool(name) ? await proposeAction(ctx.userId, ctx.threadId, name, args) : await run(name, args, ctx);
    return output.length > 24_000 ? `${output.slice(0, 24_000)}\n…(truncated)` : output;
  } catch (error) {
    return `Tool ${name} failed: ${(error as Error).message}`;
  }
}
