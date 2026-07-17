import { hasExpectedOrigin } from '@/auth/request-origin';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/auth/cookies';
import { finishPasskeyAuthentication } from '@/auth/passkey-authentication';
import { authFailure, getAuthRuntime } from '@/auth/runtime';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const challengeToken = request.cookies.get(CHALLENGE_COOKIE)?.value;
    const body = (await request.json()) as { response?: AuthenticationResponseJSON };
    if (!challengeToken || !body.response) return authFailure();
    const { config, repository } = await getAuthRuntime();
    if (!hasExpectedOrigin(request, config.origin)) return authFailure();
    const { sessionToken } = await finishPasskeyAuthentication(
      { challengeToken, response: body.response },
      {
        config,
        loadChallenge: repository.loadAuthenticationChallenge,
        loadCredential: repository.loadCredential,
        persistAuthentication: repository.persistAuthentication,
      },
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(config));
    response.cookies.delete(CHALLENGE_COOKIE);
    return response;
  } catch {
    return authFailure();
  }
}
