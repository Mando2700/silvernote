import 'server-only';

import { q, q1 } from '@/lib/db';
import { fetchFilingText } from '@/lib/data/providers/sec';
import { compactNumber, pct } from '@/lib/format';
import type { StatementPeriod } from '@/lib/finance/statement-types';
import { THESIS_SECTION_META, type ThesisSection } from '@/lib/schemas';
import type { NewsItem } from '@/lib/data/types';
import { getCompanyNews, getCompanyProfile, getFilings, getLiveQuote, getPeerSymbols } from '@/lib/services/market';
import { getMarketHeadlines, getMyNews } from '@/lib/services/news';
import { buildRiskModel, getHoldings, getPortfolio, riskFreeFor, riskStatistics, sectorExposure } from '@/lib/services/portfolio';
import { getGroupStats, getListings, getUniverse, type UniverseEntry } from '@/lib/services/screener';
import { getDetailedScore } from '@/lib/services/scores';
import { getCompanyStatements } from '@/lib/services/statements';

export type AssistantContext = { type: 'company'; symbol: string } | { type: 'portfolio'; id: string } | { type: 'general' };

export const SYSTEM_PROMPT = `You are Grok, the research assistant inside SilverNote — a private investment research workstation used by one investor.

How to work:
- Company-specific figures (prices, financials, multiples, holdings, scores, headlines) come from the DATA block below. Never invent figures, quotes, or filings.
- Derive what you can. If a metric isn't listed but follows from DATA, compute it and show the one-line math (e.g. P/FCF = 1 / FCF yield; PEG = P/E ÷ growth %; medians given as yields invert to multiples). Only say something is unavailable when it truly can't be computed, and then say what would be needed.
- You can search the web and X. When DATA shows *what* changed but not *why* (a debt jump, a margin swing, a stock move, an acquisition, guidance), search for the reason — filings, press releases, earnings calls, reputable news — and cite sources. Don't say "no reason given in the data" without searching first. Skip searching when DATA already answers the question.
- Use your own knowledge freely for everything that isn't a live number: what companies do, competitive positioning, industry structure, finance concepts, how metrics work, history. When a number you cite comes from your knowledge rather than DATA, mark it "(from memory, may be stale)".
- Read follow-ups in light of the conversation. A bare list of tickers means "cover these"; short questions refer to what was just discussed. Answer the question asked — don't refuse because DATA is thin.
- Be direct, quantitative and skeptical. Lead with the answer, then the evidence. Prefer numbers with units and periods (e.g. "FY25 revenue $416B, +6.4% y/y").
- Use short markdown: a few headers, tight bullets, and tables when comparing. No filler, no hype.
- When asked to challenge a thesis, argue the strongest opposing case and name specific, observable signals that would prove the thesis wrong.
- When drafting pitch sections, write in a crisp sell-side style the investor can edit.
- Money moves are the investor's decisions; when you suggest trades, frame them as considerations with risks, in one line at most.`;

