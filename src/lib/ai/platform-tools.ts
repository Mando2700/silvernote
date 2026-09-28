import 'server-only';

import { money } from '@/lib/ai/context';
import { strategySchema } from '@/lib/backtest-schema';
import { q, q1 } from '@/lib/db';
import { PRICE_FIELDS, SCORE_FIELDS } from '@/lib/finance/backtest';
import { fade, runDcf, sensitivity, waccFromInputs, type DcfAssumptions } from '@/lib/finance/dcf';
import { simulate, type MonteCarloResult } from '@/lib/finance/montecarlo';
import { pct } from '@/lib/format';
import { listAlertEvents, listAlerts } from '@/lib/services/alerts';
import { runStrategy } from '@/lib/services/backtest';
import { getBondPortfolio } from '@/lib/services/bonds';
import { getDcfInputs } from '@/lib/services/dcf';
import { getHoldings, getTransactions, listPortfolios, performanceHistory, riskFreeFor, type PortfolioRow } from '@/lib/services/portfolio';
import { getDetailedScore, getScoreHistory } from '@/lib/services/scores';
import { applyChanges, monteCarloModel, runStressTests, type SimFunding } from '@/lib/services/simulations';
import { getTaxReport } from '@/lib/services/tax';

import type { ToolContext, ToolDefinition } from '@/lib/ai/tools';

/**
 * Read access to the rest of the investor's SilverNote workspace (notes, theses, pitches, watchlists, alerts,
 * portfolio reports) plus the platform's models (Monte Carlo, DCF, backtests). All read-only: nothing here writes.
 */
const portfolioParam = { type: 'string', description: 'Portfolio id (uuid). Omit for the portfolio in view (or their first).' };
const changesParam = {
  type: 'array',
  description: 'Optional hypothetical trades applied first: [{symbol, amount}] in USD, negative sells.',
  items: { type: 'object', properties: { symbol: { type: 'string' }, amount: { type: 'number' } }, required: ['symbol', 'amount'] },
};
const conditionSchema = {
  type: 'object',
  properties: {
    field: { type: 'string', enum: [...SCORE_FIELDS, ...PRICE_FIELDS] },
    op: { type: 'string', enum: ['gt', 'lt', 'rising', 'falling', 'top', 'bottom'] },
    value: { type: 'number', description: 'Threshold for gt/lt (scores 0–100, returns as decimals, marketCap in $B), minimum change for rising/falling, percent of names for top/bottom.' },
    lookback: { type: 'integer', description: 'Months for rising/falling, default 1.' },
  },
  required: ['field', 'op'],
};

