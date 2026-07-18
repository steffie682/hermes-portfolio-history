import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImportPreviewPage, { metadata } from '@/app/imports/preview/page';

describe('ImportPreviewPage', () => {
  it('keeps the public stakeholder preview out of search indexes', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('shows the staged policy using synthetic categories only', () => {
    render(<ImportPreviewPage />);

    expect(screen.getByRole('heading', { name: 'CSV取込の確認' })).toBeTruthy();
    expect(screen.getByText('画面見本（合成データ）')).toBeTruthy();
    expect(screen.getByText('自動計上候補 5件')).toBeTruthy();
    expect(screen.getByText('信用対応待ち 5件')).toBeTruthy();
    expect(screen.getByText('分配詳細待ち 1件')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('総資産を確定表示しません');
    expect(screen.getByRole('button', { name: '取込を確定（まだ利用できません）' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByLabelText('CSVファイル')).toBeNull();
  });
});
