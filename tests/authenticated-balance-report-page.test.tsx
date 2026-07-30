import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn(),
  redirect: vi.fn(),
  listBrokerAccounts: vi.fn(),
  listRecentV1ForMerge: vi.fn(),
  listRecentV2ForMerge: vi.fn(),
  getBatchTrace: vi.fn(),
}));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/auth/runtime', () => ({
  getAuthRuntime: vi.fn().mockResolvedValue({
    repository: { listBrokerAccounts: mocks.listBrokerAccounts },
  }),
}));
vi.mock('@/import/runtime', () => ({
  getImportRuntime: vi.fn().mockResolvedValue({
    repository: { listBrokerAccounts: mocks.listBrokerAccounts },
    importRepository: { getBatchTrace: mocks.getBatchTrace },
  }),
}));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn().mockReturnValue({}) }));
vi.mock('@/import/sbi/balance-report-snapshot-repository', () => ({
  createBalanceReportSnapshotRepository: vi.fn().mockReturnValue({
    listRecentForMerge: mocks.listRecentV1ForMerge,
  }),
}));
vi.mock('@/import/sbi/full-balance-report-checkpoint-repository', () => ({
  createFullBalanceReportCheckpointRepository: vi.fn().mockReturnValue({
    listRecentForMerge: mocks.listRecentV2ForMerge,
  }),
}));

import SbiBalanceReportPage from '@/app/imports/sbi/balance-report/page';

describe('authenticated SBI balance report page', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.listBrokerAccounts.mockReset();
    mocks.listRecentV1ForMerge.mockReset();
    mocks.listRecentV2ForMerge.mockReset();
    mocks.getBatchTrace.mockReset();
    mocks.listBrokerAccounts.mockResolvedValue([]);
    mocks.listRecentV1ForMerge.mockResolvedValue([]);
    mocks.listRecentV2ForMerge.mockResolvedValue([]);
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(SbiBalanceReportPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('passes a valid originating batch to the PDF inspector', async () => {
    const principal = { authenticated: true };
    mocks.resolvePageSessionPrincipal.mockResolvedValue(principal);
    const batchId = '10000000-0000-4000-8000-000000000001';
    mocks.getBatchTrace.mockResolvedValue({ batchId, brokerAccountId: '00000000-0000-4000-8000-000000000001' });
    const page = await SbiBalanceReportPage({
      searchParams: Promise.resolve({ batchId }),
    });
    expect(JSON.stringify(page)).toContain(`/imports/sbi/${batchId}`);
    expect(mocks.getBatchTrace).toHaveBeenCalledWith({ principal, batchId });
  });

  it('falls back safely when the current user does not own the requested batch', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    mocks.getBatchTrace.mockResolvedValue(null);
    const batchId = '20000000-0000-4000-8000-000000000002';
    const page = await SbiBalanceReportPage({ searchParams: Promise.resolve({ batchId }) });
    expect(JSON.stringify(page)).not.toContain(`/imports/sbi/${batchId}`);
  });

  it('puts the originating batch SBI account first without exposing batch metadata', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    const batchId = '10000000-0000-4000-8000-000000000001';
    mocks.getBatchTrace.mockResolvedValue({ batchId, brokerAccountId: '2' });
    mocks.listBrokerAccounts.mockResolvedValue([
      { id: '1', broker: 'sbi', displayName: 'SBI口座1' },
      { id: '2', broker: 'sbi', displayName: 'SBI口座2' },
    ]);
    const serialized = JSON.stringify(await SbiBalanceReportPage({
      searchParams: Promise.resolve({ batchId }),
    }));
    expect(serialized.indexOf('SBI口座2')).toBeLessThan(serialized.indexOf('SBI口座1'));
    expect(serialized).not.toContain('brokerAccountId');
  });

  it('renders the PDF inspector for an authenticated session', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await SbiBalanceReportPage());
    expect(screen.getByRole('heading', { name: 'SBI取引残高報告書の確認' })).toBeTruthy();
    expect(screen.getByText('PDFは外部へ送信されません')).toBeTruthy();
  });

  it('merges v1 and v2 recent summaries by creation time and passes only minimal client props', async () => {
    const principal = { authenticated: true };
    mocks.resolvePageSessionPrincipal.mockResolvedValue(principal);
    mocks.listBrokerAccounts.mockResolvedValue([
      { id: '1', broker: 'other', displayName: 'Other' },
      { id: '2', broker: 'sbi', displayName: 'Synthetic SBI' },
    ]);
    mocks.listRecentV1ForMerge.mockResolvedValue([{
      id: 'v1', statementDate: '2026-07-20', positionCount: 4,
      createdAt: new Date('2026-07-25T10:00:00.000Z'),
    }]);
    mocks.listRecentV2ForMerge.mockResolvedValue([{
      id: 'v2', statementDate: '2026-07-21', rowCount: 7,
      createdAt: new Date('2026-07-25T11:00:00.000Z'),
    }]);
    const page = await SbiBalanceReportPage();
    render(page);
    expect(mocks.listBrokerAccounts).toHaveBeenCalledWith(principal);
    expect(mocks.listRecentV1ForMerge).toHaveBeenCalledWith(principal);
    expect(mocks.listRecentV2ForMerge).toHaveBeenCalledWith(principal);
    expect(document.body.textContent!.indexOf('2026-07-21'))
      .toBeLessThan(document.body.textContent!.indexOf('2026-07-20'));
    expect(screen.getByText(/2026-07-21/)).toBeTruthy();
    expect(screen.getByText(/2026-07-20/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Other');
    expect(document.body.textContent).not.toMatch(/ownerUserId|raw OCR/i);
    const clientProps = JSON.stringify(page);
    expect(clientProps).not.toMatch(/brokerAccountId|status|createdAt|ownerUserId|positions|version/);
    expect(clientProps).toContain('"positionCount":4');
    expect(clientProps).toContain('"rowCount":7');
  });

  it('applies the final recent-history limit after merging both versions', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    mocks.listRecentV1ForMerge.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      id: `v1-${index}`, statementDate: `2026-06-${String(index + 1).padStart(2, '0')}`,
      positionCount: index, createdAt: new Date(2026, 5, index + 1),
    })));
    mocks.listRecentV2ForMerge.mockResolvedValue([{
      id: 'v2-newest', statementDate: '2026-07-25', rowCount: 1,
      createdAt: new Date('2026-07-25T00:00:00.000Z'),
    }]);
    const clientProps = JSON.stringify(await SbiBalanceReportPage());
    expect(clientProps).toContain('v2-newest');
    expect(clientProps).not.toContain('v1-0');
  });
});
