import { hasExpectedOrigin } from '@/auth/request-origin';
import { beginPasskeyAuthentication } from '@/auth/passkey-authentication';
import { CHALLENGE_COOKIE, challengeCookieOptions } from '@/auth/cookies';
import { authFailure, getAuthRuntime } from '@/auth/runtime';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { config, repository } = await getAuthRuntime();
    if (!hasExpectedOrigin(request, config.origin)) return authFailure();
    const result = await beginPasskeyAuthentication({
      config,
      saveChallenge: repository.saveChallenge,
    });
    const response = NextResponse.json({ options: result.options });
    response.cookies.set(
      CHALLENGE_COOKIE,
      result.challengeToken,
      challengeCookieOptions(config),
    );
    return response;
  } catch {
    return authFailure();
  }
}
