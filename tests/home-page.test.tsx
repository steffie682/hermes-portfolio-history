import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { metadata } from '@/app/layout';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('states the implemented scope without presenting the whole product as complete', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '資産履歴管理' })).toBeTruthy();
    expect(screen.getByText('SBI取込・残高証拠の確認版')).toBeTruthy();
    expect(screen.getByText(/総資産・運用損益・配当集計はまだ未実装/)).toBeTruthy();
    expect(screen.queryByText('本番環境で利用できます')).toBeNull();
    expect(metadata.description).toContain('取込基盤');
    expect(screen.getByRole('link', { name: '資産概要を見る' }).getAttribute('href'))
      .toBe('/portfolio');
    expect(screen.getByRole('link', { name: 'ログイン・利用開始' }).getAttribute('href'))
      .toBe('/login');
  });
});
