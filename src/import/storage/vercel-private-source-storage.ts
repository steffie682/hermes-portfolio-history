import { del, put } from '@vercel/blob';
import {
  privateSourceStorageKey,
  type PrivateSourceStorage,
} from '../private-source-storage';

type PutBlob = typeof put;
type DeleteBlob = typeof del;

export function createVercelPrivateSourceStorage(dependencies: {
  putBlob?: PutBlob;
  deleteBlob?: DeleteBlob;
} = {}): PrivateSourceStorage {
  const putBlob = dependencies.putBlob ?? put;
  const deleteBlob = dependencies.deleteBlob ?? del;
  return {
    async put({ ownerUserId, sourceDocumentId, bytes }) {
      const pathname = privateSourceStorageKey(ownerUserId, sourceDocumentId);
      const stored = await putBlob(pathname, Buffer.from(bytes), {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'text/csv',
        cacheControlMaxAge: 60,
      });
      return { storageKey: stored.pathname };
    },
    async delete(storageKey) {
      await deleteBlob(storageKey);
    },
  };
}
