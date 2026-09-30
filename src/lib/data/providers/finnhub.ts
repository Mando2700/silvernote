import 'server-only';

import { normalizeSymbol } from '@/lib/data/eligibility';
import { decodeEntities } from '@/lib/data/entities';
import { fetchJson, limiters, ProviderError } from '@/lib/data/http';
import type { NewsItem, Quote } from '@/lib/data/types';
import { env } from '@/lib/env';

/** Finnhub free tier (60 calls/min): real-time quotes, news, peers, key metrics. Optional. */

const BASE = 'https://finnhub.io/api/v1';

export function finnhubEnabled() {
  return Boolean(env.finnhubKey);
}

async function get<T>(path: string, params: Record<string, string>) {
  if (!env.finnhubKey) throw new ProviderError('finnhub', 0, 'FINNHUB_API_KEY is not set');
  const query = new URLSearchParams(params).toString();
  return fetchJson<T>(`${BASE}${path}?${query}`, {
    provider: 'finnhub',
    limiter: limiters.finnhub,
    headers: { 'X-Finnhub-Token': env.finnhubKey },
  });
}

export async function fetchQuote(symbol: string): Promise<Quote | null> {
  const data = await get<{ c: number; d: number | null; dp: number | null; h: number; l: number; o: number; pc: number; t: number }>(
    '/quote',
    { symbol: symbol.replace('.', '-') },
  );
  if (!data || !data.c) return null;
  return {
    symbol: normalizeSymbol(symbol),
    price: data.c,
    change: data.d,
    changePct: data.dp,
    previousClose: data.pc || null,
    open: data.o || null,
    high: data.h || null,
    low: data.l || null,
    timestamp: data.t ? data.t * 1000 : Date.now(),
    source: 'Finnhub',
    realtime: true,
  };
}

export async function fetchProfile(symbol: string) {
  const data = await get<{
    name?: string;
    logo?: string;
    weburl?: string;
    ipo?: string;
    finnhubIndustry?: string;
    marketCapitalization?: number;
    shareOutstanding?: number;
    country?: string;
    currency?: string;
    exchange?: string;
  }>('/stock/profile2', { symbol: symbol.replace('.', '-') });
  return data && data.name ? data : null;
}

export async function fetchMetrics(symbol: string) {
  const data = await get<{ metric?: Record<string, number | string | null> }>('/stock/metric', {
    symbol: symbol.replace('.', '-'),
    metric: 'all',
  });
  return data?.metric ?? {};
}

type FinnhubNews = { category: string; datetime: number; headline: string; id: number; image: string; related: string; source: string; summary: string; url: string };

function toNews(items: FinnhubNews[]): NewsItem[] {
  return items
    .filter((item) => item.headline && item.url)
    .map((item) => ({
      id: `finnhub:${item.id}`,
      title: decodeEntities(item.headline),
      url: item.url,
      source: item.source || 'Finnhub',
      publishedAt: new Date(item.datetime * 1000).toISOString(),
      summary: item.summary ? decodeEntities(item.summary).slice(0, 500) : undefined,
      symbols: item.related ? item.related.split(',').map((entry) => normalizeSymbol(entry)).filter(Boolean) : [],
      image: item.image || null,
      provider: 'finnhub' as const,
      category: item.category,
    }));
}

export async function fetchCompanyNews(symbol: string, days = 14) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  const items = await get<FinnhubNews[]>('/company-news', {
    symbol: symbol.replace('.', '-'),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  return toNews(Array.isArray(items) ? items : []).map((item) => ({ ...item, symbols: item.symbols.length ? item.symbols : [normalizeSymbol(symbol)] }));
}

export async function fetchMarketNews(category: 'general' | 'merger' = 'general') {
  const items = await get<FinnhubNews[]>('/news', { category });
  return toNews(Array.isArray(items) ? items : []);
}

export async function fetchPeers(symbol: string) {
  const peers = await get<string[]>('/stock/peers', { symbol: symbol.replace('.', '-') });
  return Array.isArray(peers) ? peers.map((peer) => normalizeSymbol(peer.replace('-', '.'))) : [];
}

export async function fetchRecommendations(symbol: string) {
  const rows = await get<Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>>(
    '/stock/recommendation',
    { symbol: symbol.replace('.', '-') },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function fetchEarningsSurprises(symbol: string) {
  const rows = await get<Array<{ period: string; actual: number | null; estimate: number | null; surprisePercent: number | null }>>(
    '/stock/earnings',
    { symbol: symbol.replace('.', '-') },
  );
  return Array.isArray(rows) ? rows : [];
}
