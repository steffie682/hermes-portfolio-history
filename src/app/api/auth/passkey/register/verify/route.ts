import { hasExpectedOrigin } from '@/auth/request-origin';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  REGISTRATION_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/auth/cookies';
import { finishPasskeyRegistration } from '@/auth/passkey-registration';
import { authFailure, getAuthRuntime } from '@/auth/runtime';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const context = request.cookies.get(REGISTRATION_COOKIE)?.value;
    const body = (await request.json()) as { response?: RegistrationResponseJSON };
    if (!context || !body.response) return authFailure();
    const { config, repository } = await getAuthRuntime();
    if (!hasExpectedOrigin(request, config.origin)) return authFailure();
    const { sessionToken } = await finishPasskeyRegistration(
      { context, response: body.response },
      {
        config,
        loadChallenge: repository.loadRegistrationChallenge,
        persistRegistration: repository.persistRegistration,
      },
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(config));
    response.cookies.delete(REGISTRATION_COOKIE);
    return response;
  } catch {
    return authFailure();
  }
}
