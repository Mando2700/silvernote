import 'server-only';

import { fetchJson, limiters } from '@/lib/data/http';

/** CoinGecko's keyless public API: market cap, supply and all-time highs for crypto, which no stock source carries. */

type CoinPayload = {
  market_cap_rank?: number | null;
  genesis_date?: string | null;
  hashing_algorithm?: string | null;
  links?: { homepage?: string[]; whitepaper?: string | null };
  description?: { en?: string };
  market_data?: {
    market_cap?: { usd?: number };
    fully_diluted_valuation?: { usd?: number };
    total_volume?: { usd?: number };
    ath?: { usd?: number };
    ath_date?: { usd?: string };
    atl?: { usd?: number };
    atl_date?: { usd?: string };
    circulating_supply?: number | null;
    total_supply?: number | null;
    max_supply?: number | null;
  };
};

export type CoinDetails = {
  rank: number | null;
  marketCap: number | null;
  fullyDiluted: number | null;
  volume24h: number | null;
  allTimeHigh: number | null;
  allTimeHighDate: string | null;
  allTimeLow: number | null;
  allTimeLowDate: string | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  launched: string | null;
  algorithm: string | null;
  website: string | null;
  whitepaper: string | null;
  description: string | null;
};

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** CoinGecko descriptions are HTML with several paragraphs: keep the text of the first two. */
function plainDescription(html: string | undefined) {
  if (!html) return null;
  const paragraphs = html
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return paragraphs.slice(0, 2).join('\n\n') || null;
}

export async function fetchCoin(id: string): Promise<CoinDetails> {
  const coin = await fetchJson<CoinPayload>(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
    { provider: 'coingecko', limiter: limiters.coingecko },
  );
  const market = coin.market_data ?? {};
  return {
    rank: coin.market_cap_rank ?? null,
    marketCap: num(market.market_cap?.usd),
    fullyDiluted: num(market.fully_diluted_valuation?.usd),
    volume24h: num(market.total_volume?.usd),
    allTimeHigh: num(market.ath?.usd),
    allTimeHighDate: market.ath_date?.usd ?? null,
    allTimeLow: num(market.atl?.usd),
    allTimeLowDate: market.atl_date?.usd ?? null,
    circulatingSupply: num(market.circulating_supply),
    totalSupply: num(market.total_supply),
    maxSupply: num(market.max_supply),
    launched: coin.genesis_date ?? null,
    algorithm: coin.hashing_algorithm ?? null,
    website: coin.links?.homepage?.find(Boolean) ?? null,
    whitepaper: coin.links?.whitepaper || null,
    description: plainDescription(coin.description?.en),
  };
}
