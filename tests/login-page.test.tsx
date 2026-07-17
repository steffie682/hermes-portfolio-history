import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('LoginPage', () => {
  it('offers passkey sign-in and clearly separates first-time registration', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Passkeyでログイン' })).toBeTruthy();
    expect(screen.getByLabelText('表示名')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Passkeyを作成' })).toBeTruthy();
    expect(screen.getByText('初めて使う場合')).toBeTruthy();
  });
});
