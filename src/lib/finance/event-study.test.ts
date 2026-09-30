import { describe, expect, it } from 'vitest';

import { eventStudy } from '@/lib/finance/event-study';

const day = (i: number) => Date.UTC(2025, 0, 1) / 1000 + i * 86_400;

describe('eventStudy', () => {
  it('finds a 5% jump on the event day', () => {
    let m = 100;
    let s = 100;
    const market = [];
    const stock = [];
    for (let i = 0; i < 400; i += 1) {
      const rm = Math.sin(i * 1.3) * 0.01;
      m *= 1 + rm;
      s *= 1 + 1.2 * rm + (i === 300 ? 0.05 : 0);
      market.push({ t: day(i), c: m });
      stock.push({ t: day(i), c: s });
    }
    const eventDate = new Date(day(300) * 1000).toISOString().slice(0, 10);
    const result = eventStudy(stock, market, [eventDate], { window: [-2, 2] });
    const event = result.events[0];
    expect(event.beta).toBeCloseTo(1.2, 2);
    expect(event.abnormal.find((row) => row.day === 0)?.ar).toBeCloseTo(0.05, 3);
    expect(event.car).toBeCloseTo(0.05, 3);
  });
});
