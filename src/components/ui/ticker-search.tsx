'use client';

import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { CompanyLogo } from '@/components/ui/company-logo';
import { compactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Result = { securities: Array<{ symbol: string; name: string; sector: string | null; market_cap: number | null }> };

/** Autocomplete over the full universe; Enter picks the highlighted match or the typed ticker. */
export function TickerSearch({ onPick, placeholder = 'Add ticker…', className, autoFocus }: { onPick: (symbol: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 120);
    return () => clearTimeout(timer);
  }, [value]);
  const { data } = useSWR<Result>(debounced ? `/api/search?q=${encodeURIComponent(debounced)}` : null);
  const results = data?.securities ?? [];

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const pick = (symbol: string) => {
    onPick(symbol.toUpperCase());
    setValue('');
    setOpen(false);
    setActive(0);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const choice = results[active]?.symbol ?? value.trim();
            if (choice) pick(choice);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-sm border border-line-strong bg-surface-1 pr-2.5 pl-8 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-brand/60 focus:shadow-[0_0_0_3px_rgba(205,212,222,0.07)]"
      />
      <AnimatePresence>
        {open && results.length ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="panel absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto bg-surface-3 p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]"
          >
            {results.map((result, index) => (
              <button
                key={result.symbol}
                type="button"
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(result.symbol)}
                className={cn('flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left', index === active ? 'bg-white/[0.07]' : '')}
              >
                <CompanyLogo symbol={result.symbol} size="xs" />
                <span className="w-12 font-mono text-[12px] font-semibold text-ink">{result.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{result.name}</span>
                <span className="num text-[10.5px] text-faint">{compactNumber(result.market_cap)}</span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
