import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { metadata } from '@/app/layout';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('states the implemented scope without presenting the whole product as complete', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '資産履歴管理' })).toBeTruthy();
    expect(screen.getByText('個別株の保有記録・SBI残高証拠')).toBeTruthy();
    expect(screen.getByText(/口座全体の総資産・税務損益・受取済み配当の集計はまだ未実装/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '株の庭を開く' }).getAttribute('href')).toBe('/garden');
    expect(screen.queryByText('本番環境で利用できます')).toBeNull();
    expect(metadata.description).toContain('取込基盤');
    expect(screen.getByRole('link', { name: '資産概要を見る' }).getAttribute('href'))
      .toBe('/portfolio');
    expect(screen.getByRole('link', { name: 'ログイン・利用開始' }).getAttribute('href'))
      .toBe('/login');
  });
});
