type AuthEnvironment = {
  AUTH_SECRET?: string;
  WEBAUTHN_ORIGIN?: string;
  WEBAUTHN_RP_ID?: string;
};

export function parseAuthConfig(environment: AuthEnvironment) {
  const secret = environment.AUTH_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters');
  }
  const origin = environment.WEBAUTHN_ORIGIN ?? '';
  const rpID = environment.WEBAUTHN_RP_ID ?? '';
  const parsedOrigin = new URL(origin);
  if (origin !== parsedOrigin.origin) {
    throw new Error('WEBAUTHN_ORIGIN must be an origin without path, query, or credentials');
  }
  const hostname = parsedOrigin.hostname;
  if (
    parsedOrigin.protocol !== 'https:' &&
    !(parsedOrigin.protocol === 'http:' && hostname === 'localhost')
  ) {
    throw new Error('WEBAUTHN_ORIGIN must use HTTPS outside localhost');
  }
  if (!rpID || (hostname !== rpID && !hostname.endsWith(`.${rpID}`))) {
    throw new Error('WEBAUTHN_ORIGIN must belong to WEBAUTHN_RP_ID');
  }
  return {
    origin: parsedOrigin.origin,
    rpID,
    rpName: '資産履歴管理',
    secret,
    secureCookies: parsedOrigin.protocol === 'https:',
  };
}
