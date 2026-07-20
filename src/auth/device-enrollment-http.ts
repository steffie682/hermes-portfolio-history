import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  DEVICE_ENROLLMENT_COOKIE,
  SESSION_COOKIE,
  deviceEnrollmentCookieOptions,
  sessionCookieOptions,
} from './cookies';
import {
  beginDeviceEnrollment,
  finishDeviceEnrollment,
  getDeviceEnrollmentOptions,
} from './device-enrollment';
import { hasExpectedOrigin } from './request-origin';
import type { createAuthRepository } from './repository';
import { resolveSessionPrincipal } from './session';
import type { AuthConfig } from './types';

type Repository = ReturnType<typeof createAuthRepository>;
type EnrollmentServices = {
  beginEnrollment: typeof beginDeviceEnrollment;
  getOptions: typeof getDeviceEnrollmentOptions;
  finishEnrollment: typeof finishDeviceEnrollment;
};

const defaultServices: EnrollmentServices = {
  beginEnrollment: beginDeviceEnrollment,
  getOptions: getDeviceEnrollmentOptions,
  finishEnrollment: finishDeviceEnrollment,
};

const noStoreHeaders = { 'cache-control': 'no-store' };

function invalid(status = 400) {
  return NextResponse.json(
    { error: status === 401 ? 'Unauthorized' : 'Invalid request' },
    { status, headers: noStoreHeaders },
  );
}

function validGrantToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createDeviceEnrollmentHandlers(
  repository: Repository,
  config: AuthConfig,
  services: EnrollmentServices = defaultServices,
) {
  return {
    async createGrant(request: NextRequest) {
      try {
        if (!hasExpectedOrigin(request, config.origin)) return invalid(403);
        const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
        const principal = await resolveSessionPrincipal(
          sessionToken,
          repository.sessionStore,
        );
        if (!principal || !sessionToken) return invalid(401);
        const result = await services.beginEnrollment(
          { principal, sessionToken },
          { saveGrant: repository.saveDeviceEnrollmentGrant },
        );
        return NextResponse.json(
          {
            grantToken: result.grantToken,
            expiresAt: result.expiresAt.toISOString(),
          },
          { status: 201, headers: noStoreHeaders },
        );
      } catch {
        return invalid();
      }
    },

    async options(request: NextRequest) {
      try {
        if (!hasExpectedOrigin(request, config.origin)) return invalid(403);
        const body = (await request.json()) as { grantToken?: unknown };
        if (!validGrantToken(body.grantToken)) return invalid();
        const options = await services.getOptions(body.grantToken, {
          config,
          loadGrant: repository.loadDeviceEnrollmentGrant,
        });
        const response = NextResponse.json({ options }, { headers: noStoreHeaders });
        response.cookies.set(
          DEVICE_ENROLLMENT_COOKIE,
          body.grantToken,
          deviceEnrollmentCookieOptions(config),
        );
        return response;
      } catch {
        return invalid();
      }
    },

    async verify(request: NextRequest) {
      try {
        if (!hasExpectedOrigin(request, config.origin)) return invalid(403);
        const body = (await request.json()) as {
          response?: RegistrationResponseJSON;
        };
        const grantToken = request.cookies.get(DEVICE_ENROLLMENT_COOKIE)?.value;
        if (!validGrantToken(grantToken) || !body.response) return invalid();
        const result = await services.finishEnrollment(
          { grantToken, response: body.response },
          {
            config,
            loadGrant: repository.loadDeviceEnrollmentGrant,
            persistEnrollment: repository.persistDeviceEnrollment,
          },
        );
        const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });
        response.cookies.set(
          SESSION_COOKIE,
          result.sessionToken,
          sessionCookieOptions(config),
        );
        response.cookies.set(DEVICE_ENROLLMENT_COOKIE, '', {
          ...deviceEnrollmentCookieOptions(config),
          maxAge: 0,
        });
        return response;
      } catch {
        return invalid();
      }
    },
  };
}
