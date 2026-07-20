import type { AuthConfig } from './types';

export const SESSION_COOKIE = 'portfolio_session';
export const CHALLENGE_COOKIE = 'portfolio_auth_challenge';
export const REGISTRATION_COOKIE = 'portfolio_registration_context';
export const DEVICE_ENROLLMENT_COOKIE = 'portfolio_device_enrollment';

export function sessionCookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  };
}

export function challengeCookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 5 * 60,
  };
}


export function deviceEnrollmentCookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
    path: '/api/auth/passkey/device-enrollment',
    maxAge: 5 * 60,
  };
}