export const PLATFORM_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_notes',
    description:
      "The investor's own research notes. Without note_id: search/list notes (title, tags, ticker, snippet, id); when 5 or fewer match, full text is included. With note_id: the full note. Use whenever they refer to their notes, ideas, or what they wrote.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find in titles or bodies.' },
        symbol: { type: 'string', description: 'Only notes tagged to this ticker.' },
        note_id: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_research',
    description:
      "The investor's company workspaces and theses. Without symbol: every covered company (stance, conviction, target, score, last thesis edit) and the recent thesis change log. With symbol: stance/conviction/target/horizon, the current text of every thesis section, the change log, and linked notes.",
    parameters: { type: 'object', properties: { symbol: { type: 'string' } } },
  },
  {
    type: 'function',
    name: 'get_pitches',
    description: "The investor's stock pitches. Without pitch_id: list them. With pitch_id: recommendation, target and every section's text.",
    parameters: { type: 'object', properties: { pitch_id: { type: 'string' } } },
  },
  {
    type: 'function',
    name: 'get_watchlists',
    description: 'All watchlists with their tickers, per-item notes/tags, price when added, current price and move since added.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_alerts',
    description: 'Price and score alerts the investor has set, plus the most recent triggered alert events.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_portfolio_report',
    description:
      'Deeper portfolio reports. section: performance (time-weighted return vs benchmark over standard windows, monthly returns), transactions (trade ledger), tax (realized/unrealized by term, estimated tax, loss-harvesting ideas, wash sales), bonds (bond holdings, yields, duration, rate shocks), stress (2008 / 2020 / 2022 replays with per-holding damage).',
    parameters: {
      type: 'object',
      properties: { portfolio_id: portfolioParam, section: { type: 'string', enum: ['performance', 'transactions', 'tax', 'bonds', 'stress'] } },
      required: ['section'],
    },
  },
  {
    type: 'function',
    name: 'run_monte_carlo',
    description:
      "Monte Carlo projection of the investor's portfolio (same engine as the Simulations page): resamples monthly blocks of up to 10 years of the holdings' daily returns (or lognormal). Returns percentile values by year, probability of loss / of hitting a target, median CAGR and drawdowns. Pass changes to also project a hypothetical version side by side.",
    parameters: {
      type: 'object',
      properties: {
        portfolio_id: portfolioParam,
        years: { type: 'number', description: 'Horizon, default 10, up to 40.' },
        monthly_contribution: { type: 'number', description: 'USD added each month, default 0.' },
        target: { type: 'number', description: 'Goal value in USD to compute the probability of reaching.' },
        method: { type: 'string', enum: ['bootstrap', 'normal'], description: 'Default bootstrap.' },
        expected_return: {
          type: 'string',
          description:
            'Annual return the paths are centred on: "blended" (default: 75% CAPM-implied + 25% own history), "implied", "historical", or a decimal like "0.07".',
        },
        simulations: { type: 'integer', description: 'Default 5000, up to 20000.' },
        changes: changesParam,
        funding: { type: 'string', enum: ['new_money', 'cash', 'trim'], description: 'How net buys in changes are funded; default new_money.' },
      },
    },
  },
  {
    type: 'function',
    name: 'run_dcf',
    description:
      "Discounted cash flow valuation (same model as the company DCF tab: 5-year FCFF, Gordon terminal value, CAPM WACC). Starts from SilverNote's defaults (analyst/historical growth fading to terminal, margins, reinvestment, balance-sheet bridge); override any assumption. Returns value per share vs price, EV, terminal share, the yearly forecast, and a WACC × terminal-growth sensitivity grid.",
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        scenario: { type: 'string', enum: ['bear', 'base', 'bull'], description: 'Default base. Bear halves growth above terminal and trims 3pts off the final margin; bull +40% growth, +5pts margin.' },
        growth: { type: 'array', items: { type: 'number' }, description: 'Revenue growth for years 1–5 as decimals.' },
        ebit_margin: { type: 'array', items: { type: 'number' }, description: 'EBIT margin for years 1–5 as decimals.' },
        target_margin: { type: 'number', description: 'Fade EBIT margin from today to this by year 5.' },
        wacc: { type: 'number', description: 'Override the discount rate (decimal).' },
        terminal_growth: { type: 'number', description: 'Decimal, default 0.025.' },
        tax_rate: { type: 'number' },
        capex_pct_revenue: { type: 'number' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'get_score',
    description: 'Full SilverNote Score breakdown for a ticker: overall, label, confidence, every sub-score, strengths, weaknesses, watch items, missing data, and score history.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    type: 'function',
    name: 'list_saved',
    description: "The investor's saved screener screens and saved backtest strategies (with their definitions and ids).",
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'run_backtest',
    description:
      'Backtest a rules-based strategy over the SilverNote Score history panel (monthly, point-in-time). Pass strategy_id of a saved strategy, or a strategy. Returns CAGR, volatility, Sharpe, drawdown, alpha/beta vs benchmark, yearly returns, trade stats and current picks.',
    parameters: {
      type: 'object',
      properties: {
        strategy_id: { type: 'string' },
        strategy: {
          type: 'object',
          properties: {
            entry: { type: 'array', items: conditionSchema, description: 'All must hold to buy.' },
            exit: { type: 'array', items: conditionSchema, description: 'Any triggers a sell; empty = sell when entry stops holding.' },
            rebalance: { type: 'integer', enum: [1, 3, 6, 12], description: 'Months between rebalances.' },
            maxPositions: { type: 'integer' },
            rankBy: { type: 'string', enum: [...SCORE_FIELDS, ...PRICE_FIELDS] },
            weighting: { type: 'string', enum: ['equal', 'signal'] },
            costBps: { type: 'number', description: 'One-way cost in bps, e.g. 10.' },
            start: { type: 'string', description: 'YYYY-MM-DD' },
            end: { type: 'string', description: 'YYYY-MM-DD' },
            minMarketCap: { type: 'number', description: '$ billions.' },
            sectors: { type: 'array', items: { type: 'string' } },
          },
          required: ['entry', 'exit', 'rebalance', 'maxPositions', 'rankBy', 'weighting', 'costBps'],
        },
      },
    },
  },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const upper = (value: unknown) => String(value ?? '').trim().toUpperCase().replace('$', '');
const day = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : 'n/a');
const clip = (text: string | null | undefined, max: number) => (!text ? '' : text.length > max ? `${text.slice(0, max)}…(truncated)` : text);

export async function resolvePortfolio(ctx: ToolContext, requested: unknown): Promise<{ all: PortfolioRow[]; portfolio: PortfolioRow | null }> {
  const all = await listPortfolios(ctx.userId);
  if (!all.length) return { all, portfolio: null };
  const id = typeof requested === 'string' && UUID.test(requested) ? requested : ctx.portfolioId;
  return { all, portfolio: all.find((portfolio) => portfolio.id === id) ?? all[0] };
}

export async function riskFreeForUser(userId: string) {
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [userId]);
  return riskFreeFor(settings?.data?.riskFreeRate);
}

export function parseChanges(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((change) => ({ symbol: upper((change as { symbol?: unknown }).symbol), amount: Number((change as { amount?: unknown }).amount) }))
    .filter((change) => change.symbol && Number.isFinite(change.amount) && change.amount !== 0)
    .slice(0, 25);
}

// ─── Notes, research, pitches ───────────────────────────────────────────────

type NoteRow = { id: string; symbol: string | null; title: string; content: string; tags: string[]; pinned: boolean; updated_at: Date };

