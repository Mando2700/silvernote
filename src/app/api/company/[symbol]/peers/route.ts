import { route, searchParam, symbolSchema } from '@/lib/api';
import { getPeerSymbols } from '@/lib/services/market';
import { getStoredScores } from '@/lib/services/scores';
import { getGroupStats, getSectorPercentiles, getListings } from '@/lib/services/screener';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const requested = (searchParam(request, 'symbols') ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z0-9.\-]{1,16}$/.test(value))
    .slice(0, 12);
  const universe = await getListings();
  const subject = universe.find((entry) => entry.symbol === symbol) ?? null;
  const suggested = await getPeerSymbols(symbol, 8);
  const peerSymbols = requested.length ? requested : suggested.symbols;
  const peers = peerSymbols.map((peer) => universe.find((entry) => entry.symbol === peer)).filter(Boolean);
  const [sector, industry, percentiles, scores] = await Promise.all([
    subject?.sector ? getGroupStats('sector', subject.sector) : Promise.resolve(null),
    subject?.industry ? getGroupStats('industry', subject.industry) : Promise.resolve(null),
    getSectorPercentiles(symbol),
    getStoredScores([symbol, ...peerSymbols]),
  ]);
  const componentScores = Object.fromEntries(scores.map((row) => [row.symbol, row.sub_scores.map((item) => ({ key: item.key, name: item.name, score: item.score }))]));
  return { subject, peers, suggested, sector, industry, percentiles, componentScores };
});
