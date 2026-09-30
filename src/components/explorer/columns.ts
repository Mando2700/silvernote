import { compactNumber, multiple, pct, price, signedPct } from '@/lib/format';

export type ExplorerRow = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  country: string | null;
  fiscalYear: number | null;
  scoreLabel: string | null;
} & Record<MetricKey, number | null>;

export type MetricKey =
  | 'price' | 'changePct' | 'marketCap' | 'volume' | 'revenue' | 'netIncome' | 'fcf' | 'revenueGrowth' | 'revenueCagr3'
  | 'epsGrowth' | 'grossMargin' | 'operatingMargin' | 'netMargin' | 'fcfMargin' | 'roe' | 'roa' | 'debtToEquity'
  | 'currentRatio' | 'pe' | 'ps' | 'pb' | 'pfcf' | 'evEbitda' | 'fcfYield' | 'dividendYield' | 'score';

export type MetricColumn = {
  key: MetricKey;
  label: string;
  short?: string;
  group: 'Market' | 'Valuation' | 'Growth' | 'Profitability' | 'Health' | 'Size';
  format: (value: number) => string;
  /** Filter inputs are typed in percent for fractional metrics. */
  unit?: '%' | '×' | '$' | '';
  scale?: number;
  better: 'higher' | 'lower';
  width: number;
};

const pctFmt = (value: number) => pct(value, 1);

export const METRIC_COLUMNS: MetricColumn[] = [
  { key: 'price', label: 'Price', group: 'Market', format: (value) => price(value), unit: '$', better: 'higher', width: 84 },
  { key: 'changePct', label: 'Day change', short: 'Day', group: 'Market', format: (value) => signedPct(value, 2, true), unit: '%', better: 'higher', width: 80 },
  { key: 'marketCap', label: 'Market value', short: 'Mkt value', group: 'Size', format: (value) => `$${compactNumber(value)}`, unit: '$', better: 'higher', width: 92 },
  { key: 'score', label: 'SilverNote Score', short: 'Score', group: 'Market', format: (value) => value.toFixed(0), unit: '', better: 'higher', width: 76 },
  { key: 'volume', label: 'Volume', group: 'Market', format: (value) => compactNumber(value), unit: '', better: 'higher', width: 84 },
  { key: 'pe', label: 'P/E', group: 'Valuation', format: (value) => multiple(value), unit: '×', better: 'lower', width: 70 },
  { key: 'ps', label: 'P/S', group: 'Valuation', format: (value) => multiple(value), unit: '×', better: 'lower', width: 70 },
  { key: 'pb', label: 'P/B', group: 'Valuation', format: (value) => multiple(value), unit: '×', better: 'lower', width: 70 },
  { key: 'pfcf', label: 'P/FCF', group: 'Valuation', format: (value) => multiple(value), unit: '×', better: 'lower', width: 74 },
  { key: 'evEbitda', label: 'EV/EBITDA', group: 'Valuation', format: (value) => multiple(value), unit: '×', better: 'lower', width: 86 },
  { key: 'fcfYield', label: 'FCF yield', group: 'Valuation', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 80 },
  { key: 'dividendYield', label: 'Dividend yield (last FY paid)', short: 'Div yld FY', group: 'Valuation', format: (value) => pct(value, 2), unit: '%', scale: 100, better: 'higher', width: 82 },
  { key: 'revenue', label: 'Revenue', group: 'Size', format: (value) => `$${compactNumber(value)}`, unit: '$', better: 'higher', width: 86 },
  { key: 'netIncome', label: 'Net income', group: 'Size', format: (value) => `$${compactNumber(value)}`, unit: '$', better: 'higher', width: 90 },
  { key: 'fcf', label: 'Free cash flow', short: 'FCF', group: 'Size', format: (value) => `$${compactNumber(value)}`, unit: '$', better: 'higher', width: 84 },
  { key: 'revenueGrowth', label: 'Revenue growth', short: 'Rev growth', group: 'Growth', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 90 },
  { key: 'revenueCagr3', label: 'Revenue CAGR 3Y', short: 'Rev 3Y', group: 'Growth', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 78 },
  { key: 'epsGrowth', label: 'EPS growth', group: 'Growth', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 86 },
  { key: 'grossMargin', label: 'Gross margin', short: 'Gross m.', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 82 },
  { key: 'operatingMargin', label: 'Operating margin', short: 'Op. margin', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 88 },
  { key: 'netMargin', label: 'Net margin', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 82 },
  { key: 'fcfMargin', label: 'FCF margin', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 82 },
  { key: 'roe', label: 'Return on equity', short: 'ROE', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 72 },
  { key: 'roa', label: 'Return on assets', short: 'ROA', group: 'Profitability', format: pctFmt, unit: '%', scale: 100, better: 'higher', width: 72 },
  { key: 'debtToEquity', label: 'Debt / equity', short: 'D/E', group: 'Health', format: (value) => multiple(value, 2), unit: '×', better: 'lower', width: 70 },
  { key: 'currentRatio', label: 'Current ratio', short: 'Current', group: 'Health', format: (value) => multiple(value, 2), unit: '×', better: 'higher', width: 76 },
];

