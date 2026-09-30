import 'server-only';

import { cached } from '@/lib/data/http';
import { fetchFredSeries } from '@/lib/data/providers/fred';
import { fetchYahooDaily, fetchYahooDay } from '@/lib/data/providers/yahoo';

/** Default cross-asset tape (Yahoo symbols). The dashboard lets the investor change it in Settings. */
export const DEFAULT_TAPE = [
  { symbol: '^VIX', label: 'VIX', unit: '' },
  { symbol: '^TNX', label: 'US 10Y', unit: '%' },
  { symbol: 'DX-Y.NYB', label: 'Dollar', unit: '' },
  { symbol: 'CL=F', label: 'WTI oil', unit: '$' },
  { symbol: 'GC=F', label: 'Gold', unit: '$' },
  { symbol: 'BTC-USD', label: 'Bitcoin', unit: '$' },
  { symbol: 'EURUSD=X', label: 'EUR/USD', unit: '' },
] as const;

const KNOWN_LABELS = new Map<string, { label: string; unit: string }>([
  ...DEFAULT_TAPE.map((item) => [item.symbol, { label: item.label, unit: item.unit }] as const),
  ['^GSPC', { label: 'S&P 500', unit: '' }],
  ['^NDX', { label: 'Nasdaq 100', unit: '' }],
  ['^RUT', { label: 'Russell 2000', unit: '' }],
  ['^FVX', { label: 'US 5Y', unit: '%' }],
  ['^IRX', { label: 'US 13W', unit: '%' }],
  ['^TYX', { label: 'US 30Y', unit: '%' }],
  ['NG=F', { label: 'Nat gas', unit: '$' }],
  ['HG=F', { label: 'Copper', unit: '$' }],
  ['SI=F', { label: 'Silver', unit: '$' }],
  ['ETH-USD', { label: 'Ether', unit: '$' }],
  ['USDPLN=X', { label: 'USD/PLN', unit: '' }],
  ['EURPLN=X', { label: 'EUR/PLN', unit: '' }],
  ['USDJPY=X', { label: 'USD/JPY', unit: '' }],
  ['GBPUSD=X', { label: 'GBP/USD', unit: '' }],
  ['^STOXX50E', { label: 'Euro Stoxx 50', unit: '' }],
  ['^N225', { label: 'Nikkei 225', unit: '' }],
  ['^FTSE', { label: 'FTSE 100', unit: '' }],
  ['WIG20.WA', { label: 'WIG20', unit: '' }],
]);

export type TapeItem = { symbol: string; label: string; unit: string; price: number | null; change: number | null; changePct: number | null; spark: number[] };

export async function getMacroTape(symbols?: string[]): Promise<TapeItem[]> {
  const list = symbols?.length ? symbols : DEFAULT_TAPE.map((item) => item.symbol);
  return Promise.all(
    list.map(async (symbol) => {
      const meta = KNOWN_LABELS.get(symbol) ?? { label: symbol, unit: '' };
      const day = await cached(`yahoo-day:${symbol}`, 60, () => fetchYahooDay(symbol)).catch(() => null);
      const step = day && day.spark.length > 48 ? Math.ceil(day.spark.length / 48) : 1;
      return {
        symbol,
        ...meta,
        price: day?.price ?? null,
        change: day?.change ?? null,
        changePct: day?.changePct ?? null,
        spark: day ? day.spark.filter((_, index) => index % step === 0) : [],
      };
    }),
  );
}

type Series = { id: string; label: string; unit: '%' | 'bp' | 'k' | 'index' | '$' | 'x'; transform?: 'yoy' | 'diff' | 'bp'; note: string };