async function getNotes(ctx: ToolContext, args: Record<string, unknown>) {
  const noteLine = (note: NoteRow) => `${note.title || '(untitled)'} · id ${note.id}${note.symbol ? ` · ${note.symbol}` : ''}${note.tags.length ? ` · tags ${note.tags.join(', ')}` : ''}${note.pinned ? ' · pinned' : ''} · updated ${day(note.updated_at)}`;
  if (typeof args.note_id === 'string' && UUID.test(args.note_id)) {
    const note = await q1<NoteRow>('select id, symbol, title, content, tags, pinned, updated_at from public.notes where id = $1 and user_id = $2', [args.note_id, ctx.userId]);
    return note ? `NOTE: ${noteLine(note)}\n${clip(note.content, 20_000)}` : 'Note not found.';
  }
  const symbol = args.symbol ? upper(args.symbol) : null;
  const term = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : null;
  const notes = await q<NoteRow>(
    `select id, symbol, title, content, tags, pinned, updated_at from public.notes
     where user_id = $1 and ($2::text is null or symbol = $2) and ($3::text is null or title ilike '%' || $3 || '%' or content ilike '%' || $3 || '%' or $3 = any(tags))
     order by pinned desc, updated_at desc limit 60`,
    [ctx.userId, symbol, term],
  );
  if (!notes.length) return term || symbol ? 'No notes matched.' : 'The investor has no notes yet.';
  if (notes.length <= 5) return notes.map((note) => `NOTE: ${noteLine(note)}\n${clip(note.content, 8_000)}`).join('\n\n');
  return [`${notes.length} notes${notes.length === 60 ? ' (showing the 60 most recent)' : ''}. Call get_notes with note_id for full text.`, ...notes.map((note) => `- ${noteLine(note)} — ${clip(note.content.replace(/\s+/g, ' '), 220)}`)].join('\n');
}

async function getResearch(ctx: ToolContext, args: Record<string, unknown>) {
  const symbol = args.symbol ? upper(args.symbol) : null;
  if (!symbol) {
    const [workspaces, activity] = await Promise.all([
      q<{ symbol: string; name: string | null; stance: string; conviction: number; target_price: number | null; price: number | null; score: number | null; status: string; last_commit: Date | null }>(
        `select w.symbol, s.name, w.stance, w.conviction, w.target_price, s.price, sc.overall as score, w.status,
           (select max(created_at) from public.thesis_versions v where v.user_id = w.user_id and v.symbol = w.symbol) as last_commit
         from public.workspaces w left join public.securities s on s.symbol = w.symbol left join public.scores sc on sc.symbol = w.symbol
         where w.user_id = $1 order by w.updated_at desc`,
        [ctx.userId],
      ),
      q<{ symbol: string; section: string; change_note: string | null; created_at: Date }>(
        'select symbol, section, change_note, created_at from public.thesis_versions where user_id = $1 order by created_at desc limit 25',
        [ctx.userId],
      ),
    ]);
    if (!workspaces.length) return 'The investor has no company workspaces yet.';
    return [
      'COVERED COMPANIES (symbol · stance · conviction/5 · target vs price · score · status · last thesis edit):',
      ...workspaces.map(
        (row) =>
          `- ${row.symbol} (${row.name ?? 'n/a'}) · ${row.stance} · ${row.conviction}/5 · target ${row.target_price ?? 'n/a'}${row.target_price && row.price ? ` vs ${row.price} (${pct(row.target_price / row.price - 1)})` : ''} · score ${row.score ?? 'n/a'} · ${row.status} · ${day(row.last_commit)}`,
      ),
      'RECENT THESIS EDITS:',
      ...activity.map((row) => `- ${day(row.created_at)} ${row.symbol} ${row.section}${row.change_note ? `: ${row.change_note}` : ''}`),
    ].join('\n');
  }
  const [meta, versions, notes] = await Promise.all([
    q1<{ stance: string; conviction: number; target_price: number | null; horizon: string | null; status: string }>(
      'select stance, conviction, target_price, horizon, status from public.workspaces where user_id = $1 and symbol = $2',
      [ctx.userId, symbol],
    ),
    q<{ section: string; content: string; change_note: string | null; stance: string | null; conviction: number | null; target_price: number | null; price_at: number | null; created_at: Date }>(
      'select section, content, change_note, stance, conviction, target_price, price_at, created_at from public.thesis_versions where user_id = $1 and symbol = $2 order by created_at desc limit 200',
      [ctx.userId, symbol],
    ),
    q<{ id: string; title: string; updated_at: Date }>('select id, title, updated_at from public.notes where user_id = $1 and symbol = $2 order by pinned desc, updated_at desc limit 30', [ctx.userId, symbol]),
  ]);
  if (!meta && !versions.length && !notes.length) return `No workspace, thesis or notes for ${symbol}.`;
  const current = new Map<string, (typeof versions)[number]>();
  for (const version of versions) if (!current.has(version.section)) current.set(version.section, version);
  return [
    `WORKSPACE ${symbol}: stance ${meta?.stance ?? 'n/a'}, conviction ${meta?.conviction ?? 'n/a'}/5, target ${meta?.target_price ?? 'n/a'}, horizon ${meta?.horizon ?? 'n/a'}, status ${meta?.status ?? 'n/a'}`,
    ...[...current.values()].map((version) => `## ${version.section} (last edited ${day(version.created_at)})\n${clip(version.content, 6_000)}`),
    'THESIS CHANGE LOG (newest first):',
    ...versions
      .slice(0, 30)
      .map((version) => `- ${day(version.created_at)} ${version.section}${version.change_note ? `: ${version.change_note}` : ''}${version.price_at ? ` (price then ${version.price_at})` : ''}${version.stance ? ` · stance ${version.stance}` : ''}`),
    notes.length ? `NOTES ON ${symbol}: ${notes.map((note) => `${note.title || '(untitled)'} (id ${note.id}, ${day(note.updated_at)})`).join('; ')}` : `No notes on ${symbol}.`,
  ].join('\n');
}

