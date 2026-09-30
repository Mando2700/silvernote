import 'server-only';

import { money } from '@/lib/ai/context';
import { fetchFilingText } from '@/lib/data/providers/sec';
import { todayInNewYork } from '@/lib/dates';
import { pct } from '@/lib/format';
import { getCalendar } from '@/lib/services/calendar';
import { listDecisions } from '@/lib/services/journal';
import { buildComps, runEventStudy } from '@/lib/services/lab';
import { getMacroDashboard, getMacroTape } from '@/lib/services/macro';
import { getCompanyNews, getFilings, getMarketNews } from '@/lib/services/market';
import { getInsiderTrades, getRiskFactorChanges, summarizeInsiders } from '@/lib/services/sec-insights';

import type { ToolContext, ToolDefinition } from '@/lib/ai/tools';

/** Research tools: headlines, filings (list and read), insiders, calendars, macro, comps, event studies, the journal. */
export const RESEARCH_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_news',
    description: 'Recent headlines for one ticker (with dates and sources), or market-wide headlines when symbol is omitted.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'integer', description: 'Default 20, up to 50.' } } },
  },
  {
    type: 'function',
    name: 'get_filings',
    description: 'SEC EDGAR filings for a ticker, newest first: form, filing date, period, 8-K items and the document URL (pass it to read_filing).',
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string' }, forms: { type: 'array', items: { type: 'string' }, description: 'e.g. ["10-K","10-Q","8-K"]; omit for all key forms.' }, limit: { type: 'integer' } },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'read_filing',
    description: 'Plain text of an EDGAR filing (URL from get_filings). Optionally just one 10-K/10-Q section: business, risk_factors, mdna, financial_statements, legal.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' }, section: { type: 'string', enum: ['business', 'risk_factors', 'mdna', 'financial_statements', 'legal'] }, max_chars: { type: 'integer', description: 'Default 20000, up to 60000.' } },
      required: ['url'],
    },
  },
  {
    type: 'function',
    name: 'get_risk_factor_changes',
    description: "What changed in Item 1A (risk factors) between a company's two latest 10-Ks: new, removed and reworded risks.",
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    type: 'function',
    name: 'get_insider_trades',
    description: 'Form 4 insider transactions for a ticker (open-market buys and sells, grants, exercises) with a 180-day net buying summary.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'integer' } }, required: ['symbol'] },
  },
  {
    type: 'function',
    name: 'get_calendar',
    description: "Earnings dates (with consensus EPS), ex-dividend dates and US economic releases between two dates. Flags the investor's own holdings and watchlist names.",
    parameters: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD, default today' }, to: { type: 'string', description: 'YYYY-MM-DD, max 31 days after from' } } },
  },
  {
    type: 'function',
    name: 'get_macro',
    description: 'Macro dashboard: cross-asset tape (VIX, 10Y, dollar, oil, gold, bitcoin, EUR/USD) and FRED series for rates, inflation, labor and credit with latest values and changes.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_comps',
    description: 'Comparable-company table for a ticker (peer multiples, growth, margins), peer median/mean, and the value implied by peer median P/E, P/S, EV/EBITDA and P/B.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, peers: { type: 'array', items: { type: 'string' } } }, required: ['symbol'] },
  },
  {
    type: 'function',
    name: 'run_event_study',
    description: 'Market-model event study: abnormal returns around earnings releases (8-K item 2.02), all 8-Ks, or custom dates. Returns CAR per event and the average with t-statistics.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        source: { type: 'string', enum: ['earnings', '8-K', 'custom'] },
        dates: { type: 'array', items: { type: 'string' } },
        window_before: { type: 'integer', description: 'Days before the event, default 5' },
        window_after: { type: 'integer', description: 'Days after, default 5' },
      },
      required: ['symbol', 'source'],
    },
  },
  {
    type: 'function',
    name: 'get_journal',
    description: "The investor's decision journal: every logged call with entry, target, confidence, current result and verdict, plus hit rate and calibration.",
    parameters: { type: 'object', properties: {} },
  },
];

