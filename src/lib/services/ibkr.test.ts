import { describe, expect, it } from 'vitest';

import { detectSlashOrder, parseFlexDate, parseFlexStatement, toSymbol } from '@/lib/data/providers/ibkr';
import { reconcile } from '@/lib/services/ibkr-reconcile';
import { buildPositions } from '@/lib/services/portfolio';

const STATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="SilverNote" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20250928" toDate="20260926" period="Last365CalendarDays" whenGenerated="20260927;080000">
<CashReport>
<CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="1523.45" />
<CashReportCurrency accountId="U1234567" currency="USD" endingCash="1500" />
</CashReport>
<Trades>
<Trade accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" tradeID="111" dateTime="20260105;101500" tradeDate="20260105" quantity="10" tradePrice="200" ibCommission="-1" taxes="0" buySell="BUY" openCloseIndicator="O" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" tradeID="112" dateTime="20260105;153000" tradeDate="20260105" quantity="-4" tradePrice="210" ibCommission="-1" buySell="SELL" openCloseIndicator="C" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" assetCategory="STK" symbol="BRK B" tradeID="113" dateTime="20260210;100000" tradeDate="20260210" quantity="2" tradePrice="480" ibCommission="-0.5" buySell="BUY" openCloseIndicator="O" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="EUR" assetCategory="STK" symbol="SAP" tradeID="114" dateTime="20260210;100000" tradeDate="20260210" quantity="2" tradePrice="200" buySell="BUY" openCloseIndicator="O" />
<Trade accountId="U1234567" currency="USD" assetCategory="OPT" symbol="AAPL  260320C00200000" tradeID="115" dateTime="20260210;100000" tradeDate="20260210" quantity="1" tradePrice="5" buySell="BUY" openCloseIndicator="O" />
<Trade accountId="U1234567" currency="USD" assetCategory="STK" symbol="TSLA" tradeID="116" dateTime="20260301;100000" tradeDate="20260301" quantity="-3" tradePrice="300" buySell="SELL" openCloseIndicator="O" />
</Trades>
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" position="16" markPrice="230" costBasisPrice="180" costBasisMoney="2880" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="BRK B" position="2" markPrice="500" costBasisPrice="480.25" costBasisMoney="960.5" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="MSFT" position="5" markPrice="400" costBasisPrice="300" costBasisMoney="1500" levelOfDetail="SUMMARY" />
</OpenPositions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

describe('parseFlexStatement', () => {
  const [account] = parseFlexStatement(STATEMENT);

  it('reads US stock executions and skips options, non-USD and shorts', () => {
    expect(account.accountId).toBe('U1234567');
    expect(account.trades.map((trade) => trade.id)).toEqual(['111', '112', '113']);
    expect(account.trades[1]).toMatchObject({ symbol: 'AAPL', side: 'sell', quantity: 4, price: 210, fees: 1, tradedAt: '2026-01-05' });
    expect(account.trades[2].symbol).toBe('BRK.B');
    expect(account.skipped).toBe(3);
  });

  it('reads positions and cash per currency', () => {
    expect(account.hasPositions).toBe(true);
    expect(account.positions.map((position) => position.symbol)).toEqual(['AAPL', 'BRK.B', 'MSFT']);
    expect(account.baseCash).toBe(1523.45);
    expect(account.cashByCurrency).toEqual({ USD: 1500 });
    expect(account.fromDate).toBe('2025-09-28');
  });

  it('rejects responses that are not statements', () => {
    expect(() => parseFlexStatement('<html></html>')).toThrow();
  });
});

