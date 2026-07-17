import { hashSessionToken } from './session-token';

export type SessionStore = {
  findActiveUserByTokenHash(tokenHash: string, now: Date): Promise<string | null>;
};

const principalIds = new WeakMap<object, string>();
export type AuthenticatedPrincipal = Readonly<{ __authenticatedPrincipal: true }>;

export async function resolveSessionPrincipal(
  token: string | undefined,
  store: SessionStore,
  now = new Date(),
): Promise<AuthenticatedPrincipal | null> {
  if (!token) return null;
  const userId = await store.findActiveUserByTokenHash(hashSessionToken(token), now);
  if (!userId) return null;
  const principal = Object.freeze({ __authenticatedPrincipal: true }) as AuthenticatedPrincipal;
  principalIds.set(principal, userId);
  return principal;
}

export function authenticatedPrincipalId(principal: AuthenticatedPrincipal): string {
  const userId = principalIds.get(principal);
  if (!userId) throw new Error('Invalid authenticated principal');
  return userId;
}
