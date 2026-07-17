import { hasExpectedOrigin } from '@/auth/request-origin';
import {
  REGISTRATION_COOKIE,
  challengeCookieOptions,
} from '@/auth/cookies';
import { beginPasskeyRegistration } from '@/auth/passkey-registration';
import { authFailure, getAuthRuntime } from '@/auth/runtime';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { name } = (await request.json()) as { name?: unknown };
    if (typeof name !== 'string') return authFailure();
    const { config, repository } = await getAuthRuntime();
    if (!hasExpectedOrigin(request, config.origin)) return authFailure();
    const result = await beginPasskeyRegistration(
      { name },
      { config, saveChallenge: repository.saveChallenge },
    );
    const response = NextResponse.json({ options: result.options });
    response.cookies.set(
      REGISTRATION_COOKIE,
      result.context,
      challengeCookieOptions(config),
    );
    return response;
  } catch {
    return authFailure();
  }
}