async function getPitches(ctx: ToolContext, args: Record<string, unknown>) {
  if (typeof args.pitch_id === 'string' && UUID.test(args.pitch_id)) {
    const pitch = await q1<{ symbol: string; title: string; recommendation: string; target_price: number | null; updated_at: Date; sections: Array<{ title: string; content: string; included: boolean }> }>(
      'select symbol, title, recommendation, target_price, updated_at, sections from public.pitches where id = $1 and user_id = $2',
      [args.pitch_id, ctx.userId],
    );
    if (!pitch) return 'Pitch not found.';
    return [
      `PITCH: ${pitch.title} · ${pitch.symbol} · ${pitch.recommendation} · target ${pitch.target_price ?? 'n/a'} · updated ${day(pitch.updated_at)}`,
      ...pitch.sections.map((section) => `## ${section.title}${section.included ? '' : ' (excluded)'}\n${clip(section.content, 5_000)}`),
    ].join('\n');
  }
  const pitches = await q<{ id: string; symbol: string; title: string; recommendation: string; target_price: number | null; price: number | null; updated_at: Date }>(
    `select p.id, p.symbol, p.title, p.recommendation, p.target_price, s.price, p.updated_at from public.pitches p
     left join public.securities s on s.symbol = p.symbol where p.user_id = $1 order by p.updated_at desc`,
    [ctx.userId],
  );
  if (!pitches.length) return 'The investor has no pitches yet.';
  return pitches.map((pitch) => `- ${pitch.title} · id ${pitch.id} · ${pitch.symbol} · ${pitch.recommendation} · target ${pitch.target_price ?? 'n/a'} (price ${pitch.price ?? 'n/a'}) · updated ${day(pitch.updated_at)}`).join('\n');
}

// ─── Watchlists and alerts ──────────────────────────────────────────────────

async function getWatchlists(ctx: ToolContext) {
  const rows = await q<{ list: string; description: string | null; symbol: string | null; note: string | null; tags: string[] | null; added_price: number | null; added_at: Date | null; price: number | null; score: number | null }>(
    `select w.name as list, w.description, i.symbol, i.note, i.tags, i.added_price, i.added_at, s.price, sc.overall as score
     from public.watchlists w left join public.watchlist_items i on i.watchlist_id = w.id
     left join public.securities s on s.symbol = i.symbol left join public.scores sc on sc.symbol = i.symbol
     where w.user_id = $1 order by w.position, w.created_at, i.position`,
    [ctx.userId],
  );
  if (!rows.length) return 'The investor has no watchlists.';
  const lists = new Map<string, string[]>();
  for (const row of rows) {
    const lines = lists.get(row.list) ?? [`WATCHLIST ${row.list}${row.description ? ` — ${row.description}` : ''}:`];
    if (row.symbol) {
      const since = row.added_price && row.price ? pct(row.price / row.added_price - 1) : 'n/a';
      lines.push(`- ${row.symbol} · price ${row.price ?? 'n/a'} · since added ${since} (${day(row.added_at)}) · score ${row.score ?? 'n/a'}${row.tags?.length ? ` · tags ${row.tags.join(', ')}` : ''}${row.note ? ` · note: ${clip(row.note, 200)}` : ''}`);
    }
    lists.set(row.list, lines);
  }
  return [...lists.values()].map((lines) => (lines.length === 1 ? `${lines[0]} (empty)` : lines.join('\n'))).join('\n\n');
}

