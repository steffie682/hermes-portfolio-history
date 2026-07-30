import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn(),
  redirect: vi.fn(),
  getBatchTrace: vi.fn(),
}));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/import/runtime', () => ({
  getImportRuntime: vi.fn().mockResolvedValue({
    importRepository: { getBatchTrace: mocks.getBatchTrace },
  }),
}));

import SbiDistributionReportPage from '@/app/imports/sbi/distribution-report/page';

describe('authenticated SBI distribution report page', () => {
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.getBatchTrace.mockReset();
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(SbiDistributionReportPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('passes a valid originating batch to the browser-only inspector', async () => {
    const principal = { authenticated: true };
    mocks.resolvePageSessionPrincipal.mockResolvedValue(principal);
    const batchId = '10000000-0000-4000-8000-000000000001';
    mocks.getBatchTrace.mockResolvedValue({ batchId, brokerAccountId: '00000000-0000-4000-8000-000000000001' });
    const page = await SbiDistributionReportPage({
      searchParams: Promise.resolve({ batchId }),
    });
    expect(JSON.stringify(page)).toContain(`/imports/sbi/${batchId}`);
    expect(mocks.getBatchTrace).toHaveBeenCalledWith({ principal, batchId });
  });

  it('does not trust a valid-looking batch id that the current user does not own', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    mocks.getBatchTrace.mockResolvedValue(null);
    const batchId = '20000000-0000-4000-8000-000000000002';
    const page = await SbiDistributionReportPage({ searchParams: Promise.resolve({ batchId }) });
    expect(JSON.stringify(page)).not.toContain(`/imports/sbi/${batchId}`);
    expect(JSON.stringify(page)).toContain('/imports/sbi');
  });

  it('renders the browser-only inspector for an authenticated session', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await SbiDistributionReportPage());
    expect(screen.getByRole('heading', { name: 'SBI分配金・再投資PDFの構造確認' })).toBeTruthy();
    expect(screen.getByText('PDFは送信されません')).toBeTruthy();
  });
});
