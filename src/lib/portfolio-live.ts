import type { LivePrice } from '@/lib/live-client';

type LiveHolding = {
  symbol: string;
  shares: number;
  costBasis: number;
  price: number | null;
  marketValue: number;
  dayChange: number;
  dayChangePct: number | null;
  extendedPrice?: number | null;
  extendedChange?: number;
  extendedChangePct?: number | null;
  unrealized: number;
  unrealizedPct: number | null;
  weight: number;
  priceAsOf?: number | null;
};

export type LiveDetail = {
  holdings: LiveHolding[];
  summary: {
    totalValue: number;
    invested: number;
    fixedIncome: number;
    cash: number;
    costBasis: number;
    unrealized: number;
    unrealizedPct: number | null;
    dayChange: number;
    dayChangePct: number | null;
    extended?: { session: 'pre' | 'post'; change: number; changePct: number | null } | null;
  };
};

/** Revalue holdings and the summary with real-time prices (same arithmetic as the server). */
export function withLivePrices<T extends LiveDetail>(detail: T, live: Record<string, LivePrice | undefined>): T {
  if (!detail.holdings.some((holding) => live[holding.symbol])) return detail;
  const holdings = detail.holdings.map((holding) => {
    const tick = live[holding.symbol];
    if (!tick) return holding;
    // Outside regular hours, trades move the extended-session price; the regular close stays put.
    if (holding.extendedPrice != null && holding.price !== null) {
      if (tick.timestamp <= (holding.priceAsOf ?? 0)) return holding;
      const change = tick.price - holding.price;
      return { ...holding, extendedPrice: tick.price, extendedChange: change * holding.shares, extendedChangePct: holding.price ? (change / holding.price) * 100 : null };
    }
    const marketValue = tick.price * holding.shares;
    return {
      ...holding,
      price: tick.price,
      marketValue,
      dayChange: tick.change !== null ? tick.change * holding.shares : holding.dayChange,
      dayChangePct: tick.changePct ?? holding.dayChangePct,
      unrealized: marketValue - holding.costBasis,
      unrealizedPct: holding.costBasis > 0 ? (marketValue - holding.costBasis) / holding.costBasis : null,
    };
  });
  const invested = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const total = invested + detail.summary.fixedIncome + detail.summary.cash;
  const dayChange = holdings.reduce((sum, holding) => sum + holding.dayChange, 0);
  const extendedChange = holdings.reduce((sum, holding) => sum + (holding.extendedChange ?? 0), 0);
  const costBasis = detail.summary.costBasis;
  return {
    ...detail,
    holdings: holdings.map((holding) => ({ ...holding, weight: total > 0 ? holding.marketValue / total : 0 })),
    summary: {
      ...detail.summary,
      totalValue: total,
      invested,
      unrealized: invested - costBasis,
      unrealizedPct: costBasis > 0 ? (invested - costBasis) / costBasis : null,
      dayChange,
      dayChangePct: total - dayChange > 0 ? dayChange / (total - dayChange) : null,
      extended: detail.summary.extended ? { ...detail.summary.extended, change: extendedChange, changePct: total > 0 ? extendedChange / total : null } : null,
    },
  };
}
