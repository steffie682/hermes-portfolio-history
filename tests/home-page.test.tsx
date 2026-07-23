import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { metadata } from '@/app/layout';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('clearly reports that the production application is available', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '資産履歴管理' })).toBeTruthy();
    expect(screen.getByText('本番環境で利用できます')).toBeTruthy();
    expect(screen.getByText(/SBI証券の取引履歴を安全に取り込み/)).toBeTruthy();
    expect(screen.queryByText('基盤を構築中です')).toBeNull();
    expect(screen.queryByText(/利用可能な金融機能はまだありません/)).toBeNull();
    expect(metadata.description).not.toContain('開発中');
    expect(
      screen.getByRole('link', { name: 'ログイン・利用開始' }).getAttribute('href'),
    ).toBe('/login');
  });
});
