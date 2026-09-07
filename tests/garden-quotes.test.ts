// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createQuoteProvider, validateYahooQuote } from '@/garden/quotes';

const bar = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
function chart() { return { chart: { error: null, result: [{
  meta: { symbol: '123A.T', currency: 'JPY', exchangeTimezoneName: 'Asia/Tokyo', dataGranularity: '1d' },
  timestamp: [bar('2026-09-03'), bar('2026-09-04'), bar('2026-09-07')],
  indicators: { quote: [{ close: [10.1, 11.2, 12.3] }] },
}] } }; }

describe('Yahoo completed-session quote validation', () => {
  it('bounds stalled fetches, total work, concurrency and provider response bytes', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const provider = createQuoteProvider({ fetcher, now: () => new Date('2026-09-07T06:30:00Z') });
      const codes = Array.from({ length: 200 }, (_, i) => String(1000 + i));
      const resultPromise = provider.getQuotes(codes);
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await resultPromise;
      expect(result.failedCodes).toEqual(codes);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9);
      expect(fetcher.mock.calls.every(call => call[1]?.signal instanceof AbortSignal)).toBe(true);
    } finally { vi.useRealTimers(); }
    const huge = createQuoteProvider({ fetcher: async () => new Response('x'.repeat(131073)) });
    expect((await huge.getQuotes(['123A'])).failedCodes).toEqual(['123A']);
  });
  it('deduplicates fixed-origin requests, caches public symbols and expires at session close', async () => {
    let now = new Date('2026-09-07T06:29:00Z');
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(chart()));
    const provider = createQuoteProvider({ fetcher, now: () => now });
    const result = await provider.getQuotes(['123A', '123A', '9999']);
    expect(Object.keys(result.quotes)).toEqual(['123A']);
    expect(result.failedCodes).toEqual(['9999']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://query1.finance.yahoo.com/v8/finance/chart/123A.T?interval=1d&range=1mo');
    await provider.getQuotes(['123A']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = new Date('2026-09-07T06:30:01Z');
    expect((await provider.getQuotes(['123A'])).quotes['123A'].date).toBe('2026-09-07');
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(provider.getQuotes(['../attack'])).rejects.toThrow('Invalid garden');
  });
  it('rejects wrong identity, currency, timezone, malformed arrays and stale or invalid closes', () => {
    const now = new Date('2026-09-07T06:30:00Z');
    for (const meta of [{ symbol: '9999.T' }, { currency: 'USD' }, { exchangeTimezoneName: 'America/New_York' }, { dataGranularity: '1m' }]) {
      const data = chart(); Object.assign(data.chart.result[0].meta, meta);
      expect(validateYahooQuote('123A', data, now)).toBeNull();
    }
    for (const data of [null, {}, { chart: { error: { code: 'Not Found' }, result: null } }]) {
      expect(validateYahooQuote('123A', data, now)).toBeNull();
    }
    for (const close of [null, 0, -1, Infinity, NaN, 1000001, '12.3']) {
      const data = chart(); data.chart.result[0].indicators.quote[0].close = [close, close, close] as number[];
      expect(validateYahooQuote('123A', data, now)).toBeNull();
    }
    const mismatch = chart(); mismatch.chart.result[0].timestamp.pop();
    expect(validateYahooQuote('123A', mismatch, now)).toBeNull();
    const duplicate = chart(); duplicate.chart.result[0].timestamp[1] = duplicate.chart.result[0].timestamp[0];
    expect(validateYahooQuote('123A', duplicate, now)).toBeNull();
    expect(validateYahooQuote('123A', chart(), new Date('2026-10-07T06:30:00Z'))).toBeNull();
    expect(validateYahooQuote('../attack', chart(), now)).toBeNull();
    expect(validateYahooQuote('123A', chart(), new Date('invalid'))).toBeNull();
    const floating = chart(); floating.chart.result[0].indicators.quote[0].close[2] = 12.300000190734863;
    expect(validateYahooQuote('123A', floating, now)?.close).toBe('12.3');
  });
  it('selects the newest completed JST daily close, not the intraday bar or adjusted price', () => {
    expect(validateYahooQuote('123A', chart(), new Date('2026-09-07T06:29:59Z')))
      .toEqual({ code: '123A', close: '11.2', date: '2026-09-04', source: 'Yahoo Finance (daily close, JPY)' });
    expect(validateYahooQuote('123A', chart(), new Date('2026-09-07T06:30:00Z'))?.date).toBe('2026-09-07');
  });
});