export const METRIC_BY_KEY = Object.fromEntries(METRIC_COLUMNS.map((column) => [column.key, column])) as Record<MetricKey, MetricColumn>;

export const DEFAULT_COLUMNS: MetricKey[] = ['price', 'changePct', 'marketCap', 'score', 'pe', 'ps', 'fcfYield', 'revenueGrowth', 'operatingMargin', 'netMargin', 'roe', 'debtToEquity'];

export type Filter = { key: MetricKey; min?: number | null; max?: number | null };

export type ScreenState = {
  search: string;
  sectors: string[];
  industries: string[];
  filters: Filter[];
  sort: { key: MetricKey | 'symbol' | 'name'; dir: 'asc' | 'desc' };
  columns: MetricKey[];
  relative: boolean;
};

export const EMPTY_SCREEN: ScreenState = {
  search: '',
  sectors: [],
  industries: [],
  filters: [],
  sort: { key: 'marketCap', dir: 'desc' },
  columns: DEFAULT_COLUMNS,
  relative: false,
};

export const PRESETS: Array<{ id: string; name: string; description: string; screen: Partial<ScreenState> }> = [
  {
    id: 'quality',
    name: 'Quality compounders',
    description: 'High returns, fat margins, steady growth, modest leverage',
    screen: { filters: [{ key: 'roe', min: 0.15 }, { key: 'operatingMargin', min: 0.2 }, { key: 'revenueCagr3', min: 0.08 }, { key: 'debtToEquity', max: 1 }, { key: 'marketCap', min: 2e9 }], sort: { key: 'score', dir: 'desc' } },
  },
  {
    id: 'value',
    name: 'Deep value',
    description: 'Cheap on earnings and cash flow, still profitable',
    screen: { filters: [{ key: 'pe', max: 12 }, { key: 'fcfYield', min: 0.06 }, { key: 'marketCap', min: 1e9 }], sort: { key: 'fcfYield', dir: 'desc' } },
  },
  {
    id: 'growth',
    name: 'High growth',
    description: 'Revenue up 25%+ with software-like gross margins',
    screen: { filters: [{ key: 'revenueGrowth', min: 0.25 }, { key: 'grossMargin', min: 0.5 }, { key: 'marketCap', min: 1e9 }], sort: { key: 'revenueGrowth', dir: 'desc' } },
  },
  {
    id: 'income',
    name: 'Dividend payers',
    description: 'Yield above 3%, covered by free cash flow',
    screen: { filters: [{ key: 'dividendYield', min: 0.03 }, { key: 'fcfYield', min: 0.04 }, { key: 'debtToEquity', max: 1.5 }, { key: 'marketCap', min: 1e9 }], sort: { key: 'dividendYield', dir: 'desc' } },
  },
  {
    id: 'leaders',
    name: 'Score leaders',
    description: 'SilverNote Score 75+ among large caps',
    screen: { filters: [{ key: 'score', min: 75 }, { key: 'marketCap', min: 10e9 }], sort: { key: 'score', dir: 'desc' } },
  },
];

export const CAP_BUCKETS = [
  { label: 'Mega', min: 200e9, max: null },
  { label: 'Large', min: 10e9, max: 200e9 },
  { label: 'Mid', min: 2e9, max: 10e9 },
  { label: 'Small', min: 300e6, max: 2e9 },
  { label: 'Micro', min: null, max: 300e6 },
] as const;
