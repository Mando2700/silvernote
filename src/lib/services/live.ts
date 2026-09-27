import 'server-only';

import { env } from '@/lib/env';
import { getLiveQuote } from '@/lib/services/market';

/**
 * Real-time prices from Finnhub's trade stream. The free tier allows one connection per key and
 * about 50 symbols, so the server keeps a single socket, subscribes to what open pages ask for and
 * fans the trades out to them. The key never leaves the server.
 */

export type LiveTick = { symbol: string; price: number; change: number | null; changePct: number | null; timestamp: number };
type Listener = (ticks: LiveTick[]) => void;

export const MAX_LIVE_SYMBOLS = 50;
const BASELINE_TTL = 30 * 60_000;

class LiveHub {
  private socket: WebSocket | null = null;
  private retryMs = 2_000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refs = new Map<string, number>();
  private listeners = new Map<Listener, Set<string>>();
  private latest = new Map<string, LiveTick>();
  private previousClose = new Map<string, { value: number | null; at: number }>();
  private pending = new Map<string, LiveTick>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** Subscribe a page to symbols; returns the ones that fit under the cap and an unsubscribe function. */
  subscribe(symbols: string[], listener: Listener) {
    const accepted = new Set<string>();
    for (const symbol of symbols) {
      if (!this.refs.has(symbol) && this.refs.size >= MAX_LIVE_SYMBOLS) continue;
      accepted.add(symbol);
      const count = this.refs.get(symbol) ?? 0;
      this.refs.set(symbol, count + 1);
      if (count === 0) this.send({ type: 'subscribe', symbol: wireSymbol(symbol) });
    }
    this.listeners.set(listener, accepted);
    this.ensureRunning();
    void this.prime([...accepted], listener);
    return {
      accepted: [...accepted],
      unsubscribe: () => {
        this.listeners.delete(listener);
        for (const symbol of accepted) {
          const count = (this.refs.get(symbol) ?? 1) - 1;
          if (count > 0) {
            this.refs.set(symbol, count);
          } else {
            this.refs.delete(symbol);
            this.send({ type: 'unsubscribe', symbol: wireSymbol(symbol) });
          }
        }
        if (!this.refs.size) this.stop();
      },
    };
  }

  /** Send the latest known price right away (a REST quote when no trade has arrived yet). */
  private async prime(symbols: string[], listener: Listener) {
    const ticks: LiveTick[] = [];
    await Promise.all(
      symbols.map(async (symbol) => {
        await this.baseline(symbol);
        const latest = this.latest.get(symbol);
        if (latest) ticks.push(latest);
      }),
    );
    if (ticks.length && this.listeners.has(listener)) listener(ticks);
  }

  private async baseline(symbol: string) {
    const known = this.previousClose.get(symbol);
    if (known && Date.now() - known.at < BASELINE_TTL) return;
    const quote = await getLiveQuote(symbol).catch(() => null);
    this.previousClose.set(symbol, { value: quote?.previousClose ?? null, at: Date.now() });
    const current = this.latest.get(symbol);
    if (quote?.price && (!current || (quote.timestamp ?? 0) > current.timestamp)) {
      this.latest.set(symbol, this.tick(symbol, quote.price, quote.timestamp ?? Date.now()));
    }
  }

  private tick(symbol: string, price: number, timestamp: number): LiveTick {
    const previous = this.previousClose.get(symbol)?.value ?? null;
    const change = previous ? price - previous : null;
    return { symbol, price, change, changePct: previous && change !== null ? (change / previous) * 100 : null, timestamp };
  }

  private ensureRunning() {
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), 1_000);
    if (!this.socket && !this.retryTimer) this.connect();
  }

  private connect() {
    this.retryTimer = null;
    if (!env.finnhubKey || !this.refs.size) return;
    const socket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(env.finnhubKey)}`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retryMs = 2_000;
      for (const symbol of this.refs.keys()) this.send({ type: 'subscribe', symbol: wireSymbol(symbol) });
    });
    socket.addEventListener('message', (event) => {
      let message: { type?: string; data?: { s: string; p: number; t: number }[] };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== 'trade' || !message.data) return;
      for (const trade of message.data) {
        const symbol = trade.s.replace('-', '.');
        if (!this.refs.has(symbol) || !(trade.p > 0)) continue;
        const current = this.latest.get(symbol);
        if (current && current.timestamp > trade.t) continue;
        const tick = this.tick(symbol, trade.p, trade.t);
        this.latest.set(symbol, tick);
        this.pending.set(symbol, tick);
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.refs.size) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60_000);
    });
    socket.addEventListener('error', () => socket.close());
  }

  private flush() {
    if (!this.pending.size) return;
    const ticks = [...this.pending.values()];
    this.pending.clear();
    for (const [listener, symbols] of this.listeners) {
      const relevant = ticks.filter((tick) => symbols.has(tick.symbol));
      if (relevant.length) listener(relevant);
    }
  }

  private send(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.retryTimer = null;
    this.flushTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}

/** Finnhub writes class shares with a dash ("BRK-B"). */
function wireSymbol(symbol: string) {
  return symbol.replace('.', '-');
}

// One hub per server process, surviving dev hot reloads.
const globalForLive = globalThis as unknown as { __silvernoteLive?: LiveHub };
export const liveHub = (globalForLive.__silvernoteLive ??= new LiveHub());
