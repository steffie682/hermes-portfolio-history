import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './cookies';
import { getAuthRuntime } from './runtime';
import { resolveSessionPrincipal, type SessionStore } from './session';

type PageSessionDependencies = {
  readSessionToken(): Promise<string | undefined>;
  getRuntime(): Promise<{ repository: { sessionStore: SessionStore } }>;
};

const defaultDependencies: PageSessionDependencies = {
  async readSessionToken() {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  },
  getRuntime: getAuthRuntime,
};

export async function resolvePageSessionPrincipal(
  dependencies: PageSessionDependencies = defaultDependencies,
) {
  const token = await dependencies.readSessionToken();
  if (!token) return null;
  const { repository } = await dependencies.getRuntime();
  return resolveSessionPrincipal(token, repository.sessionStore);
}
