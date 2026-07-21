import {
  privateSourceStorageKey,
  type PrivateSourceStorage,
} from '../private-source-storage';

export function createMemoryPrivateSourceStorage() {
  const objects = new Map<string, Uint8Array>();
  let putCalls = 0;
  const storage: PrivateSourceStorage & {
    readForTest(storageKey: string): Uint8Array | null;
    putCallsForTest(): number;
  } = {
    async put({ ownerUserId, sourceDocumentId, bytes }) {
      putCalls += 1;
      const storageKey = privateSourceStorageKey(ownerUserId, sourceDocumentId);
      objects.set(storageKey, new Uint8Array(bytes));
      return { storageKey };
    },
    async delete(storageKey) {
      objects.delete(storageKey);
    },
    readForTest(storageKey) {
      const stored = objects.get(storageKey);
      return stored ? new Uint8Array(stored) : null;
    },
    putCallsForTest() {
      return putCalls;
    },
  };
  return storage;
}
