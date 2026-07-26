import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BalanceReportPositionForm from '@/app/imports/sbi/balance-report/balance-report-position-form';

afterEach(() => cleanup());

function confirmAllSectionsAsZero() {
  for (const radio of screen.getAllByLabelText(/0と確認した/)) fireEvent.click(radio);
  const pages = screen.getAllByLabelText(/0記載ページ$/);
  const rows = screen.getAllByLabelText(/0記載行$/);
  expect(pages).toHaveLength(7);
  expect(rows).toHaveLength(7);
  for (let index = 0; index < 7; index += 1) {
    fireEvent.change(pages[index], { target: { value: '1' } });
    fireEvent.change(rows[index], { target: { value: String(index + 1) } });
  }
}

describe('full balance report checkpoint form', () => {
  const accounts = [{
    id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI',
  }];

  it('sends the exact synthetic zero-confirmation payload without inspection state', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkpoint: { id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 0 },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={[{
      id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI',
    }]} />);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    confirmAllSectionsAsZero();
    fireEvent.click(screen.getByLabelText(/関係する全ページを元の報告書で確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した全残高を保存' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe('/api/imports/sbi/full-balance-report-checkpoints');
    expect(body).toEqual({
      brokerAccountId: '11111111-1111-4111-8111-111111111111',
      statementDate: '2026-06-15', sourcePageCount: 7, allRelevantPagesReviewed: true,
      evidence: { kind: 'generic_as_of', confirmation: 'manual' },
      deposits: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 1 }, rows: [] },
      collateral: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 2 }, rows: [] },
      domesticStockLots: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 3 }, rows: [] },
      fundBalances: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 4 }, rows: [] },
      margin: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 5 }, rows: [] },
      futures: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 6 }, rows: [] },
      options: { evidenceState: 'explicit_zero', zeroLocator: { sourcePage: 1, sourceRow: 7 }, rows: [] },
    });
    expect(JSON.stringify(body)).not.toMatch(/pdf|ocr|filename|report|safeReport/i);
  });

  it('states the exact privacy boundary and constrains every source page to the inspected report', () => {
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    expect(screen.getByText(/PDFの生バイト、ファイル名、OCR出力、診断用の構造データはサーバーへ送信しません/))
      .toBeTruthy();
    expect(screen.getByText(/フォームへ手作業で転記した値はサーバーへ送信され、保存されます/))
      .toBeTruthy();
    for (const radio of screen.getAllByLabelText(/0と確認した/)) fireEvent.click(radio);
    for (const page of screen.getAllByLabelText(/ページ$/) as HTMLInputElement[]) {
      expect(page.max).toBe('7');
    }
    expect(screen.getByText(/決済済み・受渡前の行を含む報告書.*保存できません/)).toBeTruthy();
    expect(screen.queryByRole('option', { name: '決済済み・受渡前' })).toBeNull();
  });

  it('sends exact independent stock source states and acquisition-lot semantics', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkpoint: { id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 1 },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    confirmAllSectionsAsZero();
    fireEvent.click(screen.getAllByLabelText('原本記載の明細を入力する')[2]);
    fireEvent.change(screen.getByLabelText('元PDFのページ'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('ページ内の明細番号（上から）'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('銘柄コード'), { target: { value: '1357' } });
    fireEvent.change(screen.getByLabelText('銘柄名'), { target: { value: '合成株式' } });
    fireEvent.change(screen.getByLabelText('取得日'), { target: { value: '2026-06-14' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('取得単価の原本状態'), { target: { value: 'masked' } });
    fireEvent.change(screen.getByLabelText('買付金額の原本状態'), { target: { value: 'absent' } });
    fireEvent.click(screen.getByLabelText(/関係する全ページを元の報告書で確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した全残高を保存' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body).domesticStockLots.rows).toEqual([{
      rowKind: 'acquisition_lot',
      securityCode: '1357', securityName: '合成株式', acquisitionDate: '2026-06-14',
      quantity: '8', acquisitionUnitPriceState: 'masked', acquisitionUnitPrice: null,
      purchaseAmountState: 'absent', purchaseAmount: null,
      referencePrice: null, evaluationAmount: null, sourcePage: 1, sourceRow: 3,
    }]);
  });

  it('blocks nonzero derivatives and resets review confirmation after a bound change', () => {
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={[{
      id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI',
    }]} />);
    fireEvent.click(screen.getAllByLabelText('残高がある')[0]);
    expect(screen.getByRole('alert').textContent).toMatch(/未対応.*保存できません/);
    const reviewed = screen.getByLabelText(/関係する全ページを元の報告書で確認/) as HTMLInputElement;
    fireEvent.click(reviewed);
    expect(reviewed.checked).toBe(true);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    expect(reviewed.checked).toBe(false);
  });
});