async function getAlerts(ctx: ToolContext) {
  const [alerts, events] = await Promise.all([listAlerts(ctx.userId), listAlertEvents(ctx.userId, 20)]);
  return [
    alerts.length ? 'ALERTS:' : 'No alerts set.',
    ...alerts.map((alert) => `- ${alert.symbol} ${alert.kind} ${alert.threshold} · ${alert.active ? 'active' : 'paused'}${alert.triggered_at ? ` · last triggered ${day(alert.triggered_at)}` : ''}${alert.note ? ` · ${alert.note}` : ''}`),
    events.length ? 'RECENT ALERT EVENTS:' : '',
    ...events.map((event) => `- ${day(event.created_at)} ${event.symbol}: ${event.message}`),
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Portfolio reports ──────────────────────────────────────────────────────

async function portfolioReport(ctx: ToolContext, args: Record<string, unknown>) {
  const { portfolio } = await resolvePortfolio(ctx, args.portfolio_id);
  if (!portfolio) return 'The investor has no portfolios yet.';
  const head = `PORTFOLIO ${portfolio.name} (id ${portfolio.id}), benchmark ${portfolio.benchmark}`;
  switch (args.section) {
    case 'performance': {
      const points = await performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark);
      if (points.length < 2) return `${head}: not enough history.`;
      const last = points[points.length - 1];
      const at = (daysBack: number) => {
        const cutoff = last.t - daysBack * 86_400;
        return [...points].reverse().find((point) => point.t <= cutoff) ?? null;
      };
      // Last close of the prior year, or the first day when the account opened this year.
      const ytdStart = [...points].reverse().find((point) => new Date(point.t * 1000).getUTCFullYear() < new Date(last.t * 1000).getUTCFullYear()) ?? points[0];
      const window = (label: string, start: (typeof points)[number] | null) =>
        start ? `${label}: portfolio ${pct(last.twr / start.twr - 1)} vs ${portfolio.benchmark} ${pct(last.benchmark / start.benchmark - 1)}` : `${label}: n/a`;
      const monthEnds = new Map<string, (typeof points)[number]>();
      for (const point of points) monthEnds.set(new Date(point.t * 1000).toISOString().slice(0, 7), point);
      const months = [...monthEnds.entries()];
      const monthly = months.slice(1).map(([month, point], index) => `${month} ${pct(point.twr / months[index][1].twr - 1)} (bm ${pct(point.benchmark / months[index][1].benchmark - 1)})`);
      return [
        `${head}. Time-weighted returns (trades and cash flows neutralised); value now ${money(last.value)}, net invested ${money(last.invested)}; history from ${day(new Date(points[0].t * 1000))}.`,
        [window('1M', at(30)), window('3M', at(91)), window('YTD', ytdStart), window('1Y', at(365)), window('3Y', at(365 * 3)), window('Since inception', points[0])].join('\n'),
        `MONTHLY: ${monthly.slice(-36).join(', ')}`,
      ].join('\n');
    }
    case 'transactions': {
      const rows = await getTransactions(portfolio.id);
      return [`${head}. ${rows.length} ledger rows (newest first, share counts in today's split-adjusted units):`, ...rows.slice(0, 150).map((row) => `- ${row.traded_at} ${row.side} ${row.quantity} ${row.symbol} @ ${row.price}${row.fees ? ` fees ${row.fees}` : ''}${row.kind !== 'trade' ? ` (${row.kind})` : ''}${row.note ? ` · ${row.note}` : ''}`)].join('\n');
    }
    case 'tax': {
      const report = await getTaxReport(portfolio, ctx.userId);
      // Every open lot is too much for the model; the harvesting ideas and totals already summarize them.
      const summary = { ...report, lots: undefined, disposals: report.disposals.slice(0, 40) };
      return `${head}. Tax report JSON (amounts USD; disposals = last 40 sales):\n${JSON.stringify(summary)}`;
    }
    case 'bonds': {
      const bonds = await getBondPortfolio(portfolio.id);
      return `${head}. Bond portfolio JSON:\n${JSON.stringify(bonds)}`;
    }
    case 'stress': {
      const { holdings, summary } = await getHoldings(portfolio);
      const scenarios = await runStressTests(holdings.map((holding) => ({ symbol: holding.symbol, value: holding.marketValue })));
      const share = summary.totalValue ? summary.invested / summary.totalValue : 1;
      return [
        `${head}. Stress replays (cash and bonds held flat; 'beta' = holding had no history then, so the market move × its beta is used):`,
        ...scenarios.map(
          (scenario) =>
            `## ${scenario.name} (${scenario.start} → ${scenario.end}): portfolio ${pct(scenario.portfolioReturn * share)} (${money(scenario.portfolioReturn * summary.invested)}), market ${pct(scenario.marketReturn)} via ${scenario.proxy}, max drawdown ${pct(scenario.maxDrawdown)}, worst day ${pct(scenario.worstDay)}\n  hardest hit: ${scenario.holdings
              .slice(0, 8)
              .map((holding) => `${holding.symbol} ${pct(holding.return)} (${holding.method})`)
              .join(', ')}`,
        ),
      ].join('\n');
    }
    default:
      return 'section must be one of performance, transactions, tax, bonds, stress.';
  }
}

// ─── Monte Carlo ────────────────────────────────────────────────────────────

async function runMonteCarlo(ctx: ToolContext, args: Record<string, unknown>) {
  const { portfolio } = await resolvePortfolio(ctx, args.portfolio_id);
  if (!portfolio) return 'The investor has no portfolios yet.';
  const years = Math.max(1, Math.min(40, Number(args.years) || 10));
  const monthlyContribution = Math.max(0, Number(args.monthly_contribution) || 0);
  const target = Number(args.target) > 0 ? Number(args.target) : null;
  const method = args.method === 'normal' ? 'normal' : 'bootstrap';
  const simulations = Math.max(500, Math.min(20_000, Math.round(Number(args.simulations) || 5_000)));
  const [{ holdings, summary }, riskFree] = await Promise.all([getHoldings(portfolio), riskFreeForUser(ctx.userId)]);
  if (!holdings.length) return `${portfolio.name} has no holdings to project.`;

  const project = async (positions: Array<{ symbol: string; marketValue: number }>, totalValue: number) => {
    const model = await monteCarloModel(positions, portfolio.benchmark, totalValue, riskFree);
    if (model.days < 60) return { model, result: null };
    const choice = String(args.expected_return ?? 'blended');
    const annualReturn = choice === 'historical' ? null : choice === 'implied' ? model.impliedReturn : Number.isFinite(Number(choice)) && choice !== '' ? Number(choice) : model.blendedReturn;
    const result = simulate({ weights: model.weights, returns: model.returns, startValue: totalValue, monthlyContribution, years, simulations, method, target, annualReturn, seed: 20260928 });
    return { model, result, annualReturn };
  };
  const describe = (label: string, run: Awaited<ReturnType<typeof project>>) => {
    if (!run.result) return `${label}: not enough price history to simulate.`;
    const result: MonteCarloResult = run.result;
    const checkpoints = [...new Set([1, 3, 5, 10, 20, 30, years].filter((year) => year <= years))];
    const row = (year: number) => {
      const month = Math.min(result.months, Math.round(year * 12));
      const p = result.percentiles;
      return `| ${year}y | ${money(p.p5[month])} | ${money(p.p25[month])} | ${money(p.p50[month])} | ${money(p.p75[month])} | ${money(p.p95[month])} | ${money(result.contributions[month])} |`;
    };
    return [
      `${label}: centred on ${run.annualReturn == null ? `historical return` : `${pct(run.annualReturn)}/yr`} (implied ${pct(run.model.impliedReturn)}, historical ${pct(run.model.historicalReturn)}, beta ${run.model.beta.toFixed(2)}); ${run.model.days} days of history from ${day(new Date((run.model.from ?? 0) * 1000))}${run.model.excluded.length ? `; excluded (no history): ${run.model.excluded.join(', ')}` : ''}.`,
      '| Horizon | 5th pct | 25th | Median | 75th | 95th | Paid in |',
      '|---|---|---|---|---|---|---|',
      ...checkpoints.map(row),
      `Probability of ending below money paid in ${pct(result.probabilityOfLoss)}${result.probabilityOfTarget !== null ? `; of reaching ${money(target)} ${pct(result.probabilityOfTarget)}` : ''}; median CAGR ${Number.isNaN(result.medianCagr) ? 'n/a (contributions)' : pct(result.medianCagr)}; median max drawdown ${pct(result.medianMaxDrawdown)}, 1-in-20 worst ${pct(result.worstMaxDrawdown)}; monthly vol ${pct(result.historicalMonthlyVol)}.`,
    ].join('\n');
  };

  const current = await project(holdings, summary.totalValue);
  const lines = [
    `MONTE CARLO for ${portfolio.name}: ${simulations} paths, ${method}, ${years} years, start ${money(summary.totalValue)} (cash and bonds held flat), ${money(monthlyContribution)}/month contributions.`,
    describe('CURRENT PORTFOLIO', current),
  ];
  const changes = parseChanges(args.changes);
  if (changes.length) {
    const funding: SimFunding = args.funding === 'cash' || args.funding === 'trim' ? args.funding : 'new_money';
    const applied = await applyChanges(holdings, summary.cash, changes, funding);
    const bondsAndCash = summary.totalValue - summary.invested;
    const totalAfter = applied.after.reduce((sum, position) => sum + position.marketValue, 0) + bondsAndCash + (applied.cashAfter - summary.cash);
    lines.push(describe(`WITH CHANGES (${changes.map((change) => `${change.amount > 0 ? '+' : ''}${money(change.amount)} ${change.symbol}`).join(', ')}; funded by ${funding})`, await project(applied.after, totalAfter)));
    if (applied.notes.length) lines.push(`NOTES: ${applied.notes.join(' ')}`);
  }
  lines.push('These are resampled-history projections, not forecasts.');
  return lines.join('\n');
}

// ─── DCF ────────────────────────────────────────────────────────────────────

const DCF_YEARS = 5;

async function runDcfTool(args: Record<string, unknown>) {
  const symbol = upper(args.symbol);
  const data = await getDcfInputs(symbol);
  if (!data.baseRevenue) return `${symbol}: no revenue base to model from.`;
  const d = data.defaults;
  const numbers = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter(Number.isFinite).slice(0, DCF_YEARS) : []);
  const terminal = Number.isFinite(Number(args.terminal_growth)) && args.terminal_growth != null ? Number(args.terminal_growth) : d.terminalGrowth;
  // Same defaults as the DCF tab: analyst growth where covered, then a straight fade to terminal growth.
  const analyst = d.analystGrowth.slice(0, DCF_YEARS);
  let growth = [...analyst, ...fade(analyst.at(-1) ?? d.firstYearGrowth, terminal, DCF_YEARS - analyst.length + 1).slice(analyst.length ? 1 : 0)].slice(0, DCF_YEARS);
  let ebitMargin = fade(d.ebitMargin, args.target_margin != null && Number.isFinite(Number(args.target_margin)) ? Number(args.target_margin) : d.targetMargin, DCF_YEARS);
  const scenario = args.scenario === 'bear' || args.scenario === 'bull' ? args.scenario : 'base';
  if (scenario !== 'base') {
    const [growthScale, marginShift] = scenario === 'bear' ? [0.5, -0.03] : [1.4, 0.05];
    growth = growth.map((value) => (value > terminal ? terminal + (value - terminal) * growthScale : value));
    ebitMargin = ebitMargin.map((margin, index) => margin + (marginShift * index) / (DCF_YEARS - 1));
  }
  const growthOverride = numbers(args.growth);
  const marginOverride = numbers(args.ebit_margin);
  if (growthOverride.length) growth = growth.map((value, index) => growthOverride[index] ?? growthOverride.at(-1) ?? value);
  if (marginOverride.length) ebitMargin = ebitMargin.map((value, index) => marginOverride[index] ?? marginOverride.at(-1) ?? value);
  const taxRate = Number.isFinite(Number(args.tax_rate)) && args.tax_rate != null ? Number(args.tax_rate) : d.taxRate;
  const capital = waccFromInputs({
    riskFree: data.market.riskFree,
    beta: data.market.beta,
    equityRiskPremium: data.market.equityRiskPremium,
    preTaxCostOfDebt: data.market.costOfDebt,
    taxRate,
    marketCap: (data.marketCap ?? 0) / (data.fxToUsd ?? 1),
    debt: data.bridge.debt,
  });
  const wacc = Number(args.wacc) > 0 ? Number(args.wacc) : capital.wacc;
  const assumptions: DcfAssumptions = {
    baseRevenue: data.baseRevenue,
    growth,
    ebitMargin,
    taxRate,
    daPctRevenue: d.daPct,
    capexPctRevenue: Number.isFinite(Number(args.capex_pct_revenue)) && args.capex_pct_revenue != null ? Number(args.capex_pct_revenue) : d.capexPct,
    nwcPctRevenue: d.nwcPct,
    sbcPctRevenue: d.sbcPct,
    deductSbc: true,
    wacc,
    terminalGrowth: terminal,
    midYear: true,
    cash: data.bridge.cash,
    debt: data.bridge.debt,
    leases: data.bridge.leases ?? 0,
    includeLeases: true,
    minorityInterest: data.bridge.minorityInterest ?? 0,
    preferredStock: data.bridge.preferredStock ?? 0,
    shares: data.bridge.shares ?? 0,
  };
  const result = runDcf(assumptions);
  const cur = data.currency;
  const perShareUsd = result.perShare !== null && data.fxToUsd ? result.perShare * data.fxToUsd : null;
  const waccs = [wacc - 0.01, wacc, wacc + 0.01];
  const growths = [terminal - 0.005, terminal, terminal + 0.005];
  const grid = sensitivity(assumptions, waccs, growths);
  return [
    `DCF ${data.name} (${symbol}), ${scenario} case, ${cur}${data.financial ? ' — WARNING: financial company, enterprise DCF does not really apply' : ''}.`,
    `VALUE: ${result.error ? `n/a (${result.error})` : `${result.perShare?.toFixed(2)} ${cur}/share${cur !== 'USD' && perShareUsd ? ` ≈ $${perShareUsd.toFixed(2)}` : ''}`} vs price ${data.price ?? 'n/a'}${perShareUsd && data.price ? ` → ${pct(perShareUsd / data.price - 1)} upside` : ''}. EV ${money(result.enterpriseValue, cur)}, equity ${money(result.equityValue, cur)}, terminal value ${pct(result.terminalShare)} of EV, implied exit EV/EBITDA ${result.impliedExitMultiple?.toFixed(1) ?? 'n/a'}.`,
    `DISCOUNT RATE: WACC ${pct(wacc)}${Number(args.wacc) > 0 ? ' (override)' : ''} (CAPM: rf ${pct(data.market.riskFree)} + beta ${data.market.beta.toFixed(2)} × ERP ${pct(data.market.equityRiskPremium)} = cost of equity ${pct(capital.costOfEquity)}; after-tax debt ${pct(capital.afterTaxDebt)} at ${pct(capital.debtWeight)} weight); terminal growth ${pct(terminal)}.`,
    `BASE: ${data.baseLabel ?? 'latest'} revenue ${money(data.baseRevenue, cur)}; tax ${pct(taxRate)}, D&A ${pct(d.daPct)}, capex ${pct(assumptions.capexPctRevenue)}, NWC ${pct(d.nwcPct)}, SBC ${pct(d.sbcPct)} of revenue (SBC treated as a cost); growth seed: ${data.forecasts.growthSeed}. Bridge: cash ${money(data.bridge.cash, cur)}, debt ${money(data.bridge.debt, cur)}, leases ${money(data.bridge.leases, cur)}, shares ${data.bridge.shares ? `${(data.bridge.shares / 1e6).toFixed(1)}M` : 'n/a'}.`,
    '| Year | Revenue | Growth | EBIT margin | FCF | PV |',
    '|---|---|---|---|---|---|',
    ...result.years.map((year) => `| ${year.year} | ${money(year.revenue, cur)} | ${pct(year.growth)} | ${pct(ebitMargin[year.year - 1])} | ${money(year.fcf, cur)} | ${money(year.presentValue, cur)} |`),
    `SENSITIVITY (${cur}/share; rows WACC, columns terminal growth ${growths.map((g) => pct(g)).join(' / ')}):`,
    ...waccs.map((w, index) => `- WACC ${pct(w)}: ${grid[index].map((value) => (value === null ? 'n/a' : value.toFixed(2))).join(' / ')}`),
    data.history.length ? `HISTORY: ${data.history.map((year) => `${year.label} rev ${money(year.revenue, cur)}, EBIT margin ${pct(year.ebitMargin)}, FCF ${money(year.freeCashFlow, cur)}`).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Scores and backtests ───────────────────────────────────────────────────

async function getScore(args: Record<string, unknown>) {
  const symbol = upper(args.symbol);
  const [score, history] = await Promise.all([getDetailedScore(symbol), getScoreHistory(symbol)]);
  if (!score) return `${symbol}: no SilverNote Score.`;
  return [
    `SILVERNOTE SCORE ${symbol}: ${score.overallScore}/100 (${score.label}, ${score.confidence} confidence, data quality ${score.dataQualityScore}/5, as of ${score.calculatedAt.slice(0, 10)}).`,
    `SUB-SCORES: ${score.subScores.map((item) => `${item.name} ${item.score}`).join(', ')}`,
    `SUMMARY: ${score.shortSummary}`,
    `DETAIL: ${clip(score.detailedDescription.replace(/\n+/g, ' '), 3_000)}`,
    `STRENGTHS: ${score.strengths.join('; ') || 'none'}`,
    `WEAKNESSES: ${score.weaknesses.join('; ') || 'none'}`,
    `WATCH: ${score.watchItems.join('; ') || 'none'}`,
    score.missingData.length ? `MISSING DATA: ${score.missingData.map((item) => JSON.stringify(item)).join('; ')}` : '',
    history.length ? `HISTORY: ${history.slice(-24).map((row) => `${day(row.calculated_at)} ${row.overall}`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function listSaved(ctx: ToolContext) {
  const [screens, strategies] = await Promise.all([
    q<{ id: string; name: string; definition: unknown }>('select id, name, definition from public.saved_screens where user_id = $1 order by updated_at desc', [ctx.userId]),
    q<{ id: string; name: string; definition: unknown }>('select id, name, definition from public.backtest_strategies where user_id = $1 order by updated_at desc', [ctx.userId]),
  ]);
  return [
    screens.length ? 'SAVED SCREENS:' : 'No saved screens.',
    ...screens.map((screen) => `- ${screen.name} (id ${screen.id}): ${clip(JSON.stringify(screen.definition), 1_500)}`),
    strategies.length ? 'SAVED BACKTEST STRATEGIES:' : 'No saved backtest strategies.',
    ...strategies.map((strategy) => `- ${strategy.name} (id ${strategy.id}): ${clip(JSON.stringify(strategy.definition), 1_500)}`),
  ].join('\n');
}

async function runBacktestTool(ctx: ToolContext, args: Record<string, unknown>) {
  let definition: unknown = args.strategy;
  let name = 'custom strategy';
  if (typeof args.strategy_id === 'string' && UUID.test(args.strategy_id)) {
    const saved = await q1<{ name: string; definition: unknown }>('select name, definition from public.backtest_strategies where id = $1 and user_id = $2', [args.strategy_id, ctx.userId]);
    if (!saved) return 'Saved strategy not found.';
    definition = saved.definition;
    name = saved.name;
  }
  const parsed = strategySchema.safeParse(definition);
  if (!parsed.success) return `Invalid strategy: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`;
  const result = await runStrategy(parsed.data, await riskFreeForUser(ctx.userId));
  if (!result) return 'The backtest history panel has not been built yet (Backtest page → build history).';
  const s = result.stats;
  const series = (label: string, stats: typeof result.benchmarkStats) =>
    `| ${label} | ${pct(stats.totalReturn)} | ${pct(stats.cagr)} | ${pct(stats.volatility)} | ${stats.sharpe?.toFixed(2) ?? 'n/a'} | ${pct(stats.maxDrawdown)} |`;
  return [
    `BACKTEST ${name}: ${result.dates[0]} → ${result.dates.at(-1)}, universe ${result.universeSize} names. Rules: ${JSON.stringify(parsed.data)}`,
    '| Series | Total | CAGR | Vol | Sharpe | Max DD |',
    '|---|---|---|---|---|---|',
    series('Strategy', s),
    series('Benchmark', result.benchmarkStats),
    series('Universe (equal weight)', result.universeStats),
    `Sortino ${s.sortino?.toFixed(2) ?? 'n/a'}, beta ${s.beta?.toFixed(2) ?? 'n/a'}, alpha ${pct(s.alpha)}, monthly hit rate vs benchmark ${pct(s.hitRate)}, avg positions ${s.avgPositions.toFixed(1)}, turnover ${pct(s.turnover)}, ${s.trades} trades, win rate ${pct(s.winRate)}, avg trade ${pct(s.avgTradeReturn)}, avg hold ${s.avgHoldMonths?.toFixed(1) ?? 'n/a'} months; max drawdown ${s.maxDrawdownFrom ?? '?'} → ${s.maxDrawdownTo ?? '?'}.`,
    `YEARLY: ${result.yearly.map((year) => `${year.year} ${pct(year.strategy)} (bm ${year.benchmark === null ? 'n/a' : pct(year.benchmark)})`).join(', ')}`,
    `CURRENT PICKS: ${result.picks.slice(0, 25).map((pick) => `${pick.symbol} (score ${pick.overall})`).join(', ') || 'none'}`,
  ].join('\n');
}

/** Runs a platform tool, or returns null when the name isn't one of these. */
export async function runPlatformTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
  switch (name) {
    case 'get_notes':
      return getNotes(ctx, args);
    case 'get_research':
      return getResearch(ctx, args);
    case 'get_pitches':
      return getPitches(ctx, args);
    case 'get_watchlists':
      return getWatchlists(ctx);
    case 'get_alerts':
      return getAlerts(ctx);
    case 'get_portfolio_report':
      return portfolioReport(ctx, args);
    case 'run_monte_carlo':
      return runMonteCarlo(ctx, args);
    case 'run_dcf':
      return runDcfTool(args);
    case 'get_score':
      return getScore(args);
    case 'list_saved':
      return listSaved(ctx);
    case 'run_backtest':
      return runBacktestTool(ctx, args);
    default:
      return null;
  }
}
