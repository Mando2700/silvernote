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
- You have SilverNote tools with the same read access the investor has in the app. Market data: get_companies, get_peers, get_financials, screen, get_price_history, get_score. Their workspace: get_portfolio, get_portfolio_report (performance, transactions, tax, bonds, stress), get_notes, get_research (workspaces and theses), get_pitches, get_watchlists, get_alerts, list_saved (screens, backtest strategies). Models: simulate_portfolio, run_monte_carlo, run_dcf, run_backtest, calculate. When they mention "my notes", "my thesis", "my watchlist", "my portfolio" etc., look it up rather than asking them to paste it. You can also propose changes with the propose_* tools (save or append to a note, add/remove watchlist tickers, create/delete alerts, set stance/conviction/target, commit a thesis section, save a screen or backtest strategy). Proposals are not applied until the investor presses Confirm on the card under your answer, so say they're ready to confirm, never that they're done. Propose only what they asked for or clearly agreed to; when you write a note or thesis, put the full text in the proposal and a short summary in your answer. Trades and portfolio records are theirs to enter; you can't change those. DATA is only a starting point — whenever a question needs figures it doesn't contain (another company, a peer set, more years of statements, a screen of the universe, price returns), call the tools instead of saying the data isn't available or reaching for memory. Prefer these tools over web search for any number SilverNote has.
- Multi-step quantitative asks ("market-cap-weighted 3y revenue CAGR of X's 3 biggest peers", "median FCF margin of software names over $50B", "which of my holdings grew EPS fastest over 5 years") are expected work: gather the inputs with tools, do every non-trivial computation with calculate, and state your choices ("biggest" = largest market value; weights = market value unless told otherwise; period = last N fiscal years). Show a compact table of inputs and weights, then the formula and result. If the request is ambiguous, pick the most sensible reading, say which, and offer the alternative in one line.
- For "what if I add / trim / swap X" or "how would these names change my portfolio", call simulate_portfolio with dollar amounts (if none are given, pick a sensible sizing such as equal dollars totalling ~10% of the portfolio, and say so). Default funding is new money; use cash or trim when the investor says so. Report before → after in a compact table (volatility, beta, Sharpe, max drawdown, top weight, effective positions, key sector weights, weighted P/E and growth, stress tests), then which names diversify (low correlation) and which add concentrated risk. Simulations are hypothetical; nothing is ever traded.
- You can search the web and X. When DATA shows *what* changed but not *why* (a debt jump, a margin swing, a stock move, an acquisition, guidance), search for the reason — filings, press releases, earnings calls, reputable news — and cite sources. Don't say "no reason given in the data" without searching first. Skip searching when DATA already answers the question.
- Use your own knowledge freely for everything that isn't a live number: what companies do, competitive positioning, industry structure, finance concepts, how metrics work, history. When a number you cite comes from your knowledge rather than DATA, mark it "(from memory, may be stale)".
- Read follow-ups in light of the conversation. A bare list of tickers means "cover these"; short questions refer to what was just discussed. Answer the question asked — don't refuse because DATA is thin.
- Answer every part of the message. When it asks several things, give each question its own header and a full answer — never drop one or squeeze it into a one-liner.
- Match depth to the ask. A quick fact gets a short answer; overviews, analyses, "what's happening", "everything I need to know" and multi-part questions get thorough answers: explain the why behind each point, back it with specific numbers from DATA or tools, and close with what it means for the investor and what to watch. Don't stop at a summary when the investor asked for understanding.
- Be direct, quantitative and skeptical. Lead with the answer, then the evidence. Prefer numbers with units and periods (e.g. "FY25 revenue $416B, +6.4% y/y").
- Use markdown: a header per topic or question, bullets with substance (a claim plus its number and reason, not a fragment). Use GitHub-style markdown tables whenever you compare companies, scenarios, before/after, periods or percentiles: one row per item, units in the header, numbers rounded consistently. No filler, no hype.
- When asked to challenge a thesis, argue the strongest opposing case and name specific, observable signals that would prove the thesis wrong.
- When drafting pitch sections, write in a crisp sell-side style the investor can edit.
- Money moves are the investor's decisions; when you suggest trades, frame them as considerations with risks, in one line at most.`;

