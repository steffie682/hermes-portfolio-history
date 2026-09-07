// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createGardenHandlers } from '@/garden/http';

describe('garden HTTP resource limits', () => {
  it('rate limits each authenticated owner before starting quote work', async () => {
    const getQuotes = vi.fn(async () => ({ quotes: {}, failedCodes: [] }));
    const handlers = createGardenHandlers({
      sessionStore: { findActiveUserByTokenHash: async () => 'resource-test-owner' }, expectedOrigin: 'http://localhost',
      repository: { load: async () => ({ revision: 0, lots: [] }), save: vi.fn() }, quoteProvider: { getQuotes },
    });
    const req = () => new NextRequest('http://localhost/api/garden/quotes', { headers: { cookie: 'portfolio_session=resource-test' } });
    for (let i = 0; i < 6; i++) expect((await handlers.quotes(req())).status).toBe(200);
    const limited = await handlers.quotes(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(getQuotes).toHaveBeenCalledTimes(6);
  });
  it('times out a slow request body and never saves partial input', async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const handlers = createGardenHandlers({ sessionStore: { findActiveUserByTokenHash: async () => 'slow-body-owner' },
        expectedOrigin: 'http://localhost', repository: { load: vi.fn(), save } });
      const request = new NextRequest('http://localhost/api/garden', { method: 'PUT',
        headers: { cookie: 'portfolio_session=test', origin: 'http://localhost', 'content-type': 'application/json' },
        body: new ReadableStream({ start() {} }), duplex: 'half',
      } as ConstructorParameters<typeof NextRequest>[1]);
      const result = handlers.put(request);
      await vi.advanceTimersByTimeAsync(3001);
      expect((await result).status).toBe(408);
      expect(save).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
