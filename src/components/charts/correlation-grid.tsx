'use client';

import { interpolateLab, scaleLinear } from 'd3';
import { useState } from 'react';

import { cn } from '@/lib/utils';

// Diverging: blue (move opposite) ← gray (unrelated) → red (move together).
const scale = scaleLinear<string>().domain([-1, 0, 1]).range(['#3987e5', '#2a2e36', '#e66767']).interpolate(interpolateLab).clamp(true);

export function CorrelationGrid({ symbols, matrix }: { symbols: string[]; matrix: number[][] }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const size = symbols.length > 14 ? 22 : symbols.length > 9 ? 28 : 36;
  if (symbols.length < 2) return <p className="text-[12px] text-muted">Correlations need at least two holdings with price history.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {symbols.map((symbol, column) => (
                <th key={symbol} className={cn('relative h-14 align-bottom text-center font-mono text-[9.5px] font-medium', hover?.[1] === column ? 'text-ink' : 'text-muted')} style={{ width: size }}>
                  <span className="absolute bottom-1 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap">{symbol}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol, row) => (
              <tr key={symbol}>
                <td className={cn('pr-2 text-right font-mono text-[10px]', hover?.[0] === row ? 'text-ink' : 'text-muted')}>{symbol}</td>
                {symbols.map((other, column) => {
                  const value = matrix[row]?.[column] ?? 0;
                  return (
                    <td
                      key={other}
                      onPointerEnter={() => setHover([row, column])}
                      onPointerLeave={() => setHover(null)}
                      className={cn('rounded-[3px] text-center transition-[outline]', hover?.[0] === row && hover?.[1] === column && 'outline outline-1 outline-white/60')}
                      style={{ width: size, height: size, background: row === column ? '#1c2027' : scale(value) }}
                      title={`${symbol} × ${other}: ${value.toFixed(2)}`}
                    >
                      {size >= 28 && row !== column ? <span className="num text-[9.5px] text-white/85">{value.toFixed(2).replace(/^(-?)0\./, '$1.')}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-muted">
        <span className="num">−1</span>
        <div className="h-1.5 w-32 rounded-full" style={{ background: 'linear-gradient(90deg,#3987e5,#2a2e36,#e66767)' }} />
        <span className="num">+1</span>
        <span className="text-faint">· daily returns, same window as the risk statistics</span>
      </div>
    </div>
  );
}
