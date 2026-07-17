import { parseAuthConfig } from './config';
import { createAuthRepository } from './repository';
import { getDatabase } from '@/db/client';
import { verifyRuntimeRole } from '@/db/security';

let runtimeRoleCheck: Promise<void> | undefined;

export async function getAuthRuntime() {
  const config = parseAuthConfig({
    AUTH_SECRET: process.env.AUTH_SECRET,
    WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
    WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  });
  const database = getDatabase();
  runtimeRoleCheck ??= verifyRuntimeRole(database);
  await runtimeRoleCheck;
  return { config, repository: createAuthRepository(database) };
}

export function authFailure() {
  return Response.json({ error: 'Authentication failed' }, { status: 400 });
}