export function money(value: number | null | undefined, currency = 'USD') {
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
export function snapshotLine(entry: UniverseEntry) {
  return `${entry.symbol} (${entry.name}; ${entry.sector ?? 'n/a'} / ${entry.industry ?? 'n/a'}): price ${entry.price ?? 'n/a'}, market value ${money(entry.marketCap)}, P/E ${entry.pe?.toFixed(1) ?? 'n/a'}, P/S ${entry.ps?.toFixed(1) ?? 'n/a'}, EV/EBITDA ${entry.evEbitda?.toFixed(1) ?? 'n/a'}, FCF yield ${pct(entry.fcfYield)}, revenue FY${entry.fiscalYear ?? '?'} ${money(entry.revenue)}, revenue growth ${pct(entry.revenueGrowth)}, 3y revenue CAGR ${pct(entry.revenueCagr3)}, gross margin ${pct(entry.grossMargin)}, operating margin ${pct(entry.operatingMargin)}, ROE ${pct(entry.roe)}, debt/equity ${entry.debtToEquity?.toFixed(2) ?? 'n/a'}, SilverNote Score ${entry.score ?? 'n/a'}`;
}

async function peersBlock(symbol: string, listings: UniverseEntry[]) {
  const peers = await getPeerSymbols(symbol, 8).catch(() => ({ symbols: [] as string[], source: 'none' }));
  const rows = peers.symbols
    .map((peer) => listings.find((entry) => entry.symbol === peer))
    .filter((entry): entry is UniverseEntry => Boolean(entry))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  if (!rows.length) return null;
  return [
    `PEERS OF ${symbol} (source: ${peers.source}; largest market value first; latest fiscal year, today's price):`,
    ...rows.map((entry, index) => `- #${index + 1} ${snapshotLine(entry)}`),
  ].join('\n');
}

// Uppercase words that are finance jargon rather than tickers.
const NOT_TICKERS = new Set(['A', 'I', 'AI', 'CEO', 'CFO', 'EPS', 'FCF', 'ROE', 'ROIC', 'PE', 'EV', 'EBIT', 'EBITDA', 'DCF', 'GAAP', 'USA', 'US', 'IPO', 'ETF', 'SEC', 'YOY', 'TTM', 'FY', 'Q', 'IT', 'VS', 'WACC', 'CAGR', 'NAV', 'M', 'B', 'K']);
// Everyday words that are also tickers (NOW = ServiceNow, ON = onsemi). Written in capitals inside an otherwise
// normal sentence ("peers of NOW") they mean the ticker; in an all-caps message they're just words.
const ENGLISH_TICKERS = new Set(['NOW', 'ON', 'ALL', 'ARE', 'OR', 'SO', 'BE', 'GO', 'NEW', 'ONE', 'OK']);

/** Data for companies the question names by ticker (e.g. "compare with $MSFT and NVDA"), beyond the one in view. */
export async function mentionedContext(message: string, exclude: string | null, lite = false) {
  const listings = await getListings().catch(() => [] as UniverseEntry[]);
  const bySymbol = new Map(listings.map((entry) => [entry.symbol, entry]));
  const candidates = message.match(/\$?\b[A-Za-z]{1,5}(?:[.-][A-Za-z])?\b/g) ?? [];
  // A message that is essentially a ticker list ("crwd ftnt msft orcl") counts in any case.
  const known = (token: string) => bySymbol.has(token.toUpperCase().replace('-', '.'));
  const words = message.split(/[\s,;]+/).filter(Boolean);
  const tickerList = words.length >= 2 && words.filter((word) => /^\$?[A-Za-z.\-]{1,6}$/.test(word) && known(word.replace('$', ''))).length / words.length >= 0.75;
  const letters = message.replace(/[^A-Za-z]/g, '');
  const shouting = letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6;
  const symbols: string[] = [];
  for (const raw of candidates) {
    const explicit = raw.startsWith('$') || tickerList;
    const token = raw.replace('$', '');
    // Plain words count only when written in capitals and at least two letters, so "meta" or the P in "P/E"
    // are not read as tickers; "$F" still works.
    if (!explicit && (token !== token.toUpperCase() || token.length < 2 || NOT_TICKERS.has(token) || (shouting && ENGLISH_TICKERS.has(token)))) continue;
    const symbol = token.toUpperCase().replace('-', '.');
    const entry = bySymbol.get(symbol) ?? bySymbol.get(symbol.replace('.', '-'));
    if (entry && entry.symbol !== exclude && !symbols.includes(entry.symbol)) symbols.push(entry.symbol);
    if (symbols.length >= (tickerList ? 12 : 6)) break;
  }
  if (!symbols.length) return null;
  const lines = ['COMPANIES NAMED IN THE QUESTION:', ...symbols.map((symbol) => `- ${snapshotLine(bySymbol.get(symbol)!)}`)];
  if (!lite && /\bpeers?\b|competitor|rival|comparable|comps?\b/i.test(message)) {
    const blocks = await Promise.all(symbols.slice(0, 3).map((symbol) => peersBlock(symbol, listings)));
    lines.push(...blocks.filter((block): block is string => Boolean(block)));
  }
  return lines.join('\n');
}

export async function companyContext(userId: string, symbol: string, filingUrl?: string | null, lite = false) {
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
    lite ? Promise.resolve(null) : peersBlock(symbol, universe),
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
  if (profile?.description && !lite) lines.push(`BUSINESS: ${profile.description.slice(0, 1200)}`);
  if (statements) {
    lines.push(`ANNUAL STATEMENTS (${statements.currency}, source ${statements.source}):`);
    for (const period of statements.annual.slice(0, lite ? 3 : 5)) lines.push(`- ${periodLine(period, statements.currency)}`);
    if (statements.quarterly.length && !lite) {
      lines.push('RECENT QUARTERS:');
      for (const period of statements.quarterly.slice(0, 4)) lines.push(`- ${periodLine(period, statements.currency)}`);
    }
  }
  if (score) {
    lines.push(`SILVERNOTE SCORE: ${score.overallScore}/100 (${score.label}, ${score.confidence} confidence). Components: ${score.subScores.map((item) => `${item.name} ${item.score}`).join(', ')}.`);
    if (!lite) lines.push(`SCORE NOTES: ${score.detailedDescription.replace(/\n+/g, ' ')}`);
  }
  if (workspace || versions.length) {
    lines.push(`INVESTOR'S WORKSPACE: stance ${workspace?.stance ?? 'n/a'}, conviction ${workspace?.conviction ?? 'n/a'}/5, target price ${workspace?.target_price ?? 'n/a'}, horizon ${workspace?.horizon ?? 'n/a'}`);
    for (const version of versions) {
      lines.push(`## ${THESIS_SECTION_META[version.section].title} (last edited ${version.created_at.toISOString().slice(0, 10)})\n${version.content.slice(0, lite ? 600 : 2500)}`);
    }
  }
  if (news.length) {
    lines.push('RECENT HEADLINES:');
    for (const item of news.slice(0, lite ? 5 : 10)) lines.push(`- ${item.publishedAt.slice(0, 10)} · ${item.source}: ${item.title}${item.summary && !lite ? ` — ${item.summary.slice(0, 200)}` : ''}`);
  }
  if (filings.length) {
    lines.push('RECENT SEC FILINGS:');
    for (const filing of filings.filter((item) => /^(10-K|10-Q|8-K|20-F|6-K|DEF 14A)/.test(item.form)).slice(0, lite ? 5 : 10)) {
      lines.push(`- ${filing.filedAt} ${filing.form}${filing.reportDate ? ` (period ${filing.reportDate})` : ''}: ${filing.description ?? filing.primaryDocument}`);
    }
  }
  if (filingUrl) {
    const text = await fetchFilingText(filingUrl, 90_000).catch((error) => `Could not load the filing: ${(error as Error).message}`);
    lines.push(`FILING TEXT (${filingUrl}):\n${text}`);
  }
  return lines.join('\n');
}

export async function portfolioContext(userId: string, id: string, lite = false) {
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
    if (!lite) lines.push(`RISK CONTRIBUTIONS: ${stats.contributions.map((item) => `${item.symbol} weight ${pct(item.weight)} → ${pct(item.contribution)} of variance`).join('; ')}`);
  }
  return lines.join('\n');
}

