import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn().mockResolvedValue({ userId: 'user-a' }),
  getImportRuntime: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn(),
}));

vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('@/import/runtime', () => ({ getImportRuntime: mocks.getImportRuntime }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

import ImportTracePage from '@/app/imports/sbi/[batchId]/page';

describe('import trace page', () => {
  it('rejects a non-UUID batch id before opening the repository', async () => {
    await expect(ImportTracePage({ params: Promise.resolve({ batchId: 'not-a-uuid' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getImportRuntime).not.toHaveBeenCalled();
  });
});
