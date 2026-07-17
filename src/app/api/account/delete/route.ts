import { SESSION_COOKIE } from '@/auth/cookies';
import { hasExpectedOrigin } from '@/auth/request-origin';
import { getAuthRuntime } from '@/auth/runtime';
import { resolveSessionPrincipal } from '@/auth/session';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { config, repository } = await getAuthRuntime();
    if (!hasExpectedOrigin(request, config.origin)) {
      return Response.json({ error: 'Invalid request' }, { status: 403 });
    }
    const principal = await resolveSessionPrincipal(
      request.cookies.get(SESSION_COOKIE)?.value,
      repository.sessionStore,
    );
    if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    await repository.requestAccountDeletion(principal, new Date());
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    return Response.json({ error: 'Operation failed' }, { status: 500 });
  }
}
