// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createAuthRepository } from '@/auth/repository';
import { hashSessionToken } from '@/auth/session-token';
import type { AppDatabase } from '@/db/client';
import { createGardenRepository } from '@/garden/repository';
import { createGardenHandlers } from '@/garden/http';
import { applyAllMigrations } from './helpers/migrations';

const syntheticLot = { id: '00000000-0000-4000-8000-000000000001', code: '123A', name: 'Synthetic', account: 'nisa',
  shares: '10', costPerShare: '100', purchasedOn: null, confirmedOn: '2026-09-01', purchaseDps: null,
  currentDps: null, priorYearDps: null, dividendAsOf: null, dividendSource: null, memo: '' };
function request(method = 'GET', body?: unknown, token = 'garden-a', origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/garden?ownerUserId=garden-b&codes=9999', {
    method, headers: { cookie: `portfolio_session=${token}`, origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('garden private HTTP boundary', () => {
  it('authenticates, persists CAS corrections, rejects owner injection and quotes only owned codes', async () => {
    const client = new PGlite();
    try {
      await client.exec('create role portfolio_app nologin; grant usage on schema public to portfolio_app;');
      await applyAllMigrations(client);
      await client.exec(`insert into "user" (id, name) values ('garden-a', 'Synthetic A'), ('garden-b', 'Synthetic B');
        insert into auth_sessions (user_id, token_hash, expires_at) values
        ('garden-a', '${hashSessionToken('garden-a')}', CURRENT_TIMESTAMP + interval '1 hour'),
        ('garden-b', '${hashSessionToken('garden-b')}', CURRENT_TIMESTAMP + interval '1 hour');
        grant select on "user", auth_sessions to portfolio_app; set role portfolio_app;`);
      const db = drizzle({ client }) as unknown as AppDatabase;
      const getQuotes = vi.fn(async () => ({ quotes: {}, failedCodes: ['123A'] }));
      const handlers = createGardenHandlers({ repository: createGardenRepository(db), sessionStore: createAuthRepository(db).sessionStore,
        expectedOrigin: 'http://localhost', quoteProvider: { getQuotes } });
      expect((await handlers.get(request('GET', undefined, 'missing'))).status).toBe(401);
      expect((await handlers.put(request('PUT', { revision: 0, lots: [] }, 'garden-a', 'https://evil.test'))).status).toBe(403);
      expect((await handlers.put(request('PUT', { revision: 0, lots: [], ownerUserId: 'garden-b' }))).status).toBe(400);
      const saved = await handlers.put(request('PUT', { revision: 0, lots: [syntheticLot] }));
      expect(saved.status).toBe(200);
      expect(saved.headers.get('cache-control')).toBe('private, no-store');
      expect(await saved.json()).toEqual({ revision: 1, lots: [syntheticLot] });
      expect(await (await handlers.get(request())).json()).toEqual({ revision: 1, lots: [syntheticLot] });
      expect(await (await handlers.get(request('GET', undefined, 'garden-b'))).json()).toEqual({ revision: 0, lots: [] });
      expect((await handlers.put(request('PUT', { revision: 0, lots: [] }))).status).toBe(409);
      expect((await handlers.quotes(request())).status).toBe(200);
      expect(getQuotes).toHaveBeenCalledWith(['123A']);
      expect((await handlers.quotes(request('GET', undefined, 'missing'))).status).toBe(401);
      expect(getQuotes).toHaveBeenCalledTimes(1);
      const oversized = request('PUT', { pad: 'あ'.repeat(400000) });
      expect((await handlers.put(oversized)).status).toBe(413);
      const malformed = new NextRequest('http://localhost/api/garden', { method: 'PUT', headers: { cookie: 'portfolio_session=garden-a', origin: 'http://localhost', 'content-type': 'application/json' }, body: '{' });
      expect((await handlers.put(malformed)).status).toBe(400);
    } finally { await client.close(); }
  }, 30_000);
});
