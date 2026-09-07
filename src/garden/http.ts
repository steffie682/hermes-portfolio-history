import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import { authenticatedPrincipalId, resolveSessionPrincipal, type SessionStore } from '@/auth/session';
import { GardenConflictError, type GardenRepository } from './repository';
import { GardenValidationError, validateGardenState } from './domain';
import { GardenBodyError, readGardenJson } from './body';
import { gardenQuoteProvider, type QuoteResult } from './quotes';

type Dependencies = {
  repository: GardenRepository; sessionStore: SessionStore; expectedOrigin: string;
  quoteProvider?: { getQuotes(codes: string[]): Promise<QuoteResult> };
};
export function gardenResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
export function gardenFailure(error?: unknown) {
  const status = error instanceof GardenConflictError ? 409 : error instanceof GardenValidationError ? 400
    : error instanceof GardenBodyError ? error.status : 500;
  return gardenResponse({ error: status === 409 ? 'Stale garden revision' : status === 500 ? 'Operation failed' : 'Invalid request' }, status);
}
// Best-effort per-process authenticated resource guard, not a distributed abuse quota.
const rates = new Map<string, { until: number; count: number }>();
function permit(owner: string, kind: 'get' | 'put' | 'quotes'): boolean {
  const now = Date.now(), key = `${owner}:${kind}`;
  for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
  const entry = rates.get(key);
  const maximum = kind === 'quotes' ? 6 : kind === 'put' ? 30 : 60;
  if (entry) { if (entry.count >= maximum) return false; entry.count++; return true; }
  if (rates.size >= 2048) return false;
  rates.set(key, { until: now + 60_000, count: 1 });
  return true;
}
export function createGardenHandlers({ repository, sessionStore, expectedOrigin, quoteProvider = gardenQuoteProvider }: Dependencies) {
  async function execute(request: NextRequest, kind: 'get' | 'put' | 'quotes') {
    try {
      if (kind === 'put' && !hasExpectedOrigin(request, expectedOrigin)) return gardenResponse({ error: 'Invalid request' }, 403);
      const principal = await resolveSessionPrincipal(request.cookies.get(SESSION_COOKIE)?.value, sessionStore);
      if (!principal) return gardenResponse({ error: 'Unauthorized' }, 401);
      if (!permit(authenticatedPrincipalId(principal), kind)) {
        const response = gardenResponse({ error: 'Too many requests' }, 429);
        response.headers.set('retry-after', '60');
        return response;
      }
      if (kind === 'put') {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return gardenResponse({ error: 'Invalid request' }, 415);
        const state = validateGardenState(await readGardenJson(request, 1_048_576));
        return gardenResponse(await repository.save(principal, state));
      }
      const state = await repository.load(principal);
      return gardenResponse(kind === 'get' ? state : await quoteProvider.getQuotes([...new Set(state.lots.map(lot => lot.code))]));
    } catch (error) { return gardenFailure(error); }
  }
  return {
    get: (request: NextRequest) => execute(request, 'get'),
    put: (request: NextRequest) => execute(request, 'put'),
    quotes: (request: NextRequest) => execute(request, 'quotes'),
  };
}
