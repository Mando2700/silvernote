/**
 * Common-stock filter for the explorer universe and the score sweep: keeps ordinary shares,
 * drops funds, preferreds, warrants, units, rights, notes and blank-check vehicles.
 */
const NON_COMMON_NAME =
  /\b(?:acq|acqu|acquisition corp|blank check|bonds?|debentures?|notes? due|warrants?|preferred|preference|depositary shares? representing|perpetual)\b|\bunits?\b\s*$|\brights?\b\s*$|physical\s+(?:gold|silver|platinum|palladium)|-(?:c?w|u|r)\d*\s*$/i;
const FUND_NAME =
  /\b(?:etf|etn|fund|trust units|advisorshares|direxion|first trust|global x|invesco|ishares|proshares|spdr|vanguard|wisdomtree)\b|\bclo\b/i;
const COUPON_NAME = /\s-\s[A-Z0-9.]+\s+\d+(?:\s+\d+\/\d+)?\s+(?:\d{2}\/\d{2}\/\d{2}|PERP)\b/i;
const DELIMITED_NON_COMMON_SYMBOL = /[.:\-^](?:WS|WT|W|U|R|P[A-Z]?)$/i;
// Nasdaq's fifth letter marks preferreds (P), rights (R), units (U) and warrants (W).
const NASDAQ_FIFTH_CHARACTER = /[PWUR]$/i;

export function isCommonStock(candidate: { symbol: string; name: string; exchange?: string | null }) {
  const symbol = candidate.symbol.trim().toUpperCase();
  const name = candidate.name.trim();
  if (!symbol || !name) return false;
  if (symbol.includes('^')) return false;
  if (FUND_NAME.test(name) || COUPON_NAME.test(name) || NON_COMMON_NAME.test(name)) return false;
  if (DELIMITED_NON_COMMON_SYMBOL.test(symbol)) return false;
  if (symbol.length === 5 && !symbol.includes('.') && NASDAQ_FIFTH_CHARACTER.test(symbol) && /nasdaq/i.test(candidate.exchange ?? 'nasdaq')) {
    return false;
  }
  return true;
}

/** "Apple Inc. Common Stock" → "Apple Inc." */
export function cleanSecurityName(name: string) {
  return name
    .replace(/\s+(?:Class [A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares|Subordinate Voting Shares|Common Units)(?:\s*,?\s*par value.*)?$/i, (match) => {
      const cls = match.match(/Class ([A-Z])/i);
      return cls ? ` Class ${cls[1].toUpperCase()}` : '';
    })
    .replace(/\s+American Depositary Shares?.*$/i, ' ADR')
    .replace(/\s+\(The\)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace('/', '.');
}
