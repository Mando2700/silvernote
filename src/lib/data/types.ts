/** Daily bar. `t` is epoch seconds at 00:00 UTC of the trading day. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number | null };

export type Quote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  previousClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  /** Epoch milliseconds of the last trade (or last close). */
  timestamp: number | null;
  source: string;
  realtime?: boolean;
};

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  symbols: string[];
  image?: string | null;
  provider: 'finnhub' | 'nasdaq' | 'fmp' | 'sec';
  category?: string;
};

export type Filing = {
  form: string;
  filedAt: string;
  reportDate: string | null;
  accession: string;
  primaryDocument: string;
  description: string | null;
  url: string;
};

export type CompanyProfile = {
  symbol: string;
  name: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  country: string | null;
  website: string | null;
  ceo: string | null;
  employees: number | null;
  ipoDate: string | null;
  logo: string | null;
  cik: string | null;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  oneYearTarget: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  annualDividend: number | null;
  exDividendDate: string | null;
  averageVolume: number | null;
  high52: number | null;
  low52: number | null;
};

export type SecurityRow = {
  symbol: string;
  name: string;
  exchange: string | null;
  cik: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  ipoYear: number | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  isCommon: boolean;
};