function money(value: number | null | undefined, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value < 0 ? '-' : ''}${currency === 'USD' ? '$' : `${currency} `}${compactNumber(Math.abs(value), 2)}`;
}

function periodLine(period: StatementPeriod, currency: string) {
  return [
    `${period.label} (ended ${period.periodEnd})`,
    `revenue ${money(period.revenue, currency)}`,
    `gross margin ${pct(period.grossMargin ?? null)}`,
    `operating margin ${pct(period.operatingMargin ?? null)}`,
    `net income ${money(period.netIncome, currency)}`,
    `diluted EPS ${period.epsDiluted != null ? period.epsDiluted.toFixed(2) : 'n/a'}`,
    `operating cash flow ${money(period.operatingCashFlow, currency)}`,
    `capex ${money(period.capex, currency)}`,
    `free cash flow ${money(period.freeCashFlow, currency)}`,
    `cash ${money(period.cash, currency)}`,
    `total debt ${money(period.totalDebt, currency)}`,
    `equity ${money(period.totalEquity, currency)}`,
    `buybacks ${money(period.buybacks, currency)}`,
    `dividends ${money(period.dividendsPaid, currency)}`,
  ].join('; ');
}

/** One dense line of market data for a listing, used for peers and tickers named in a question. */
function snapshotLine(entry: UniverseEntry) {
  return `${entry.symbol} (${entry.name}; ${entry.sector ?? 'n/a'} / ${entry.industry ?? 'n/a'}): price ${entry.price ?? 'n/a'}, market value ${money(entry.marketCap)}, P/E ${entry.pe?.toFixed(1) ?? 'n/a'}, P/S ${entry.ps?.toFixed(1) ?? 'n/a'}, EV/EBITDA ${entry.evEbitda?.toFixed(1) ?? 'n/a'}, FCF yield ${pct(entry.fcfYield)}, revenue growth ${pct(entry.revenueGrowth)}, 3y CAGR ${pct(entry.revenueCagr3)}, gross margin ${pct(entry.grossMargin)}, operating margin ${pct(entry.operatingMargin)}, ROE ${pct(entry.roe)}, debt/equity ${entry.debtToEquity?.toFixed(2) ?? 'n/a'}, SilverNote Score ${entry.score ?? 'n/a'}`;
}

async function peersBlock(symbol: string, listings: UniverseEntry[]) {
  const peers = await getPeerSymbols(symbol, 8).catch(() => ({ symbols: [] as string[], source: 'none' }));
  const rows = peers.symbols.map((peer) => listings.find((entry) => entry.symbol === peer)).filter((entry): entry is UniverseEntry => Boolean(entry));
  if (!rows.length) return null;
  return [`PEERS OF ${symbol} (source: ${peers.source}; latest fiscal year, today's price):`, ...rows.map((entry) => `- ${snapshotLine(entry)}`)].join('\n');
}

// Uppercase words that are finance jargon rather than tickers.
const NOT_TICKERS = new Set(['A', 'I', 'AI', 'CEO', 'CFO', 'EPS', 'FCF', 'ROE', 'ROIC', 'PE', 'EV', 'EBIT', 'EBITDA', 'DCF', 'GAAP', 'USA', 'US', 'IPO', 'ETF', 'SEC', 'YOY', 'TTM', 'FY', 'Q', 'OK', 'IT', 'ALL', 'ARE', 'ON', 'OR', 'SO', 'BE', 'GO', 'NOW', 'NEW', 'ONE', 'VS', 'WACC', 'CAGR', 'NAV', 'M', 'B', 'K']);

/** Data for companies the question names by ticker (e.g. "compare with $MSFT and NVDA"), beyond the one in view. */
export async function mentionedContext(message: string, exclude: string | null) {
  const listings = await getListings().catch(() => [] as UniverseEntry[]);
  const bySymbol = new Map(listings.map((entry) => [entry.symbol, entry]));
  const candidates = message.match(/\$?\b[A-Za-z]{1,5}(?:[.-][A-Za-z])?\b/g) ?? [];
  // A message that is essentially a ticker list ("crwd ftnt msft orcl") counts in any case.
  const known = (token: string) => bySymbol.has(token.toUpperCase().replace('-', '.'));
  const words = message.split(/[\s,;]+/).filter(Boolean);
  const tickerList = words.length >= 2 && words.filter((word) => /^\$?[A-Za-z.\-]{1,6}$/.test(word) && known(word.replace('$', ''))).length / words.length >= 0.75;
  const symbols: string[] = [];
  for (const raw of candidates) {
    const explicit = raw.startsWith('$') || tickerList;
    const token = raw.replace('$', '');
    // Plain words count only when written in capitals and at least two letters, so "meta" or the P in "P/E"
    // are not read as tickers; "$F" still works.
    if (!explicit && (token !== token.toUpperCase() || token.length < 2 || NOT_TICKERS.has(token))) continue;
    const symbol = token.toUpperCase().replace('-', '.');
    const entry = bySymbol.get(symbol) ?? bySymbol.get(symbol.replace('.', '-'));
    if (entry && entry.symbol !== exclude && !symbols.includes(entry.symbol)) symbols.push(entry.symbol);
    if (symbols.length >= (tickerList ? 12 : 6)) break;
  }
  if (!symbols.length) return null;
  const lines = ['COMPANIES NAMED IN THE QUESTION:', ...symbols.map((symbol) => `- ${snapshotLine(bySymbol.get(symbol)!)}`)];
  if (/\bpeers?\b|competitor|rival|comparable|comps?\b/i.test(message)) {
    const blocks = await Promise.all(symbols.slice(0, 3).map((symbol) => peersBlock(symbol, listings)));
    lines.push(...blocks.filter((block): block is string => Boolean(block)));
  }
  return lines.join('\n');
}

