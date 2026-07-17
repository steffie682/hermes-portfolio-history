import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('clearly reports that the application is still under development', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '資産履歴管理' })).toBeTruthy();
    expect(screen.getByText('基盤を構築中です')).toBeTruthy();
  });
});