const SECTIONS: Record<string, [RegExp, RegExp]> = {
  business: [/item\s*1\.?\s*[-–—:.]?\s*business/gi, /item\s*1a\.?\s*[-–—:.]?\s*risk/i],
  risk_factors: [/item\s*1a\.?\s*[-–—:.]?\s*risk\s+factors/gi, /item\s*1b|item\s*1c|item\s*2\.?\s*[-–—:.]?\s*properties/i],
  mdna: [/item\s*[27]\.?\s*[-–—:.]?\s*management['’]s\s+discussion/gi, /item\s*[37]a\.?\s*[-–—:.]?\s*quantitative|item\s*8\.?\s*[-–—:.]?\s*financial\s+statements|item\s*4\.?\s*[-–—:.]?\s*controls/i],
  financial_statements: [/item\s*[18]\.?\s*[-–—:.]?\s*financial\s+statements/gi, /item\s*9\.?\s*[-–—:.]?\s*changes|item\s*2\.?\s*[-–—:.]?\s*management/i],
  legal: [/item\s*3\.?\s*[-–—:.]?\s*legal\s+proceedings|item\s*1\.?\s*[-–—:.]?\s*legal\s+proceedings/gi, /item\s*4\.?|item\s*1a\.?/i],
};

/** The longest match of a section heading to the next item heading (skips the table of contents). */
function sectionOf(text: string, section: string) {
  const bounds = SECTIONS[section];
  if (!bounds) return text;
  let best = '';
  for (const match of text.matchAll(bounds[0])) {
    const rest = text.slice(match.index);
    const end = rest.slice(match[0].length).search(bounds[1]);
    const body = end === -1 ? rest.slice(0, 200_000) : rest.slice(0, end + match[0].length);
    if (body.length > best.length) best = body;
  }
  return best || text;
}

export async function runResearchTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
  const symbol = typeof args.symbol === 'string' ? args.symbol.toUpperCase() : '';
  const limit = (fallback: number, max: number) => Math.min(max, Math.max(1, Number(args.limit ?? fallback) || fallback));
  switch (name) {
    case 'get_news': {
      const items = symbol ? await getCompanyNews(symbol) : await getMarketNews();
      return items.slice(0, limit(20, 50)).map((item) => `- ${item.publishedAt.slice(0, 16).replace('T', ' ')} · ${item.source}: ${item.title}${item.summary ? ` — ${item.summary.slice(0, 200)}` : ''} (${item.url})`).join('\n') || 'No headlines.';
    }
    case 'get_filings': {
      const forms = Array.isArray(args.forms) ? (args.forms as string[]).map((form) => form.toUpperCase()) : null;
      const filings = (await getFilings(symbol)).filter((filing) => (forms ? forms.includes(filing.form) : /^(10-K|10-Q|8-K|20-F|6-K|DEF 14A|S-1|SC 13)/.test(filing.form)));
      return filings.slice(0, limit(20, 60)).map((filing) => `${filing.filedAt} ${filing.form}${filing.reportDate ? ` (period ${filing.reportDate})` : ''}${filing.items ? ` items ${filing.items}` : ''}${filing.description ? ` — ${filing.description}` : ''}: ${filing.url}`).join('\n') || 'No filings.';
    }
    case 'read_filing': {
      const max = Math.min(60_000, Math.max(2_000, Number(args.max_chars ?? 20_000) || 20_000));
      const text = await fetchFilingText(String(args.url ?? ''), 4_000_000);
      const body = typeof args.section === 'string' ? sectionOf(text, args.section) : text;
      return body.length > max ? `${body.slice(0, max)}\n…(truncated at ${max} of ${body.length} characters)` : body;
    }
    case 'get_risk_factor_changes': {
      const changes = await getRiskFactorChanges(symbol);
      if (!changes) return `${symbol} has fewer than two 10-K filings on EDGAR.`;
      return [
        `10-K filed ${changes.current.filedAt} vs ${changes.previous.filedAt}: ${changes.added.length} new, ${changes.removed.length} removed, ${changes.modified.length} reworded, ${changes.unchanged} unchanged paragraphs.`,
        `NEW:\n${changes.added.slice(0, 15).map((text) => `+ ${text.slice(0, 600)}`).join('\n')}`,
        `REMOVED:\n${changes.removed.slice(0, 10).map((text) => `- ${text.slice(0, 400)}`).join('\n')}`,
        `REWORDED (after):\n${changes.modified.slice(0, 10).map((pair) => `~ ${pair.after.slice(0, 400)}`).join('\n')}`,
      ].join('\n\n');
    }
    case 'get_insider_trades': {
      const trades = await getInsiderTrades(symbol);
      const summary = summarizeInsiders(trades);
      return [
        `LAST 180 DAYS (open market): ${summary.buyers} buyers ${money(summary.boughtValue)}, ${summary.sellers} sellers ${money(summary.soldValue)}, net ${money(summary.netValue)}.`,
        ...trades.slice(0, limit(30, 80)).map((row) => `${row.date} ${row.owner} (${row.role}) ${row.code} ${row.kind} ${row.shares.toLocaleString()} sh${row.price ? ` @ $${row.price.toFixed(2)}` : ''}${row.value ? ` = ${money(row.value)}` : ''}${row.ownedAfter !== null ? `, owns ${row.ownedAfter.toLocaleString()} after` : ''}`),
      ].join('\n');
    }
    case 'get_calendar': {
      const from = typeof args.from === 'string' ? args.from : todayInNewYork();
      const to = typeof args.to === 'string' ? args.to : from;
      const days = await getCalendar(ctx.userId, from, to);
      return days
        .map((day) =>
          [
            `${day.date}:`,
            `  earnings: ${day.earnings.map((row) => `${row.symbol}${row.mine ? '*' : ''} ${row.time}${row.epsForecast !== null ? ` est $${row.epsForecast}` : ''}`).join(', ') || 'none'}`,
            `  ex-dividend: ${day.dividends.map((row) => `${row.symbol}${row.mine ? '*' : ''} $${row.amount ?? '?'}`).join(', ') || 'none'}`,
            `  US data: ${day.economy.filter((row) => row.major).map((row) => `${row.time ?? ''} ${row.name} (cons ${row.consensus ?? '—'}, prev ${row.previous ?? '—'}${row.actual ? `, actual ${row.actual}` : ''})`).join('; ') || 'none major'}`,
          ].join('\n'),
        )
        .join('\n') + '\n(* = held or watched)';
    }
    case 'get_macro': {
      const [tape, dashboard] = await Promise.all([getMacroTape(), getMacroDashboard(2)]);
      return [
        `TAPE: ${tape.map((item) => `${item.label} ${item.price?.toFixed(2) ?? '—'} (${item.changePct === null ? '—' : `${item.changePct.toFixed(2)}%`})`).join(' · ')}`,
        ...dashboard.groups.map((group) => `${group.group.toUpperCase()}: ${group.series.map((series) => `${series.label} ${series.latest?.toFixed(2) ?? '—'}${series.unit === '%' ? '%' : series.unit === 'bp' ? 'bp' : ''} (${series.latestDate ?? '—'}, prev ${series.previous?.toFixed(2) ?? '—'})`).join('; ')}`),
      ].join('\n');
    }
    case 'get_comps': {
      const comps = await buildComps(symbol, Array.isArray(args.peers) ? (args.peers as string[]) : undefined);
      const fmt = (value: unknown, kind: 'x' | '%' | '$') => (typeof value !== 'number' ? '—' : kind === '%' ? pct(value) : kind === '$' ? money(value) : `${value.toFixed(1)}x`);
      return [
        ...comps.rows.map((row) => `${row.symbol}: mkt ${fmt(row.marketCap, '$')}, P/E ${fmt(row.pe, 'x')}, P/S ${fmt(row.ps, 'x')}, EV/EBITDA ${fmt(row.evEbitda, 'x')}, growth ${fmt(row.revenueGrowth, '%')}, op margin ${fmt(row.operatingMargin, '%')}, ROE ${fmt(row.roe, '%')}`),
        `PEER MEDIAN: P/E ${fmt(comps.summary.pe.median, 'x')}, P/S ${fmt(comps.summary.ps.median, 'x')}, EV/EBITDA ${fmt(comps.summary.evEbitda.median, 'x')}`,
        `IMPLIED ${comps.target} (price ${comps.price ?? '—'}): ${comps.implied.map((row) => `${row.method} → ${row.price === null ? '—' : `$${row.price.toFixed(2)} (${pct(row.upside)})`}`).join('; ')}`,
      ].join('\n');
    }
    case 'run_event_study': {
      const result = await runEventStudy({
        symbol,
        source: (['earnings', '8-K', 'custom'].includes(String(args.source)) ? args.source : 'earnings') as 'earnings' | '8-K' | 'custom',
        dates: Array.isArray(args.dates) ? (args.dates as string[]) : undefined,
        window: [-(Math.abs(Number(args.window_before ?? 5)) || 5), Math.abs(Number(args.window_after ?? 5)) || 5],
      });
      return [
        result.method,
        `MEAN CAR ${pct(result.summary.meanCar)} over ${result.summary.n} events (t ${result.summary.t?.toFixed(2) ?? 'n/a'}), ${result.summary.positive} positive.`,
        ...result.events.map((event) => `${event.date}${event.error ? `: ${event.error}` : `: CAR ${pct(event.car)} (t ${event.t.toFixed(2)}), day-0 AR ${pct(event.abnormal.find((row) => row.day === 0)?.ar ?? 0)}, beta ${event.beta.toFixed(2)}`}`),
      ].join('\n');
    }
    case 'get_journal': {
      const { decisions, stats } = await listDecisions(ctx.userId);
      return [
        `HIT RATE ${stats.hitRate === null ? 'n/a' : pct(stats.hitRate)} over ${stats.settled} settled calls, Brier ${stats.brier?.toFixed(3) ?? 'n/a'}, avg directional return ${stats.averageReturn === null ? 'n/a' : pct(stats.averageReturn)}.`,
        `CALIBRATION: ${stats.buckets.map((bucket) => `${bucket.low}-${bucket.high}%: ${bucket.calls} calls, ${bucket.hitRate === null ? '—' : pct(bucket.hitRate)} right`).join('; ')}`,
        ...decisions.map((row) => `${row.entry_date} ${row.direction.toUpperCase()} ${row.symbol} @ ${row.entry_price}${row.target_price ? ` → ${row.target_price}` : ''} conf ${row.confidence}% ${row.status}: ${row.score.verdict}, ${row.score.directionalReturn === null ? '—' : pct(row.score.directionalReturn)}. ${row.rationale.slice(0, 200)}`),
      ].join('\n');
    }
    default:
      return null;
  }
}
