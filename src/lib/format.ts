/** Display formatting shared by server and client. Every function tolerates null. */

const DASH = '—';

export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Fixed decimals without trailing zeros: 400.00 → "400", 416.10 → "416.1". */
function trimFixed(value: number, digits: number) {
  const text = value.toFixed(digits);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

export function compactNumber(value: number | null | undefined, digits = 1) {
  if (!isNum(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${trimFixed(abs / 1e12, digits)}T`;
  if (abs >= 1e9) return `${sign}${trimFixed(abs / 1e9, digits)}B`;
  if (abs >= 1e6) return `${sign}${trimFixed(abs / 1e6, digits)}M`;
  if (abs >= 1e3) return `${sign}${trimFixed(abs / 1e3, digits)}K`;
  return `${sign}${trimFixed(abs, abs >= 100 ? 0 : Math.min(digits + 1, 2))}`;
}

export function money(value: number | null | undefined, options: { compact?: boolean; digits?: number; currency?: string } = {}) {
  if (!isNum(value)) return DASH;
  const symbol = currencySymbol(options.currency ?? 'USD');
  if (options.compact) {
    const compact = compactNumber(Math.abs(value), options.digits ?? 1);
    return `${value < 0 ? '−' : ''}${symbol}${compact}`;
  }
  const digits = options.digits ?? (Math.abs(value) >= 1000 ? 0 : 2);
  const formatted = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? '−' : ''}${symbol}${formatted}`;
}

export function price(value: number | null | undefined) {
  if (!isNum(value)) return DASH;
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 2 : 4;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function currencySymbol(currency: string) {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'JPY':
      return '¥';
    default:
      return `${currency} `;
  }
}

/** 0.1234 → "12.3%" */
export function pct(value: number | null | undefined, digits = 1) {
  if (!isNum(value)) return DASH;
  return `${(value * 100).toFixed(digits)}%`;
}

/** Signed percent with a real minus sign: 0.0123 → "+1.23%", -0.02 → "−2.00%" */
export function signedPct(value: number | null | undefined, digits = 2, alreadyPercent = false) {
  if (!isNum(value)) return DASH;
  const percent = alreadyPercent ? value : value * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  return `${sign}${Math.abs(percent).toFixed(digits)}%`;
}

export function signedMoney(value: number | null | undefined, options: { compact?: boolean; digits?: number } = {}) {
  if (!isNum(value)) return DASH;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${money(Math.abs(value), options)}`;
}

export function signed(value: number | null | undefined, digits = 2) {
  if (!isNum(value)) return DASH;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function multiple(value: number | null | undefined, digits = 1) {
  if (!isNum(value)) return DASH;
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : digits)}×`;
}

export function fixed(value: number | null | undefined, digits = 2) {
  if (!isNum(value)) return DASH;
  return value.toFixed(digits);
}

export function direction(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!isNum(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export function relativeTime(input: string | number | Date | null | undefined) {
  if (!input) return DASH;
  const time = new Date(input).getTime();
  if (!Number.isFinite(time)) return DASH;
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortDate(input: string | number | Date | null | undefined) {
  if (!input) return DASH;
  const date = new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
  if (!Number.isFinite(date.getTime())) return DASH;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(input: string | number | Date | null | undefined) {
  if (!input) return DASH;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return DASH;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function plural(count: number, word: string, pluralWord = `${word}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? word : pluralWord}`;
}