describe('flex helpers', () => {
  it('parses the date formats IBKR offers', () => {
    expect(parseFlexDate('20260105')).toBe('2026-01-05');
    expect(parseFlexDate('2026-01-05, 10:15:00')).toBe('2026-01-05');
    expect(parseFlexDate('01/05/2026')).toBe('2026-01-05');
    expect(parseFlexDate('05/01/2026', 'dmy')).toBe('2026-01-05');
    expect(parseFlexDate('05-Jan-26')).toBe('2026-01-05');
    expect(parseFlexDate('13/25/2026')).toBeNull();
    expect(parseFlexDate('')).toBeNull();
  });

  it('works out whether slash dates are month-first or day-first', () => {
    expect(detectSlashOrder({ from: '20250101', to: '20251231' }, ['20250105'])).toBeNull();
    expect(detectSlashOrder({ from: '01/01/2025', to: '12/31/2025' }, ['03/04/2025'])).toBe('mdy');
    expect(detectSlashOrder({ from: '01/01/2025', to: '31/12/2025' }, ['03/04/2025'])).toBe('dmy');
    // All fields ≤ 12: month-first would end the period (Feb 4) before it starts (Dec 3), day-first reads 12 Mar – 2 Apr.
    expect(detectSlashOrder({ from: '12/03/2025', to: '02/04/2025' }, ['01/04/2025'])).toBe('dmy');
    expect(() => detectSlashOrder({ from: '01/01/2025', to: '12/12/2025' }, ['03/04/2025'])).toThrow(/yyyyMMdd/);
  });

  it('reads a day-first statement without swapping day and month', () => {
    const [dayFirst] = parseFlexStatement(
      STATEMENT.replace('fromDate="20250928" toDate="20260926"', 'fromDate="28/09/2025" toDate="26/09/2026"').replace(/tradeDate="20260105"/g, 'tradeDate="05/01/2026"').replace(/dateTime="20260105;/g, 'dateTime="05/01/2026;'),
    );
    expect(dayFirst.trades[0].tradedAt).toBe('2026-01-05');
    expect(dayFirst.fromDate).toBe('2025-09-28');
  });

  it('maps IBKR share classes to dotted tickers', () => {
    expect(toSymbol('BRK B')).toBe('BRK.B');
    expect(toSymbol('AAPL  260320C00200000')).toBeNull();
  });
});

describe('reconcile', () => {
  const [account] = parseFlexStatement(STATEMENT);
  const history = account.trades.map((trade) => ({
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    fees: trade.fees,
    traded_at: trade.tradedAt,
    created_at: trade.executedAt,
  }));
  const adjustments = reconcile(history, account.positions, '2026-09-26');
  const combined = [
    ...history,
    ...adjustments.map((row) => ({ symbol: row.symbol, side: row.side, quantity: row.quantity, price: row.price, fees: 0, traded_at: row.tradedAt, created_at: `${row.tradedAt}T00:00:00Z` })),
  ];
  const positions = buildPositions(combined);

  it('adds opening balances so shares match IBKR', () => {
    expect(positions.get('AAPL')?.shares).toBeCloseTo(16);
    expect(positions.get('MSFT')?.shares).toBeCloseTo(5);
    expect(positions.get('BRK.B')?.shares).toBeCloseTo(2);
    expect(adjustments.find((row) => row.symbol === 'AAPL')).toMatchObject({ side: 'buy', quantity: 10, tradedAt: '2026-01-04', kind: 'open' });
  });

  it('prices openings so the cost basis matches IBKR', () => {
    expect(positions.get('AAPL')?.cost).toBeCloseTo(2880);
    expect(positions.get('MSFT')?.cost).toBeCloseTo(1500);
  });

  it('books a closing sell when history holds more than IBKR', () => {
    const extra = reconcile([...history, { symbol: 'NVDA', side: 'buy', quantity: 3, price: 100, fees: 0, traded_at: '2026-03-01', created_at: '2026-03-01T10:00:00Z' }], account.positions, '2026-09-26');
    expect(extra.find((row) => row.symbol === 'NVDA')).toMatchObject({ side: 'sell', quantity: 3, kind: 'adjust' });
  });
});

describe('buildPositions ordering', () => {
  it('replays same-day trades by execution time', () => {
    const positions = buildPositions([
      { symbol: 'X', side: 'sell', quantity: 5, price: 12, fees: 0, traded_at: '2026-01-05', created_at: '2026-01-05T15:00:00Z' },
      { symbol: 'X', side: 'buy', quantity: 10, price: 10, fees: 0, traded_at: '2026-01-05', created_at: '2026-01-05T10:00:00Z' },
    ]);
    expect(positions.get('X')).toMatchObject({ shares: 5, realized: 10 });
  });
});