/** The FRED series behind the Macro page, grouped the way a morning macro run reads them. */
export const MACRO_GROUPS: Array<{ group: string; series: Series[] }> = [
  {
    group: 'Rates & policy',
    series: [
      { id: 'DFF', label: 'Fed funds (effective)', unit: '%', note: 'Overnight policy rate.' },
      { id: 'DGS2', label: '2-year Treasury', unit: '%', note: 'Tracks where policy is expected to go.' },
      { id: 'DGS10', label: '10-year Treasury', unit: '%', note: 'Discount-rate anchor for equities.' },
      { id: 'T10Y2Y', label: '10Y − 2Y spread', unit: '%', note: 'Inverted (below 0) has preceded most US recessions.' },
      { id: 'T10Y3M', label: '10Y − 3M spread', unit: '%', note: 'The Fed’s preferred curve-inversion gauge.' },
      { id: 'DFII10', label: '10-year real yield (TIPS)', unit: '%', note: 'The real cost of capital; long-duration growth stocks are sensitive to it.' },
    ],
  },
  {
    group: 'Inflation',
    series: [
      { id: 'CPIAUCSL', label: 'CPI, year over year', unit: '%', transform: 'yoy', note: 'Headline consumer prices.' },
      { id: 'CPILFESL', label: 'Core CPI, year over year', unit: '%', transform: 'yoy', note: 'Ex food and energy.' },
      { id: 'PCEPILFE', label: 'Core PCE, year over year', unit: '%', transform: 'yoy', note: 'The Fed’s 2% target measure.' },
      { id: 'T5YIE', label: '5-year breakeven inflation', unit: '%', note: 'Market-implied inflation expectations.' },
    ],
  },
  {
    group: 'Growth & labor',
    series: [
      { id: 'UNRATE', label: 'Unemployment rate', unit: '%', note: 'Monthly, from the jobs report.' },
      { id: 'PAYEMS', label: 'Payrolls, monthly change', unit: 'k', transform: 'diff', note: 'Nonfarm jobs added.' },
      { id: 'ICSA', label: 'Initial jobless claims', unit: 'k', note: 'Weekly; the timeliest labor signal.' },
      { id: 'SAHMREALTIME', label: 'Sahm rule indicator', unit: '%', note: '0.5 or higher has marked the start of every recession since 1970.' },
      { id: 'UMCSENT', label: 'Consumer sentiment (UMich)', unit: 'index', note: 'Survey of household mood.' },
    ],
  },
  {
    group: 'Credit & liquidity',
    series: [
      { id: 'BAMLH0A0HYM2', label: 'High-yield spread', unit: 'bp', transform: 'bp', note: 'Junk-bond risk premium; widening signals stress.' },
      { id: 'BAMLC0A0CM', label: 'Investment-grade spread', unit: 'bp', transform: 'bp', note: 'Corporate credit risk premium.' },
      { id: 'NFCI', label: 'Chicago Fed financial conditions', unit: 'index', note: 'Below 0 = looser than average.' },
      { id: 'M2SL', label: 'M2 money supply, year over year', unit: '%', transform: 'yoy', note: 'Broad money growth.' },
    ],
  },
];

export type MacroSeries = Series & { latest: number | null; latestDate: string | null; previous: number | null; change: number | null; points: Array<{ date: string; value: number }> };

function transform(points: Array<{ date: string; value: number }>, kind: Series['transform']) {
  if (kind === 'yoy') {
    // Monthly series: compare with the observation 12 entries earlier.
    return points.slice(12).map((point, index) => ({ date: point.date, value: ((point.value / points[index].value) - 1) * 100 }));
  }
  if (kind === 'diff') return points.slice(1).map((point, index) => ({ date: point.date, value: point.value - points[index].value }));
  if (kind === 'bp') return points.map((point) => ({ date: point.date, value: point.value * 100 }));
  return points;
}

async function loadSeries(series: Series, years: number): Promise<MacroSeries> {
  const start = new Date(Date.now() - (years + 1.2) * 365 * 86_400_000).toISOString().slice(0, 10);
  const raw = await cached(`fred:${series.id}:${start.slice(0, 7)}`, 6 * 3600, () => fetchFredSeries(series.id, start)).catch(() => []);
  const cutoff = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
  let points = transform(raw, series.transform).filter((point) => point.date >= cutoff);
  if (series.id === 'ICSA') points = points.map((point) => ({ ...point, value: point.value / 1000 }));
  // Keep charts light: about 260 points per series.
  const step = Math.max(1, Math.ceil(points.length / 260));
  const thinned = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  return {
    ...series,
    latest: latest?.value ?? null,
    latestDate: latest?.date ?? null,
    previous: previous?.value ?? null,
    change: latest && previous ? latest.value - previous.value : null,
    points: thinned,
  };
}

export async function getMacroDashboard(years = 5) {
  const groups = await Promise.all(
    MACRO_GROUPS.map(async (group) => ({ group: group.group, series: await Promise.all(group.series.map((series) => loadSeries(series, years))) })),
  );
  return { groups, source: 'FRED, Federal Reserve Bank of St. Louis' };
}

/** Treasury yield curve today, a month ago and a year ago (FRED constant-maturity series). */
export async function getYieldCurves() {
  const tenors = [
    ['DGS1MO', '1M', 1 / 12], ['DGS3MO', '3M', 0.25], ['DGS6MO', '6M', 0.5], ['DGS1', '1Y', 1], ['DGS2', '2Y', 2],
    ['DGS3', '3Y', 3], ['DGS5', '5Y', 5], ['DGS7', '7Y', 7], ['DGS10', '10Y', 10], ['DGS20', '20Y', 20], ['DGS30', '30Y', 30],
  ] as const;
  const start = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const series = await Promise.all(tenors.map(([id]) => cached(`fred:${id}:${start.slice(0, 7)}`, 6 * 3600, () => fetchFredSeries(id, start)).catch(() => [])));
  const at = (points: Array<{ date: string; value: number }>, daysAgo: number) => {
    const target = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    for (let index = points.length - 1; index >= 0; index -= 1) if (points[index].date <= target) return points[index].value;
    return null;
  };
  return tenors.map(([id, label, years], index) => ({ id, label, years, now: at(series[index], 0), monthAgo: at(series[index], 30), yearAgo: at(series[index], 365) }));
}

/** Daily closes for a Yahoo symbol (charts on the Macro page). */
export function getYahooHistory(symbol: string, range = '1y') {
  return cached(`yahoo-daily:${symbol}:${range}`, 3600, () => fetchYahooDaily(symbol, range));
}
