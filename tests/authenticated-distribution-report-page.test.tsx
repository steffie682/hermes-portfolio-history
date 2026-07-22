import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolvePageSessionPrincipal: vi.fn(), redirect: vi.fn() }));
vi.mock('@/auth/page-session', () => ({ resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import SbiDistributionReportPage from '@/app/imports/sbi/distribution-report/page';

describe('authenticated SBI distribution report page', () => {
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(SbiDistributionReportPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders the browser-only inspector for an authenticated session', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await SbiDistributionReportPage());
    expect(screen.getByRole('heading', { name: 'SBI分配金・再投資PDFの構造確認' })).toBeTruthy();
    expect(screen.getByText('PDFは送信されません')).toBeTruthy();
  });
});
