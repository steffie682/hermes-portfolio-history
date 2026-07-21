import { createHash } from 'node:crypto';

export interface PrivateSourceStorage {
  put(input: {
    ownerUserId: string;
    sourceDocumentId: string;
    bytes: Uint8Array;
  }): Promise<{ storageKey: string }>;
  delete(storageKey: string): Promise<void>;
}

export function privateSourceStorageKey(ownerUserId: string, sourceDocumentId: string) {
  if (!ownerUserId || !sourceDocumentId) {
    throw new Error('Private source storage scope is required');
  }
  const ownerScope = createHash('sha256').update(ownerUserId).digest('hex');
  return `sources/${ownerScope}/${encodeURIComponent(sourceDocumentId)}`;
}
