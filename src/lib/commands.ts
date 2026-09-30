/**
 * Terminal-style command line for ⌘K: "NVDA FA", "AAPL DCF", "NVDA vs AMD", "WL add TSM",
 * "ALERT MSFT < 400", "ECO". Pure parsing; the palette runs the result.
 */

export type ParsedCommand =
  | { kind: 'navigate'; href: string; label: string }
  | { kind: 'watchlist'; symbol: string; list: string | null; label: string }
  | { kind: 'alert'; symbol: string; direction: 'above' | 'below'; price: number; label: string }
  | { kind: 'ask'; prompt: string; symbol: string | null; label: string };

/** Company functions: mnemonic → company tab (Bloomberg-style names where they exist). */
export const COMPANY_FUNCTIONS: Record<string, { tab: string | null; label: string }> = {
  DES: { tab: null, label: 'Description & overview' },
  GP: { tab: null, label: 'Price chart' },
  FA: { tab: 'financials', label: 'Financial analysis' },
  DCF: { tab: 'dcf', label: 'DCF valuation' },
  COMP: { tab: 'comps', label: 'Comparable companies' },
  COMPS: { tab: 'comps', label: 'Comparable companies' },
  RV: { tab: 'comps', label: 'Relative value (comps)' },
  SCORE: { tab: 'score', label: 'SilverNote Score' },
  PEER: { tab: 'peers', label: 'Peers & sector' },
  PEERS: { tab: 'peers', label: 'Peers & sector' },
  CN: { tab: 'news', label: 'Company news & filings' },
  NEWS: { tab: 'news', label: 'Company news & filings' },
  CF: { tab: 'news', label: 'Company filings' },
  INS: { tab: 'insiders', label: 'Insider transactions' },
  INSIDER: { tab: 'insiders', label: 'Insider transactions' },
  RISK: { tab: 'insiders', label: 'Risk factor changes' },
  WS: { tab: 'workspace', label: 'Research workspace' },
  THESIS: { tab: 'workspace', label: 'Thesis workspace' },
};

/** Screen functions that take no ticker. */
export const SCREEN_FUNCTIONS: Record<string, { href: string; label: string }> = {
  TOP: { href: '/explorer', label: 'Market explorer' },
  EQS: { href: '/explorer', label: 'Equity screener' },
  MAP: { href: '/explorer?view=map', label: 'Market map' },
  ECO: { href: '/calendar', label: 'Economic & earnings calendar' },
  EVTS: { href: '/calendar', label: 'Events calendar' },
  CAL: { href: '/calendar', label: 'Events calendar' },
  MACRO: { href: '/macro', label: 'Macro dashboard' },
  WB: { href: '/macro', label: 'Rates & macro monitor' },
  GC: { href: '/macro', label: 'Yield curve' },
  N: { href: '/news', label: 'News' },
  PORT: { href: '/portfolio', label: 'Portfolio' },
  PRT: { href: '/portfolio', label: 'Portfolio' },
  RISKP: { href: '/portfolio?tab=risk', label: 'Portfolio risk' },
  ATTR: { href: '/portfolio?tab=analytics', label: 'Factors & attribution' },
  REBAL: { href: '/portfolio?tab=rebalance', label: 'Rebalance' },
  TAX: { href: '/portfolio?tab=tax', label: 'Tax lots' },
  WL: { href: '/watchlists', label: 'Watchlists' },
  JRNL: { href: '/journal', label: 'Decision journal' },
  LAB: { href: '/lab', label: 'Research lab' },
  EVT: { href: '/lab', label: 'Event study' },
  BT: { href: '/backtest', label: 'Backtest' },
  MC: { href: '/simulations', label: 'Monte Carlo & stress tests' },
  TERM: { href: '/terminal', label: 'Terminal layouts' },
  NOTES: { href: '/notes', label: 'Notes & theses' },
  LEARN: { href: '/learn', label: 'Learn' },
};

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function parseCommand(input: string): ParsedCommand | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.startsWith('?') || raw.startsWith('>')) {
    const prompt = raw.slice(1).trim();
    return prompt ? { kind: 'ask', prompt, symbol: null, label: `Ask Grok: ${prompt}` } : null;
  }
  const words = raw.split(/\s+/);
  const upper = words.map((word) => word.toUpperCase());

  // WL add TSM [list name]
  if (upper[0] === 'WL' && upper[1] === 'ADD' && upper[2] && TICKER.test(upper[2])) {
    const list = words.slice(3).join(' ') || null;
    return { kind: 'watchlist', symbol: upper[2], list, label: `Add ${upper[2]} to ${list ? `“${list}”` : 'your first watchlist'}` };
  }
  // ALERT MSFT < 400 | ALERT MSFT > 450
  if (upper[0] === 'ALERT' && upper[1] && TICKER.test(upper[1]) && (upper[2] === '<' || upper[2] === '>') && Number.isFinite(Number(words[3]))) {
    const direction = upper[2] === '>' ? 'above' : 'below';
    return { kind: 'alert', symbol: upper[1], direction, price: Number(words[3]), label: `Alert when ${upper[1]} ${direction === 'above' ? 'rises above' : 'falls below'} $${Number(words[3])}` };
  }
  // NVDA vs AMD [vs INTC]
  if (upper.length >= 3 && upper[1] === 'VS' && TICKER.test(upper[0])) {
    const peers = upper.slice(2).filter((word) => word !== 'VS' && TICKER.test(word));
    if (peers.length) return { kind: 'navigate', href: `/company/${upper[0]}?tab=comps&peers=${peers.join(',')}`, label: `Compare ${upper[0]} with ${peers.join(', ')}` };
  }
  // A screen function on its own: ECO, TOP, PORT…
  if (upper.length === 1 && SCREEN_FUNCTIONS[upper[0]]) {
    const fn = SCREEN_FUNCTIONS[upper[0]];
    return { kind: 'navigate', href: fn.href, label: `${upper[0]} · ${fn.label}` };
  }
  // TICKER FUNCTION [GO]
  if (upper.length >= 2 && TICKER.test(upper[0])) {
    const fn = upper[1] === 'GO' ? 'DES' : upper[1];
    if (COMPANY_FUNCTIONS[fn]) {
      const spec = COMPANY_FUNCTIONS[fn];
      return { kind: 'navigate', href: `/company/${upper[0]}${spec.tab ? `?tab=${spec.tab}` : ''}`, label: `${upper[0]} ${fn} · ${spec.label}` };
    }
    if (fn === 'EVT' || fn === 'EVENT') return { kind: 'navigate', href: `/lab?symbol=${upper[0]}`, label: `${upper[0]} event study` };
    if (fn === 'ASK' || fn === 'GROK') {
      const prompt = words.slice(2).join(' ') || `Give me a sharp overview of ${upper[0]}: what drives it, the latest results, valuation vs peers and the key debates.`;
      return { kind: 'ask', prompt, symbol: upper[0], label: `Ask Grok about ${upper[0]}` };
    }
  }
  return null;
}

/** Help rows shown when the palette opens empty. */
export const COMMAND_EXAMPLES = ['NVDA FA', 'AAPL DCF', 'NVDA vs AMD INTC', 'MSFT INS', 'ECO', 'WL add TSM', 'ALERT MSFT < 400', '? why is oil up today'];
