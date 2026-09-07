import { getAuthRuntime } from '@/auth/runtime';
import { getDatabase } from '@/db/client';
import { createGardenRepository } from './repository';
import { createGardenHandlers } from './http';
export async function getGardenHandlers() {
  const { config, repository } = await getAuthRuntime();
  return createGardenHandlers({ sessionStore: repository.sessionStore, expectedOrigin: config.origin,
    repository: createGardenRepository(getDatabase()) });
}
