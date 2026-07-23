import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { DistributionDetailsForm } from '@/app/imports/sbi/[batchId]/distribution-details-form';

const props = {
  batchId: '10000000-0000-4000-8000-000000000001',
  sourceRowNumber: 2,
};

describe('distribution details form', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it('shows the confirmed Japanese notice labels and submits only typed details', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<DistributionDetailsForm {...props} />);

    expect(screen.getByText('普通分配金')).toBeTruthy();
    expect(screen.getByText('元本払戻金（特別分配金）と記載された通知書はこの入力を使わない。')).toBeTruthy();
    const confirmation = screen.getByLabelText('通知書に「普通分配金」と記載されていることを確認しました') as HTMLInputElement;
    const submitButton = screen.getByRole('button', { name: '再投資詳細を保存' }) as HTMLButtonElement;
    expect(confirmation.checked).toBe(false);
    expect(submitButton.disabled).toBe(true);
    fireEvent.click(confirmation);
    expect(submitButton.disabled).toBe(false);
    fireEvent.click(confirmation);
    expect(submitButton.disabled).toBe(true);
    fireEvent.click(confirmation);

    for (const label of [
      '再投資日',
      '個別元本単価',
      '再投資金額',
      '1万口あたり再投資の基準価額',
      '再投資数量',
      '再投資後の残高',
    ]) expect(screen.getByLabelText(label)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('再投資日'), { target: { value: '2026-07-11' } });
    fireEvent.change(screen.getByLabelText('個別元本単価'), { target: { value: '10,000.5' } });
    fireEvent.change(screen.getByLabelText('再投資金額'), { target: { value: '1,234' } });
    fireEvent.change(screen.getByLabelText('1万口あたり再投資の基準価額'), { target: { value: '10,500' } });
    fireEvent.change(screen.getByLabelText('再投資数量'), { target: { value: '12.34' } });
    fireEvent.change(screen.getByLabelText('再投資後の残高'), { target: { value: '112.34' } });
    fireEvent.submit(submitButton.closest('form')!);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/imports/${props.batchId}/distribution-details`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      sourceRowNumber: 2,
      distributionType: 'ordinary-distribution',
      reinvestmentDate: '2026-07-11',
      individualPrincipalPerTenThousand: '10,000.5',
      reinvestmentAmountYen: '1,234',
      navPerTenThousand: '10,500',
      reinvestmentQuantity: '12.34',
      postReinvestmentBalance: '112.34',
    });
  });

  it('shows a safe error and re-enables submission on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'detail_mismatch' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    render(<DistributionDetailsForm {...props} />);
    fireEvent.click(screen.getByLabelText('通知書に「普通分配金」と記載されていることを確認しました'));
    fireEvent.submit(screen.getByRole('button', { name: '再投資詳細を保存' }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('CSVの数量・基準価額・日付と一致しません');
    expect((screen.getByRole('button', { name: '再投資詳細を保存' }) as HTMLButtonElement).disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('disables autocomplete on the form and every transcribed financial or date field', () => {
    render(<DistributionDetailsForm {...props} />);

    const submitButton = screen.getByRole('button', { name: '再投資詳細を保存' });
    expect(submitButton.closest('form')?.getAttribute('autocomplete')).toBe('off');
    for (const label of [
      '再投資日',
      '個別元本単価',
      '再投資金額',
      '1万口あたり再投資の基準価額',
      '再投資数量',
      '再投資後の残高',
    ]) {
      expect(screen.getByLabelText(label).getAttribute('autocomplete')).toBe('off');
    }
  });
});