export async function generalContext(userId: string, lite = false) {
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
    `HEADLINES FOR FOLLOWED SYMBOLS:\n${mine.items.slice(0, lite ? 8 : 25).map(headline).join('\n') || '(none)'}`,
    `MARKET HEADLINES:\n${marketNews.slice(0, lite ? 8 : 20).map(headline).join('\n') || '(none)'}`,
  ].join('\n');
}

async function subjectContext(userId: string, context: AssistantContext, filingUrl: string | null | undefined, lite: boolean) {
  try {
    if (context.type === 'company') return await companyContext(userId, context.symbol, filingUrl, lite);
    if (context.type === 'portfolio') return await portfolioContext(userId, context.id, lite);
    return await generalContext(userId, lite);
  } catch (error) {
    return `Context could not be fully loaded: ${(error as Error).message}`;
  }
}

/** `lite` trims the DATA block (Fast mode); Grok can still fetch anything missing through its tools. */
export async function buildContext(userId: string, context: AssistantContext, filingUrl?: string | null, message = '', options: { lite?: boolean } = {}) {
  const lite = options.lite ?? false;
  const [subject, mentioned] = await Promise.all([
    subjectContext(userId, context, filingUrl, lite),
    mentionedContext(message, context.type === 'company' ? context.symbol : null, lite).catch(() => null),
  ]);
  return mentioned ? `${subject}\n${mentioned}` : subject;
}