export async function companyContext(userId: string, symbol: string, filingUrl?: string | null) {
  const [universe, profile, quote, statements, score, workspace, versions, news, filings] = await Promise.all([
    getListings(),
    getCompanyProfile(symbol).catch(() => null),
    getLiveQuote(symbol).catch(() => null),
    getCompanyStatements(symbol).catch(() => null),
    getDetailedScore(symbol).catch(() => null),
    q1<{ stance: string; conviction: number; target_price: number | null; horizon: string | null }>(
      'select stance, conviction, target_price, horizon from public.workspaces where user_id = $1 and symbol = $2',
      [userId, symbol],
    ),
    q<{ section: ThesisSection; content: string; created_at: Date; change_note: string | null }>(
      `select distinct on (section) section, content, created_at, change_note from public.thesis_versions
       where user_id = $1 and symbol = $2 order by section, created_at desc`,
      [userId, symbol],
    ),
    getCompanyNews(symbol).catch(() => []),
    getFilings(symbol).catch(() => []),
  ]);
  const entry = universe.find((item) => item.symbol === symbol);
  const [sector, peers] = await Promise.all([
    entry?.sector ? getGroupStats('sector', entry.sector).catch(() => null) : Promise.resolve(null),
    peersBlock(symbol, universe),
  ]);
  const lines: string[] = [];
  lines.push(`COMPANY: ${profile?.name ?? symbol} (${symbol}) · ${entry?.sector ?? profile?.sector ?? 'n/a'} / ${entry?.industry ?? profile?.industry ?? 'n/a'}`);
  lines.push(`PRICE: ${quote?.price ?? entry?.price ?? 'n/a'} (${quote?.changePct != null ? `${quote.changePct.toFixed(2)}% today` : 'n/a'}); market value ${money(entry?.marketCap)}; 52-week range ${profile?.low52 ?? 'n/a'}–${profile?.high52 ?? 'n/a'}; 1Y analyst target ${profile?.oneYearTarget ?? 'n/a'}; forward P/E ${profile?.forwardPE ?? 'n/a'}; dividend yield ${pct(profile?.dividendYield ?? null, 2)}`);
  if (entry) {
    lines.push(
      `VALUATION & QUALITY (latest fiscal year, today's price): P/E ${entry.pe?.toFixed(1) ?? 'n/a'}, P/S ${entry.ps?.toFixed(1) ?? 'n/a'}, EV/EBITDA ${entry.evEbitda?.toFixed(1) ?? 'n/a'}, FCF yield ${pct(entry.fcfYield)}, revenue growth ${pct(entry.revenueGrowth)}, 3y revenue CAGR ${pct(entry.revenueCagr3)}, gross margin ${pct(entry.grossMargin)}, operating margin ${pct(entry.operatingMargin)}, ROE ${pct(entry.roe)}, debt/equity ${entry.debtToEquity?.toFixed(2) ?? 'n/a'}`,
    );
  }
  if (sector) {
    const m = sector.medians;
    lines.push(`SECTOR MEDIANS (${sector.group}, ${sector.count} companies): P/E ${m.pe?.toFixed(1) ?? 'n/a'}, P/S ${m.ps?.toFixed(1) ?? 'n/a'}, revenue growth ${pct(m.revenueGrowth ?? null)}, operating margin ${pct(m.operatingMargin ?? null)}, ROE ${pct(m.roe ?? null)}, FCF yield ${pct(m.fcfYield ?? null)}`);
  }
  if (peers) lines.push(peers);
  if (profile?.description) lines.push(`BUSINESS: ${profile.description.slice(0, 1200)}`);
  if (statements) {
    lines.push(`ANNUAL STATEMENTS (${statements.currency}, source ${statements.source}):`);
    for (const period of statements.annual.slice(0, 5)) lines.push(`- ${periodLine(period, statements.currency)}`);
    if (statements.quarterly.length) {
      lines.push('RECENT QUARTERS:');
      for (const period of statements.quarterly.slice(0, 4)) lines.push(`- ${periodLine(period, statements.currency)}`);
    }
  }
  if (score) {
    lines.push(`SILVERNOTE SCORE: ${score.overallScore}/100 (${score.label}, ${score.confidence} confidence). Components: ${score.subScores.map((item) => `${item.name} ${item.score}`).join(', ')}.`);
    lines.push(`SCORE NOTES: ${score.detailedDescription.replace(/\n+/g, ' ')}`);
  }
  if (workspace || versions.length) {
    lines.push(`INVESTOR'S WORKSPACE: stance ${workspace?.stance ?? 'n/a'}, conviction ${workspace?.conviction ?? 'n/a'}/5, target price ${workspace?.target_price ?? 'n/a'}, horizon ${workspace?.horizon ?? 'n/a'}`);
    for (const version of versions) {
      lines.push(`## ${THESIS_SECTION_META[version.section].title} (last edited ${version.created_at.toISOString().slice(0, 10)})\n${version.content.slice(0, 2500)}`);
    }
  }
  if (news.length) {
    lines.push('RECENT HEADLINES:');
    for (const item of news.slice(0, 10)) lines.push(`- ${item.publishedAt.slice(0, 10)} · ${item.source}: ${item.title}${item.summary ? ` — ${item.summary.slice(0, 200)}` : ''}`);
  }
  if (filings.length) {
    lines.push('RECENT SEC FILINGS:');
    for (const filing of filings.filter((item) => /^(10-K|10-Q|8-K|20-F|6-K|DEF 14A)/.test(item.form)).slice(0, 10)) {
      lines.push(`- ${filing.filedAt} ${filing.form}${filing.reportDate ? ` (period ${filing.reportDate})` : ''}: ${filing.description ?? filing.primaryDocument}`);
    }
  }
  if (filingUrl) {
    const text = await fetchFilingText(filingUrl, 90_000).catch((error) => `Could not load the filing: ${(error as Error).message}`);
    lines.push(`FILING TEXT (${filingUrl}):\n${text}`);
  }
  return lines.join('\n');
}

