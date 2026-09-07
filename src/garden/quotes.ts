import { GardenValidationError, isFinancialDecimal, isJpxCode, type Quote, type QuoteMap } from './domain';
import { readGardenJson } from './body';
const DAY = 86_400_000;
export type QuoteResult = { quotes: QuoteMap; failedCodes: string[] };
export function createQuoteProvider({ fetcher = fetch, now = () => new Date() }: { fetcher?: typeof fetch; now?: () => Date } = {}) {
  // Public security-code cache only. No user IDs, lots, amounts or request headers.
  const cache = new Map<string, { quote: Quote | null; until: number }>();
  const pending = new Map<string, Promise<Quote | null>>();
  let active = 0;
  async function obtain(code: string, remainingMs: number): Promise<Quote | null> {
    const clock = now(), cached = cache.get(code);
    if (cached && cached.until > clock.getTime()) return cached.quote;
    if (pending.has(code)) return pending.get(code)!;
    if (active >= 3 || remainingMs <= 0) return null;
    active++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const job = (async () => {
      let quote: Quote | null = null;
      try {
        quote = await Promise.race([
          (async () => {
            const response = await fetcher(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?interval=1d&range=1mo`,
              { redirect: 'error', cache: 'no-store', signal: controller.signal });
            return response.ok ? validateYahooQuote(code, await readGardenJson(response, 131_072), clock) : null;
          })(),
          new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.min(4000, remainingMs)); }),
        ]);
      } catch { quote = null; }
      finally { clearTimeout(timer!); active--; pending.delete(code); }
      const today = new Date(clock.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
      let boundary = Date.parse(`${today}T15:30:00+09:00`);
      if (boundary <= clock.getTime()) boundary += DAY;
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(code, { quote, until: Math.min(boundary, clock.getTime() + (quote ? 3600_000 : 30_000)) });
      return quote;
    })();
    pending.set(code, job);
    return job;
  }
  return {
    async getQuotes(codes: string[]): Promise<QuoteResult> {
      if (codes.length > 200 || codes.some(code => !isJpxCode(code))) throw new GardenValidationError();
      const unique = [...new Set(codes)], found = new Map<string, Quote>();
      const deadline = Date.now() + 10_000;
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
        while (index < unique.length) {
          const code = unique[index++];
          const quote = await obtain(code, deadline - Date.now());
          if (quote) found.set(code, quote);
        }
      }));
      const quotes: QuoteMap = {}, failedCodes: string[] = [];
      for (const code of unique) {
        const quote = found.get(code);
        if (quote) quotes[code] = { ...quote }; else failedCodes.push(code);
      }
      return { quotes, failedCodes };
    },
  };
}
export const gardenQuoteProvider = createQuoteProvider();
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function validateYahooQuote(code: string, body: unknown, now = new Date()): Quote | null {
  if (!isJpxCode(code) || !Number.isFinite(now.getTime())) return null;
  const chart = object(object(body)?.chart);
  if (!chart || chart.error !== null || !Array.isArray(chart.result) || chart.result.length !== 1) return null;
  const result = object(chart.result[0]), meta = object(result?.meta);
  const series = object(result?.indicators)?.quote;
  const close = Array.isArray(series) && series.length === 1 ? object(series[0])?.close : null;
  const timestamps = result?.timestamp;
  if (meta?.symbol !== `${code}.T` || meta.currency !== 'JPY' || meta.exchangeTimezoneName !== 'Asia/Tokyo'
    || meta.dataGranularity !== '1d' || !Array.isArray(timestamps) || !Array.isArray(close)
    || !timestamps.length || timestamps.length > 32 || timestamps.length !== close.length) return null;
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString();
  let selected: Quote | null = null, previous = '';
  for (let index = 0; index < timestamps.length; index++) {
    const timestamp: unknown = timestamps[index];
    if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > now.getTime() / 1000) return null;
    const session = new Date(timestamp * 1000 + 9 * 3600_000);
    const date = session.toISOString().slice(0, 10);
    if (date <= previous || session.getUTCDay() === 0 || session.getUTCDay() === 6) return null;
    previous = date;
    if (date === today.slice(0, 10) && today.slice(11, 16) < '15:30') continue;
    const value: unknown = close[index];
    if (value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
    // Yahoo binary floating prices are explicitly rounded to 4 JPY decimals.
    const decimal = value.toFixed(4).replace(/\.?0+$/, '');
    if (!isFinancialDecimal(decimal) || Number(decimal) === 0) return null;
    selected = { code, close: decimal, date, source: 'Yahoo Finance (daily close, JPY)' };
  }
  // Holidays need no invented calendar. Reject quotes older than ten calendar days.
  return selected && now.getTime() - Date.parse(`${selected.date}T00:00:00+09:00`) <= 10 * DAY ? selected : null;
}
