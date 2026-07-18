import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolvePageSessionPrincipal: vi.fn(), redirect: vi.fn() }));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import SbiBalanceReportPage from '@/app/imports/sbi/balance-report/page';

describe('authenticated SBI balance report page', () => {
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
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
});