export async function portfolioContext(userId: string, id: string) {
  const portfolio = await getPortfolio(userId, id);
  const { holdings, summary } = await getHoldings(portfolio);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [userId]);
  const model = await buildRiskModel(holdings, portfolio.benchmark, 504).catch(() => null);
  const stats = model ? riskStatistics(model, await riskFreeFor(settings?.data?.riskFreeRate)) : null;
  const lines: string[] = [];
  lines.push(`PORTFOLIO: ${portfolio.name}; benchmark ${portfolio.benchmark}; total ${money(summary.totalValue)} (stocks ${money(summary.invested)}, bonds ${money(summary.fixedIncome)}, cash ${money(summary.cash)}); unrealized P&L ${money(summary.unrealized)} (${pct(summary.unrealizedPct)}); realized ${money(summary.realized)}; today ${money(summary.dayChange)}.`);
  lines.push('HOLDINGS (symbol · weight · value · unrealized · sector · SilverNote Score):');
  for (const holding of holdings) {
    lines.push(`- ${holding.symbol} · ${pct(holding.weight)} · ${money(holding.marketValue)} · ${money(holding.unrealized)} (${pct(holding.unrealizedPct)}) · ${holding.sector ?? 'n/a'} · ${holding.score ?? 'n/a'}`);
  }
  lines.push(`SECTOR EXPOSURE: ${sectorExposure(holdings, portfolio.cash, summary.fixedIncome).map((item) => `${item.sector} ${pct(item.weight)}`).join(', ')}`);
  if (stats) {
    lines.push(
      `RISK (last ${stats.days} trading days at current weights): annualized return ${pct(stats.annualReturn)}, volatility ${pct(stats.volatility)}, beta ${stats.beta?.toFixed(2) ?? 'n/a'}, Sharpe ${stats.sharpe?.toFixed(2) ?? 'n/a'}, Sortino ${stats.sortino?.toFixed(2) ?? 'n/a'}, max drawdown ${pct(stats.maxDrawdown)}, 1-day VaR95 ${pct(stats.var95?.historical ?? null)}, benchmark volatility ${pct(stats.benchmarkVolatility)}.`,
    );
    lines.push(`RISK CONTRIBUTIONS: ${stats.contributions.map((item) => `${item.symbol} weight ${pct(item.weight)} → ${pct(item.contribution)} of variance`).join('; ')}`);
  }
  return lines.join('\n');
}

