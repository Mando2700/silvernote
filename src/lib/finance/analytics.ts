/** Portfolio analytics: rebalancing trades, factor regression and Brinson attribution. */

// ─── Rebalancing ────────────────────────────────────────────────────────────

export type RebalanceInput = { symbol: string; price: number | null; marketValue: number };
export type RebalanceTrade = {
  symbol: string;
  currentWeight: number;
  targetWeight: number;
  currentValue: number;
  targetValue: number;
  /** Positive = buy. */
  tradeValue: number;
  shares: number;
  price: number | null;
};

/**
 * Trades that move holdings to target weights of the total (holdings + cash + `addCash`). Symbols with
 * a target but no position are bought; positions without a target are left alone unless
 * `sellUntargeted`. Trades below `minTrade` dollars are skipped; shares round down unless fractional.
 */
export function rebalance(
  holdings: RebalanceInput[],
  targets: Record<string, number>,
  options: { cash: number; addCash?: number; fractional?: boolean; minTrade?: number; sellUntargeted?: boolean; prices?: Record<string, number | null> },
) {
  const total = holdings.reduce((sum, row) => sum + row.marketValue, 0) + options.cash + (options.addCash ?? 0);
  const symbols = [...new Set([...holdings.map((row) => row.symbol), ...Object.keys(targets)])];
  const bySymbol = new Map(holdings.map((row) => [row.symbol, row]));
  const trades: RebalanceTrade[] = [];
  for (const symbol of symbols) {
    const holding = bySymbol.get(symbol);
    const hasTarget = symbol in targets;
    if (!hasTarget && !options.sellUntargeted) continue;
    const price = holding?.price ?? options.prices?.[symbol] ?? null;
    const currentValue = holding?.marketValue ?? 0;
    const targetWeight = hasTarget ? targets[symbol] : 0;
    const targetValue = total * targetWeight;
    let tradeValue = targetValue - currentValue;
    let shares = price ? tradeValue / price : 0;
    if (!options.fractional && price) {
      shares = tradeValue > 0 ? Math.floor(shares) : Math.ceil(shares);
      tradeValue = shares * price;
    }
    if (Math.abs(tradeValue) < (options.minTrade ?? 0)) {
      tradeValue = 0;
      shares = 0;
    }
    trades.push({ symbol, currentWeight: total > 0 ? currentValue / total : 0, targetWeight, currentValue, targetValue, tradeValue, shares, price });
  }
  trades.sort((a, b) => Math.abs(b.tradeValue) - Math.abs(a.tradeValue));
  const netCash = options.cash + (options.addCash ?? 0) - trades.reduce((sum, trade) => sum + trade.tradeValue, 0);
  const targetSum = Object.values(targets).reduce((sum, weight) => sum + weight, 0);
  return { total, trades, cashAfter: netCash, targetCashWeight: Math.max(0, 1 - targetSum), turnover: total > 0 ? trades.reduce((sum, trade) => sum + Math.abs(trade.tradeValue), 0) / (2 * total) : 0 };
}

// ─── OLS regression ─────────────────────────────────────────────────────────

function invert(matrix: number[][]) {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let k = 0; k < 2 * n; k += 1) a[col][k] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = 0; k < 2 * n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row) => row.slice(n));
}

export type Regression = { coefficients: number[]; tStats: number[]; standardErrors: number[]; r2: number; adjustedR2: number; n: number; residualStdev: number };

