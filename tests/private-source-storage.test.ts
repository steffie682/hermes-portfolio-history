import { describe, expect, it } from 'vitest';
import { createMemoryPrivateSourceStorage } from '@/import/storage/memory-private-source-storage';

describe('private source storage contract', () => {
  it('stores an immutable private copy and supports compensating deletion', async () => {
    const storage = createMemoryPrivateSourceStorage();
    const bytes = new Uint8Array([1, 2, 3]);

    const stored = await storage.put({
      ownerUserId: 'user-a',
      sourceDocumentId: 'document-a',
      bytes,
    });
    bytes[0] = 9;

    expect(stored.storageKey).toMatch(/^sources\/[a-f0-9]{64}\/document-a$/);
    expect(stored.storageKey).not.toContain('user-a');
    expect(storage.readForTest(stored.storageKey)).toEqual(new Uint8Array([1, 2, 3]));
    expect('publicUrl' in stored).toBe(false);

    await storage.delete(stored.storageKey);
    expect(storage.readForTest(stored.storageKey)).toBeNull();
  });
});
