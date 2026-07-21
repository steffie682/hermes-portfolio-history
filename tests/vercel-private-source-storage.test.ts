import { describe, expect, it, vi } from 'vitest';
import { createVercelPrivateSourceStorage } from '@/import/storage/vercel-private-source-storage';

describe('Vercel private source storage', () => {
  it('uploads with private access and persists only the pathname', async () => {
    const putBlob = vi.fn().mockImplementation(async (pathname: string) => ({
      pathname,
      url: `https://private.example.invalid/${pathname}`,
    }));
    const deleteBlob = vi.fn().mockResolvedValue(undefined);
    const storage = createVercelPrivateSourceStorage({ putBlob, deleteBlob });
    const bytes = new Uint8Array([1, 2, 3]);

    const stored = await storage.put({
      ownerUserId: 'user-a',
      sourceDocumentId: 'document-a',
      bytes,
    });
    expect(stored.storageKey).toMatch(/^sources\/[a-f0-9]{64}\/document-a$/);
    expect(putBlob).toHaveBeenCalledWith(
      stored.storageKey,
      Buffer.from(bytes),
      expect.objectContaining({
        access: 'private',
        addRandomSuffix: false,
        contentType: 'text/csv',
      }),
    );

    await storage.delete(stored.storageKey);
    expect(deleteBlob).toHaveBeenCalledWith(stored.storageKey);
  });
});
