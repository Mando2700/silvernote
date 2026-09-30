'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useShell } from '@/components/shell/providers';
import { Modal } from '@/components/ui/overlay';
import { Kbd } from '@/components/ui/primitives';

const GO: Record<string, { href: string; label: string }> = {
  d: { href: '/', label: 'Dashboard' },
  t: { href: '/terminal', label: 'Terminal' },
  e: { href: '/explorer', label: 'Explorer' },
  m: { href: '/macro', label: 'Macro' },
  c: { href: '/calendar', label: 'Calendar' },
  n: { href: '/news', label: 'News' },
  w: { href: '/watchlists', label: 'Watchlists' },
  p: { href: '/portfolio', label: 'Portfolio' },
  j: { href: '/journal', label: 'Decision journal' },
  b: { href: '/backtest', label: 'Backtest' },
  s: { href: '/simulations', label: 'Simulations' },
  o: { href: '/notes', label: 'Notes' },
  l: { href: '/lab', label: 'Research lab' },
  a: { href: '/assistant', label: 'Grok' },
  ',': { href: '/settings', label: 'Settings' },
};

function typing(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/** Rows opted into keyboard navigation on the visible page. */
function rows() {
  return [...document.querySelectorAll<HTMLElement>('main [data-nav-row]')].filter((element) => element.offsetParent !== null);
}

/**
 * Keyboard-first navigation: `/` command line, `g` then a letter to jump, `j`/`k` through table
 * rows with Enter to open, `?` for this list.
 */
export function Shortcuts() {
  const router = useRouter();
  const { setPaletteOpen, paletteOpen } = useShell();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || paletteOpen || typing(event.target)) return;
      const key = event.key;
      if (Date.now() - pendingG < 1200) {
        pendingG = 0;
        const target = GO[key.toLowerCase()];
        if (target) {
          event.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (key === 'g') {
        pendingG = Date.now();
        return;
      }
      if (key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (key === '?') {
        event.preventDefault();
        setHelp((value) => !value);
      } else if (key === 'j' || key === 'k' || key === 'ArrowDown' || key === 'ArrowUp') {
        const list = rows();
        if (!list.length) return;
        const current = list.indexOf(document.activeElement as HTMLElement);
        if ((key === 'ArrowDown' || key === 'ArrowUp') && current === -1) return;
        event.preventDefault();
        const next = current === -1 ? 0 : Math.max(0, Math.min(list.length - 1, current + (key === 'j' || key === 'ArrowDown' ? 1 : -1)));
        list[next].focus({ preventScroll: false });
        list[next].scrollIntoView({ block: 'nearest' });
      } else if (key === 'Enter' && (document.activeElement as HTMLElement | null)?.hasAttribute('data-nav-row')) {
        event.preventDefault();
        (document.activeElement as HTMLElement).click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, setPaletteOpen, paletteOpen]);

  return (
    <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" className="max-w-xl">
      <div className="grid gap-4 text-[12.5px] sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="kicker mb-1">Anywhere</div>
          <Row keys={['⌘', 'K']} label="Command line & search" />
          <Row keys={['/']} label="Command line" />
          <Row keys={['⌘', 'J']} label="Ask Grok" />
          <Row keys={['j', 'k']} label="Move through table rows" />
          <Row keys={['↵']} label="Open the focused row" />
          <Row keys={['?']} label="This list" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="kicker mb-1">Go to (press g, then)</div>
          {Object.entries(GO).map(([key, target]) => (
            <Row key={key} keys={['g', key]} label={target.label} />
          ))}
        </div>
        <div className="sm:col-span-2">
          <div className="kicker mb-1">Command line examples</div>
          <p className="font-mono text-[11.5px] leading-relaxed text-muted">NVDA FA · AAPL DCF · MSFT COMP · NVDA vs AMD INTC · TSLA INS · ECO · MACRO · PORT · ATTR · WL add TSM · ALERT MSFT &lt; 400 · ? what moved yields today</p>
        </div>
      </div>
    </Modal>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className="flex gap-0.5">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </div>
  );
}
