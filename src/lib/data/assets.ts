/**
 * Commodities and crypto: not securities, so they live outside the stock universe. Each gets an app symbol that
 * passes the ticker rules (Yahoo's `=` and `^` don't) and is priced from Yahoo under its own symbol.
 */
export type AssetKind = 'commodity' | 'crypto';

/** Exchange contract terms for a futures-priced commodity. */
export type Contract = { size: string; tick: string };

export type Asset = {
  symbol: string;
  yahoo: string;
  name: string;
  kind: AssetKind;
  aliases: string[];
  description: string;
  contract?: Contract;
  /** CoinGecko coin id, for market cap and supply. */
  coingecko?: string;
};

/** CME Globex hours, shared by every COMEX and NYMEX contract listed here. */
export const GLOBEX_HOURS = 'Sun–Fri, 6:00 pm – 5:00 pm ET (daily 1-hour break)';

export const ASSETS: Asset[] = [
  { symbol: 'GC-F', yahoo: 'GC=F', name: 'Gold', kind: 'commodity', aliases: ['gold', 'xau'], description: 'COMEX gold futures (front month), in US dollars per troy ounce.', contract: { size: '100 troy oz', tick: '$0.10 = $10' } },
  { symbol: 'SI-F', yahoo: 'SI=F', name: 'Silver', kind: 'commodity', aliases: ['silver', 'xag'], description: 'COMEX silver futures (front month), in US dollars per troy ounce.', contract: { size: '5,000 troy oz', tick: '$0.005 = $25' } },
  { symbol: 'PL-F', yahoo: 'PL=F', name: 'Platinum', kind: 'commodity', aliases: ['platinum', 'xpt'], description: 'NYMEX platinum futures (front month), in US dollars per troy ounce.', contract: { size: '50 troy oz', tick: '$0.10 = $5' } },
  { symbol: 'PA-F', yahoo: 'PA=F', name: 'Palladium', kind: 'commodity', aliases: ['palladium', 'xpd'], description: 'NYMEX palladium futures (front month), in US dollars per troy ounce.', contract: { size: '100 troy oz', tick: '$0.50 = $50' } },
  { symbol: 'HG-F', yahoo: 'HG=F', name: 'Copper', kind: 'commodity', aliases: ['copper'], description: 'COMEX copper futures (front month), in US dollars per pound.', contract: { size: '25,000 lb', tick: '$0.0005 = $12.50' } },
  { symbol: 'CL-F', yahoo: 'CL=F', name: 'Crude Oil (WTI)', kind: 'commodity', aliases: ['oil', 'crude', 'wti'], description: 'NYMEX West Texas Intermediate crude oil futures (front month), in US dollars per barrel.', contract: { size: '1,000 barrels', tick: '$0.01 = $10' } },
  { symbol: 'BZ-F', yahoo: 'BZ=F', name: 'Brent Crude Oil', kind: 'commodity', aliases: ['brent', 'oil'], description: 'NYMEX Brent crude oil futures (front month, financially settled), in US dollars per barrel.', contract: { size: '1,000 barrels', tick: '$0.01 = $10' } },
  { symbol: 'NG-F', yahoo: 'NG=F', name: 'Natural Gas', kind: 'commodity', aliases: ['natural gas', 'natgas', 'gas'], description: 'NYMEX Henry Hub natural gas futures (front month), in US dollars per million BTU.', contract: { size: '10,000 MMBtu', tick: '$0.001 = $10' } },
  { symbol: 'BTC-USD', yahoo: 'BTC-USD', name: 'Bitcoin', kind: 'crypto', aliases: ['bitcoin', 'btc'], description: 'Bitcoin priced in US dollars. Trades around the clock.', coingecko: 'bitcoin' },
  { symbol: 'ETH-USD', yahoo: 'ETH-USD', name: 'Ethereum', kind: 'crypto', aliases: ['ethereum', 'eth', 'ether'], description: 'Ether, the native token of the Ethereum network, priced in US dollars. Trades around the clock.', coingecko: 'ethereum' },
  { symbol: 'SOL-USD', yahoo: 'SOL-USD', name: 'Solana', kind: 'crypto', aliases: ['solana', 'sol'], description: 'SOL, the native token of the Solana network, priced in US dollars. Trades around the clock.', coingecko: 'solana' },
  { symbol: 'XRP-USD', yahoo: 'XRP-USD', name: 'XRP', kind: 'crypto', aliases: ['xrp', 'ripple'], description: 'XRP priced in US dollars. Trades around the clock.', coingecko: 'ripple' },
  { symbol: 'DOGE-USD', yahoo: 'DOGE-USD', name: 'Dogecoin', kind: 'crypto', aliases: ['dogecoin', 'doge'], description: 'Dogecoin priced in US dollars. Trades around the clock.', coingecko: 'dogecoin' },
];

const BY_SYMBOL = new Map(ASSETS.map((asset) => [asset.symbol, asset]));

export function getAsset(symbol: string) {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** Assets whose symbol, name or alias starts with the term (or whose name contains it). */
export function searchAssets(term: string) {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  return ASSETS.filter(
    (asset) =>
      asset.symbol.toLowerCase().startsWith(query) ||
      asset.name.toLowerCase().includes(query) ||
      asset.aliases.some((alias) => alias.startsWith(query)),
  );
}

export const ASSET_KIND_LABEL: Record<AssetKind, string> = { commodity: 'Commodity', crypto: 'Crypto' };
