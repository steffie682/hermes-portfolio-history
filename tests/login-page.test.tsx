import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';

const { push, startAuthentication } = vi.hoisted(() => ({
  push: vi.fn(),
  startAuthentication: vi.fn().mockResolvedValue({ id: 'existing-passkey' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication,
  startRegistration: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('explains device authentication without relying on passkey terminology', () => {
    render(<LoginPage />);
    expect(
      screen.getByRole('button', { name: '顔認証・指紋・PINでログイン' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('表示名')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '新しいアカウントを作る' }),
    ).toBeTruthy();
    expect(screen.getByText('新しく使い始める場合')).toBeTruthy();
    expect(
      screen.getByText('別の端末で同じアカウントを使う場合は、ログイン済みの端末からスマホを追加してください。'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'この仕組みにはPasskeyを使用します。パスワードを覚える必要はありません。',
      ),
    ).toBeTruthy();
  });

  it('uses neutral wording while starting registration', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('表示名'), {
      target: { value: 'すてふぃー' },
    });
    fireEvent.click(screen.getByRole('button', { name: '新しいアカウントを作る' }));

    expect(screen.getByRole('status').textContent).toBe('新しいアカウントを作成しています…');
  });

  it('opens the authenticated import page after a successful passkey login', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ options: { challenge: 'login' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: '顔認証・指紋・PINでログイン' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/imports/sbi'));
  });
});
