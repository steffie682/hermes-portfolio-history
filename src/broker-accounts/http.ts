import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import type { createAuthRepository } from '@/auth/repository';
import { resolveSessionPrincipal } from '@/auth/session';
import type { NextRequest } from 'next/server';

type Repository = ReturnType<typeof createAuthRepository>;

export function createBrokerAccountHandlers(
  repository: Repository,
  expectedOrigin: string,
) {
  async function authenticate(request: NextRequest) {
    return resolveSessionPrincipal(
      request.cookies.get(SESSION_COOKIE)?.value,
      repository.sessionStore,
    );
  }

  return {
    async list(request: NextRequest) {
      const principal = await authenticate(request);
      if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      return Response.json({ accounts: await repository.listBrokerAccounts(principal) });
    },
    async create(request: NextRequest) {
      if (!hasExpectedOrigin(request, expectedOrigin)) {
        return Response.json({ error: 'Invalid request' }, { status: 403 });
      }
      const principal = await authenticate(request);
      if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as Record<string, unknown>;
      if (
        typeof body.broker !== 'string' ||
        typeof body.displayName !== 'string' ||
        !body.broker.trim() ||
        !body.displayName.trim()
      ) {
        return Response.json({ error: 'Invalid account' }, { status: 400 });
      }
      const account = await repository.createBrokerAccount(principal, {
        broker: body.broker.trim(),
        displayName: body.displayName.trim(),
      });
      return Response.json({ account }, { status: 201 });
    },
    async get(request: NextRequest, id: string) {
      const principal = await authenticate(request);
      if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const account = await repository.getBrokerAccount(principal, id);
      if (!account) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ account });
    },
  };
}
