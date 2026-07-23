import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn().mockResolvedValue({ userId: 'user-a' }),
  getImportRuntime: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn(),
}));

vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('@/import/runtime', () => ({ getImportRuntime: mocks.getImportRuntime }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import ImportTracePage from '@/app/imports/sbi/[batchId]/page';
import { cleanup, render, screen } from '@testing-library/react';

describe('import trace page', () => {
  afterEach(cleanup);

  it('rejects a non-UUID batch id before opening the repository', async () => {
    await expect(ImportTracePage({ params: Promise.resolve({ batchId: 'not-a-uuid' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getImportRuntime).not.toHaveBeenCalled();
  });

  it('shows the manual form only for an eligible preview row and describes CSV identity', async () => {
    mocks.getImportRuntime.mockResolvedValue({
      importRepository: {
        getBatchTrace: vi.fn().mockResolvedValue({
          batchId: '10000000-0000-4000-8000-000000000001',
          status: 'preview_ready',
          rows: [{
            locator: 'csv:row:2',
            sourceRow: 2,
            status: 'needs_review',
            reasonCode: 'needs-distribution-details',
            eventKind: null,
            payload: {
              instrument: { securityName: '合成投資信託' },
              operation: 'reinvestment-units',
              contractDate: '2026-07-10',
              settlementDate: '2026-07-11',
              quantityIncrease: '12.34',
              sourceQuotedUnitPrice: { value: '10500', basis: 'unverified' },
            },
          }],
        }),
      },
    });
    render(await ImportTracePage({
      params: Promise.resolve({ batchId: '10000000-0000-4000-8000-000000000001' }),
    }));
    expect(screen.getByText(/合成投資信託/).textContent).toContain('再投資数量 12.34');
    expect(screen.getByRole('button', { name: '再投資詳細を保存' })).toBeTruthy();
    expect(screen.getByText(/PDFはアップロードされません/)).toBeTruthy();
    expect(screen.getByText(/総分配金と源泉徴収額は未解決/)).toBeTruthy();
  });

  it('does not expose a form for committed or noneligible rows', async () => {
    mocks.getImportRuntime.mockResolvedValue({
      importRepository: {
        getBatchTrace: vi.fn().mockResolvedValue({
          batchId: '10000000-0000-4000-8000-000000000001',
          status: 'committed',
          rows: [{
            locator: 'csv:row:2',
            sourceRow: 2,
            status: 'needs_review',
            reasonCode: 'needs-distribution-details',
            eventKind: null,
            payload: {},
          }],
        }),
      },
    });
    render(await ImportTracePage({
      params: Promise.resolve({ batchId: '10000000-0000-4000-8000-000000000001' }),
    }));
    expect(screen.queryByRole('button', { name: '再投資詳細を保存' })).toBeNull();
  });
});
