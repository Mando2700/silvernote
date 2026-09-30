import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { brinson, ols, parseFrenchCsv, rebalance, unzipFirst } from '@/lib/finance/analytics';

describe('rebalance', () => {
  it('moves to target weights in whole shares', () => {
    const result = rebalance(
      [
        { symbol: 'A', price: 100, marketValue: 7000 },
        { symbol: 'B', price: 50, marketValue: 3000 },
      ],
      { A: 0.5, B: 0.5 },
      { cash: 0 },
    );
    const a = result.trades.find((trade) => trade.symbol === 'A');
    const b = result.trades.find((trade) => trade.symbol === 'B');
    expect(a?.shares).toBe(-20);
    expect(b?.shares).toBe(40);
    expect(result.cashAfter).toBe(0);
  });
});

describe('ols', () => {
  it('recovers known coefficients', () => {
    const xs = Array.from({ length: 200 }, (_, i) => [Math.sin(i), Math.cos(i * 0.7)]);
    const y = xs.map(([a, b]) => 0.01 + 1.5 * a - 0.5 * b);
    const fit = ols(y, xs);
    expect(fit?.coefficients[0]).toBeCloseTo(0.01);
    expect(fit?.coefficients[1]).toBeCloseTo(1.5);
    expect(fit?.coefficients[2]).toBeCloseTo(-0.5);
    expect(fit?.r2).toBeCloseTo(1);
  });
});

describe('brinson', () => {
  it('sums to the active return', () => {
    const result = brinson([
      { segment: 'Tech', portfolioWeight: 0.6, portfolioReturn: 0.2, benchmarkWeight: 0.3, benchmarkReturn: 0.15 },
      { segment: 'Energy', portfolioWeight: 0.4, portfolioReturn: 0.02, benchmarkWeight: 0.7, benchmarkReturn: 0.05 },
    ]);
    expect(result.allocation + result.selection + result.interaction).toBeCloseTo(result.active);
  });
});

describe('french data', () => {
  it('unzips and parses the daily CSV', () => {
    const csv = 'Header text\n\n,Mkt-RF,SMB,RF\n20260828,  0.50, -0.10, 0.01\n20260831, -0.33, 0.20, 0.01\n\nCopyright\n';
    const body = deflateRawSync(Buffer.from(csv));
    const name = Buffer.from('f.csv');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt16LE(name.length, 26);
    const centralOffset = 30 + name.length + body.length;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt32LE(centralOffset, 16);
    const zip = Buffer.concat([local, name, body, central, name, endRecord]);
    const text = Buffer.from(unzipFirst(zip, (data) => inflateRawSync(data))).toString('utf8');
    const parsed = parseFrenchCsv(text);
    expect(parsed.columns).toEqual(['Mkt-RF', 'SMB', 'RF']);
    expect(parsed.rows.get('2026-08-31')?.[0]).toBeCloseTo(-0.0033);
  });
});
