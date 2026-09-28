/// <reference lib="webworker" />

import { simulate, type MonteCarloInput } from '@/lib/finance/montecarlo';

export { simulate, type MonteCarloInput, type MonteCarloResult } from '@/lib/finance/montecarlo';

// Only wire up messaging inside a real worker (the module is also imported by unit tests).
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<MonteCarloInput>) => {
    try {
      self.postMessage({ ok: true, result: simulate(event.data) });
    } catch (error) {
      self.postMessage({ ok: false, error: (error as Error).message });
    }
  };
}
