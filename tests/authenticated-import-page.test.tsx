import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolvePageSessionPrincipal: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/auth/page-session', () => ({
  resolvePageSessionPrincipal: mocks.resolvePageSessionPrincipal,
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import SbiImportPage from '@/app/imports/sbi/page';

describe('authenticated SBI import page', () => {
  beforeEach(() => {
    mocks.resolvePageSessionPrincipal.mockReset();
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue(null);
    await expect(SbiImportPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders the import boundary for an authenticated session', async () => {
    mocks.resolvePageSessionPrincipal.mockResolvedValue({ authenticated: true });
    render(await SbiImportPage());
    expect(screen.getByRole('heading', { name: 'SBI CSV取込' })).toBeTruthy();
    expect(screen.getByText('この画面内でCSVを確認します')).toBeTruthy();
  });
});