/** y = b0 + b1·x1 + … by ordinary least squares, with t-statistics. `xs` is observations × regressors. */
export function ols(y: number[], xs: number[][]): Regression | null {
  const n = y.length;
  const k = (xs[0]?.length ?? 0) + 1;
  if (n <= k + 2) return null;
  const X = xs.map((row) => [1, ...row]);
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const xty = Array.from({ length: k }, (_, i) => X.reduce((sum, row, index) => sum + row[i] * y[index], 0));
  const inverse = invert(xtx);
  if (!inverse) return null;
  const beta = inverse.map((row) => row.reduce((sum, value, j) => sum + value * xty[j], 0));
  const fitted = X.map((row) => row.reduce((sum, value, j) => sum + value * beta[j], 0));
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  const ssRes = y.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0);
  const ssTot = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const sigma2 = ssRes / (n - k);
  const standardErrors = inverse.map((row, i) => Math.sqrt(Math.max(0, row[i] * sigma2)));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return {
    coefficients: beta,
    standardErrors,
    tStats: beta.map((value, i) => (standardErrors[i] > 0 ? value / standardErrors[i] : 0)),
    r2,
    adjustedR2: 1 - ((1 - r2) * (n - 1)) / (n - k),
    n,
    residualStdev: Math.sqrt(sigma2),
  };
}

// ─── Brinson-Fachler attribution ────────────────────────────────────────────

export type SegmentInput = { segment: string; portfolioWeight: number; portfolioReturn: number; benchmarkWeight: number; benchmarkReturn: number };

/**
 * Allocation = (wp − wb)(Rb,i − Rb), selection = wb(Rp,i − Rb,i), interaction = (wp − wb)(Rp,i − Rb,i).
 * Their sum over segments equals the portfolio's active return (Rp − Rb).
 */
export function brinson(segments: SegmentInput[]) {
  const benchmarkTotal = segments.reduce((sum, row) => sum + row.benchmarkWeight * row.benchmarkReturn, 0);
  const portfolioTotal = segments.reduce((sum, row) => sum + row.portfolioWeight * row.portfolioReturn, 0);
  const rows = segments.map((row) => {
    const allocation = (row.portfolioWeight - row.benchmarkWeight) * (row.benchmarkReturn - benchmarkTotal);
    const selection = row.benchmarkWeight * (row.portfolioReturn - row.benchmarkReturn);
    const interaction = (row.portfolioWeight - row.benchmarkWeight) * (row.portfolioReturn - row.benchmarkReturn);
    return { ...row, allocation, selection, interaction, total: allocation + selection + interaction };
  });
  return {
    rows,
    portfolioReturn: portfolioTotal,
    benchmarkReturn: benchmarkTotal,
    active: portfolioTotal - benchmarkTotal,
    allocation: rows.reduce((sum, row) => sum + row.allocation, 0),
    selection: rows.reduce((sum, row) => sum + row.selection, 0),
    interaction: rows.reduce((sum, row) => sum + row.interaction, 0),
  };
}

// ─── Minimal ZIP reader (Ken French data library ships zipped CSVs) ────────

/** The first file in a ZIP archive, decompressed. `inflateRaw` is zlib's (passed in to keep this module isomorphic). */
export function unzipFirst(buffer: Uint8Array, inflateRaw: (data: Uint8Array) => Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('Not a ZIP archive.');
  const central = view.getUint32(end + 16, true);
  if (view.getUint32(central, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
  const method = view.getUint16(central + 10, true);
  const compressedSize = view.getUint32(central + 20, true);
  const localOffset = view.getUint32(central + 42, true);
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRaw(data);
  throw new Error(`Unsupported ZIP compression (${method}).`);
}

/** Ken French daily factor CSV → rows keyed by YYYY-MM-DD, values as decimals (the file is in percent). */
export function parseFrenchCsv(text: string) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*,/.test(line) && /[A-Za-z]/.test(line));
  if (headerIndex === -1) return { columns: [] as string[], rows: new Map<string, number[]>() };
  const columns = lines[headerIndex].split(',').slice(1).map((cell) => cell.trim());
  const rows = new Map<string, number[]>();
  for (const line of lines.slice(headerIndex + 1)) {
    const match = line.match(/^\s*(\d{8})\s*,(.*)$/);
    if (!match) {
      if (rows.size) break;
      continue;
    }
    const date = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
    rows.set(date, match[2].split(',').map((cell) => Number(cell.trim()) / 100));
  }
  return { columns, rows };
}
