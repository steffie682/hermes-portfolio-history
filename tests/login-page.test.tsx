import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('explains device authentication without relying on passkey terminology', () => {
    render(<LoginPage />);
    expect(
      screen.getByRole('button', { name: '顔認証・指紋・PINでログイン' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('表示名')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'この端末で利用を始める' }),
    ).toBeTruthy();
    expect(screen.getByText('初めて使う場合')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'この端末で利用を始める' }));

    expect(screen.getByRole('status').textContent).toBe('利用登録を進めています…');
  });
});