export async function generalContext(userId: string) {
  const universe = await getUniverse();
  const priced = universe.filter((entry) => entry.changePct !== null && entry.marketCap);
  const advancers = priced.filter((entry) => (entry.changePct ?? 0) > 0).length;
  const lists = await q<{ name: string; symbols: string[] }>(
    `select w.name, coalesce(array_agg(i.symbol) filter (where i.symbol is not null), '{}') as symbols
     from public.watchlists w left join public.watchlist_items i on i.watchlist_id = w.id where w.user_id = $1 group by w.id, w.name`,
    [userId],
  );
  const leaders = universe.filter((entry) => (entry.marketCap ?? 0) > 10e9 && entry.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
  const [marketNews, mine] = await Promise.all([getMarketHeadlines().catch(() => []), getMyNews(userId).catch(() => ({ items: [], symbols: [] }))]);
  const headline = (item: NewsItem) => `- ${item.publishedAt.slice(0, 16).replace('T', ' ')} · ${item.source}${item.symbols.length ? ` [${item.symbols.slice(0, 4).join(', ')}]` : ''}: ${item.title}`;
  return [
    `TODAY: ${new Date().toISOString().slice(0, 10)}. Market breadth: ${advancers} of ${priced.length} US common stocks up on the latest session.`,
    `WATCHLISTS: ${lists.map((list) => `${list.name}: ${list.symbols.join(', ') || '(empty)'}`).join(' | ') || 'none'}`,
    `FOLLOWED SYMBOLS (held first): ${mine.symbols.map((entry) => `${entry.symbol}${entry.held ? ' (held)' : ''}`).join(', ') || 'none'}`,
    `TOP SILVERNOTE SCORES (>$10B): ${leaders.map((entry) => `${entry.symbol} ${entry.score}`).join(', ')}`,
    `HEADLINES FOR FOLLOWED SYMBOLS:\n${mine.items.slice(0, 25).map(headline).join('\n') || '(none)'}`,
    `MARKET HEADLINES:\n${marketNews.slice(0, 20).map(headline).join('\n') || '(none)'}`,
  ].join('\n');
}

async function subjectContext(userId: string, context: AssistantContext, filingUrl?: string | null) {
  try {
    if (context.type === 'company') return await companyContext(userId, context.symbol, filingUrl);
    if (context.type === 'portfolio') return await portfolioContext(userId, context.id);
    return await generalContext(userId);
  } catch (error) {
    return `Context could not be fully loaded: ${(error as Error).message}`;
  }
}

export async function buildContext(userId: string, context: AssistantContext, filingUrl?: string | null, message = '') {
  const [subject, mentioned] = await Promise.all([
    subjectContext(userId, context, filingUrl),
    mentionedContext(message, context.type === 'company' ? context.symbol : null).catch(() => null),
  ]);
  return mentioned ? `${subject}\n${mentioned}` : subject;
}
