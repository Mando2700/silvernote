import { HttpError } from '@/lib/auth';
import { route, searchParam } from '@/lib/api';
import { finnhubEnabled } from '@/lib/data/providers/finnhub';
import { liveHub, MAX_LIVE_SYMBOLS, type LiveTick } from '@/lib/services/live';

/** Server-sent events: real-time prices for the symbols on screen. */
export const GET = route(async ({ request }) => {
  if (!finnhubEnabled()) throw new HttpError(503, 'Live prices need FINNHUB_API_KEY.');
  const symbols = [
    ...new Set(
      (searchParam(request, 'symbols') ?? '')
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)),
    ),
  ].slice(0, MAX_LIVE_SYMBOLS);
  if (!symbols.length) throw new HttpError(400, 'No symbols.');

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const { accepted, unsubscribe } = liveHub.subscribe(symbols, (ticks: LiveTick[]) => write(`data: ${JSON.stringify(ticks)}\n\n`));
      write(`event: ready\ndata: ${JSON.stringify({ accepted })}\n\n`);
      const heartbeat = setInterval(() => write(': ping\n\n'), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
});
