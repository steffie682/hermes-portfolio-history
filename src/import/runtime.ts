import { getAuthRuntime } from '@/auth/runtime';
import { getDatabase } from '@/db/client';
import { createImportRepository } from './repository';
import { createVercelPrivateSourceStorage } from './storage/vercel-private-source-storage';

export async function getImportRuntime() {
  const auth = await getAuthRuntime();
  const importRepository = createImportRepository(
    getDatabase(),
    createVercelPrivateSourceStorage(),
  );
  return { ...auth, importRepository };
}
