import { describe, expect, it } from 'vitest';

import { parseCommand } from '@/lib/commands';

describe('parseCommand', () => {
  it('routes ticker functions', () => {
    expect(parseCommand('nvda fa')).toMatchObject({ kind: 'navigate', href: '/company/NVDA?tab=financials' });
    expect(parseCommand('AAPL <GO>'.replace('<GO>', 'GO'))).toMatchObject({ href: '/company/AAPL' });
    expect(parseCommand('BRK.B dcf')).toMatchObject({ href: '/company/BRK.B?tab=dcf' });
  });
  it('handles comparisons, screens, watchlists, alerts and questions', () => {
    expect(parseCommand('NVDA vs AMD INTC')).toMatchObject({ href: '/company/NVDA?tab=comps&peers=AMD,INTC' });
    expect(parseCommand('eco')).toMatchObject({ href: '/calendar' });
    expect(parseCommand('WL add tsm Semis')).toMatchObject({ kind: 'watchlist', symbol: 'TSM', list: 'Semis' });
    expect(parseCommand('ALERT msft < 400')).toMatchObject({ kind: 'alert', symbol: 'MSFT', direction: 'below', price: 400 });
    expect(parseCommand('? why is oil up')).toMatchObject({ kind: 'ask', prompt: 'why is oil up' });
  });
  it('ignores plain searches', () => {
    expect(parseCommand('nvidia')).toBeNull();
    expect(parseCommand('apple inc')).toBeNull();
  });
});
