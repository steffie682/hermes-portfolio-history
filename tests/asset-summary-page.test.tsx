import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn(),
  redirect: vi.fn(),
  listLatestEvidence: vi.fn(),
  getImportReadiness: vi.fn(),
}));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/db/client', () => ({ getDatabase: vi.fn().mockReturnValue({}) }));
vi.mock('@/import/sbi/full-balance-report-checkpoint-repository', () => ({
  createFullBalanceReportCheckpointRepository: vi.fn().mockReturnValue({
    listLatestEvidence: mocks.listLatestEvidence,
    getImportReadiness: mocks.getImportReadiness,
  }),
}));

import AssetSummaryPage from '@/app/portfolio/page';

const accountId = '00000000-0000-4000-8000-000000000001';
const checkpointId = '00000000-0000-4000-8000-000000000010';

describe('asset summary page', () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.listLatestEvidence.mockReset();
    mocks.getImportReadiness.mockReset();
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
    mocks.listLatestEvidence.mockResolvedValue([]);
    mocks.getImportReadiness.mockResolvedValue({
      ledgerEventCount: 0, unresolvedDistributionCount: 0,
      otherNeedsReviewCount: 0, previewReadyBatchCount: 0,
    });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(AssetSummaryPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('does not display zero assets when no confirmed balance evidence exists', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await AssetSummaryPage());
    expect(screen.getByRole('heading', { name: '資産概要' })).toBeTruthy();
    expect(screen.getByText('総資産はまだ計算していません')).toBeTruthy();
    expect(screen.queryByText('総資産 0円')).toBeNull();
    expect(screen.getByRole('link', { name: '残高報告書を確認する' }).getAttribute('href'))
      .toBe('/imports/sbi/balance-report');
  });

  it('renders unresolved nonzero evidence as missing rather than zero confirmed', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    mocks.listLatestEvidence.mockResolvedValue([{
      checkpointId, brokerAccountId: accountId, accountName: 'Synthetic SBI', statementDate: '2026-06-30',
      sections: {
        deposits: 'explicit_zero', collateral: 'explicit_zero', domesticStockLots: 'explicit_zero',
        fundBalances: 'explicit_zero', margin: 'missing', futures: 'explicit_zero', options: 'explicit_zero',
      },
      deposits: [], collateral: [], domesticStockLots: [], fundBalances: [], margin: [],
    }]);
    render(await AssetSummaryPage());
    expect(screen.getByText('信用建玉: 残高あり・明細未入力')).toBeTruthy();
    expect(screen.getByText(/信用建玉の明細は未入力/)).toBeTruthy();
    expect(screen.queryByText('信用建玉: 0件確認済み')).toBeNull();
  });

  it('renders section counts and incomplete evidence without inventing a total', async () => {
    const principal = { authenticated: true };
    mocks.resolvePageSessionPrincipal.mockResolvedValue(principal);
    mocks.getImportReadiness.mockResolvedValue({
      ledgerEventCount: 8, unresolvedDistributionCount: 2,
      otherNeedsReviewCount: 3, previewReadyBatchCount: 1,
    });
    mocks.listLatestEvidence.mockResolvedValue([{
      checkpointId, brokerAccountId: accountId, accountName: 'SBIメイン口座', statementDate: '2026-06-30',
      sections: {
        deposits: 'reported', collateral: 'reported', domesticStockLots: 'reported',
        fundBalances: 'reported', margin: 'reported', futures: 'explicit_zero', options: 'explicit_zero',
      },
      deposits: [{ kind: 'cash_deposit', amount: '1000.00', sourcePage: 1, sourceRow: 1 }],
      collateral: [{ kind: 'margin_guarantee', amount: '500.00', sourcePage: 1, sourceRow: 2 }],
      domesticStockLots: [
        { securityCode: '7203', securityName: 'Synthetic Motor', quantity: '10.000000', evaluationAmount: '25000.00', sourcePage: 2, sourceRow: 1 },
        { securityCode: '9432', securityName: 'Synthetic Telecom', quantity: '20.000000', evaluationAmount: null, sourcePage: 2, sourceRow: 2 },
      ],
      fundBalances: [{ securityCode: '013.12', securityName: 'Synthetic Fund', units: '1000.000000', evaluationAmount: '12345.67', sourcePage: 3, sourceRow: 1 }],
      margin: [{ state: 'open', side: 'buy', securityCode: '9984', securityName: 'Synthetic Margin', quantity: '5.000000', unrealizedPnl: null, sourcePage: 4, sourceRow: 1 }],
    }]);

    render(await AssetSummaryPage());
    expect(mocks.listLatestEvidence).toHaveBeenCalledWith(principal);
    expect(screen.getByRole('heading', { name: 'SBIメイン口座' })).toBeTruthy();
    expect(screen.getByText('2026年6月30日時点')).toBeTruthy();
    expect(screen.getByText('預り金 1件')).toBeTruthy();
    expect(screen.getByText('担保・保証金 1件')).toBeTruthy();
    expect(screen.getByText('投資信託 1件')).toBeTruthy();
    expect(screen.getByText('先物: 0件確認済み')).toBeTruthy();
    expect(screen.getByText('オプション: 0件確認済み')).toBeTruthy();
    expect(screen.getByText('報告書記載額 1000.00（通貨未確認）')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/1,000円|500円|12,345\.67円/);
    expect(screen.getByText(/国内株式は1件の評価額が未記載/)).toBeTruthy();
    expect(screen.getByText('原本位置: 2ページ 2行')).toBeTruthy();
    expect(screen.getByText('総資産はまだ計算していません')).toBeTruthy();
    expect(screen.getByText('台帳保存済み 8件')).toBeTruthy();
    expect(screen.getByText('分配金詳細待ち 2件')).toBeTruthy();
    expect(screen.getByText('その他の要確認 3件')).toBeTruthy();
    expect(screen.getByText('確定前の取込 1件')).toBeTruthy();
    expect(screen.getByText('本人が内容を確認した報告書')).toBeTruthy();
    expect(screen.getByText('預り金・担保の原本記載値')).toBeTruthy();
    expect(screen.getByText('国内株式・投資信託の原本記載値')).toBeTruthy();
    expect(screen.getByText('信用建玉の原本記載値')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(accountId);
    expect(document.body.innerHTML).not.toContain(checkpointId);
  });
});
