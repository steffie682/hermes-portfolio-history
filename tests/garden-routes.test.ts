// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => vi.fn());
vi.mock('@/auth/runtime', () => ({ getAuthRuntime: runtime }));
vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));

describe('garden Next route wiring', () => {
  it('wires GET/PUT/quotes to auth and keeps awaited failures generic and uncacheable', async () => {
    const state = await import('@/app/api/garden/route');
    const quotes = await import('@/app/api/garden/quotes/route');
    runtime.mockResolvedValue({ config: { origin: 'http://localhost' }, repository: { sessionStore: { findActiveUserByTokenHash: async () => null } } });
    for (const [handler, method] of [[state.GET, 'GET'], [state.PUT, 'PUT'], [quotes.GET, 'GET']] as const) {
      const response = await handler(new NextRequest('http://localhost/api/garden', { method, headers: { origin: 'http://localhost' } }));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    runtime.mockRejectedValue(new Error('secret-database-password'));
    const failure = await state.GET(new NextRequest('http://localhost/api/garden'));
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain('secret-database-password');
    expect(failure.headers.get('cache-control')).toBe('private, no-store');
  });
});
