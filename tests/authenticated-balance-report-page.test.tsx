import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn(),
  redirect: vi.fn(),
  listBrokerAccounts: vi.fn(),
  listRecent: vi.fn(),
}));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/auth/runtime', () => ({
  getAuthRuntime: vi.fn().mockResolvedValue({
    repository: { listBrokerAccounts: mocks.listBrokerAccounts },
  }),
}));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn().mockReturnValue({}) }));
vi.mock('@/import/sbi/balance-report-snapshot-repository', () => ({
  createBalanceReportSnapshotRepository: vi.fn().mockReturnValue({ listRecent: mocks.listRecent }),
}));

import SbiBalanceReportPage from '@/app/imports/sbi/balance-report/page';

describe('authenticated SBI balance report page', () => {
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.listBrokerAccounts.mockReset();
    mocks.listRecent.mockReset();
    mocks.listBrokerAccounts.mockResolvedValue([]);
    mocks.listRecent.mockResolvedValue([]);
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(SbiBalanceReportPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders the PDF inspector for an authenticated session', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await SbiBalanceReportPage());
    expect(screen.getByRole('heading', { name: 'SBI取引残高報告書の確認' })).toBeTruthy();
    expect(screen.getByText('PDFは外部へ送信されません')).toBeTruthy();
  });

  it('loads only current-user SBI accounts and saved summaries server-side', async () => {
    const principal = { authenticated: true };
    mocks.resolvePageSessionPrincipal.mockResolvedValue(principal);
    mocks.listBrokerAccounts.mockResolvedValue([
      { id: '1', broker: 'other', displayName: 'Other' },
      { id: '2', broker: 'sbi', displayName: 'Synthetic SBI' },
    ]);
    mocks.listRecent.mockResolvedValue([{
      id: '3', brokerAccountId: '2', statementDate: '2026-07-20',
      status: 'confirmed', positionCount: 4,
      createdAt: new Date('2026-07-21T00:00:00Z'),
    }]);
    render(await SbiBalanceReportPage());
    expect(mocks.listBrokerAccounts).toHaveBeenCalledWith(principal);
    expect(mocks.listRecent).toHaveBeenCalledWith(principal);
    expect(screen.getByText(/2026-07-20/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Other');
    expect(document.body.textContent).not.toMatch(/ownerUserId|raw OCR/i);
  });
});
