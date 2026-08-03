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
    const onSaved = vi.fn();
    render(<BalanceReportPositionForm sourcePageCount={7} onSaved={onSaved} accounts={[{
      id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI',
    }]} />);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    confirmAllSectionsAsZero();
    fireEvent.click(screen.getByLabelText(/関係する全ページを元の報告書で確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した残高証拠を保存' }));
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
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('does not claim candidates were inserted when every candidate array is empty', () => {
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} initialCandidates={{
      deposits: [], collateral: [], domesticStockLots: [], fundBalances: [], margin: [], limitReached: true,
    }} />);
    expect(screen.queryByText(/国内株・投信だけを候補入力しました/)).toBeNull();
  });

  it('saves a reviewed nonzero margin section as unresolved without creating zero evidence', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkpoint: { id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 0, unresolvedSectionCount: 1 },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    for (const radio of screen.getAllByLabelText(/0と確認した/)) fireEvent.click(radio);
    fireEvent.click(screen.getByLabelText(/信用取引の建玉残高.*今回は明細未入力/));
    const pages = screen.getAllByLabelText(/0記載ページ$/);
    const rows = screen.getAllByLabelText(/0記載行$/);
    expect(pages).toHaveLength(6);
    for (let index = 0; index < 6; index += 1) {
      fireEvent.change(pages[index], { target: { value: '1' } });
      fireEvent.change(rows[index], { target: { value: String(index + 1) } });
    }
    fireEvent.click(screen.getByLabelText(/関係する全ページを元の報告書で確認/));
    const save = screen.getByRole('button', { name: '確認した残高証拠を保存' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.margin).toEqual({ evidenceState: 'missing', zeroLocator: null, rows: [] });
    expect(JSON.stringify(body.margin)).not.toMatch(/explicit_zero|sourcePage|sourceRow/);
    expect(await screen.findByText('直近の保存：2026-06-15・明細未入力の区分1件')).toBeTruthy();
    expect(screen.queryByText(/直近の保存：.*明細0件/)).toBeNull();
  });

  it('states the exact privacy boundary and constrains every source page to the inspected report', () => {
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    expect(screen.getByText(/PDFの生バイト、ファイル名、OCR出力、診断用の構造データはサーバーへ送信しません/))
      .toBeTruthy();
    expect(screen.getByText(/フォームへ入力またはOCR候補から反映し、本人が原本確認した値はサーバーへ送信され、保存されます/))
      .toBeTruthy();
    for (const radio of screen.getAllByLabelText(/0と確認した/)) fireEvent.click(radio);
    for (const page of screen.getAllByLabelText(/ページ$/) as HTMLInputElement[]) {
      expect(page.max).toBe('7');
    }
    fireEvent.click(screen.getAllByLabelText('原本記載の明細を入力する')[4]);
    expect(screen.getByRole('option', { name: '未決済' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '決済ずみ' })).toBeTruthy();
    expect(screen.queryByText(/決済ずみ.*保存できません/)).toBeNull();
    expect(screen.getByText('信用取引の建玉残高')).toBeTruthy();
    expect(screen.getByText(/原本列「銘柄名（弁済期限）」/)).toBeTruthy();
    expect(screen.getByText(/原本列「数量・市場」/)).toBeTruthy();
    expect(screen.getByText(/原本列「区分」/)).toBeTruthy();
  });

  it('warns that an absent section is not explicit zero and defines the source row locator', () => {
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    expect(screen.getByText(/区分自体が原本に載っていない場合は、0として扱わず保存しません/)).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText(/0と確認した/)[0]);
    expect(screen.getByText(/記載行は、対象区分の表で見出しを除いて上から数えた明細番号/)).toBeTruthy();
  });

  it('sends the exact synthetic settled margin payload and omits blank valuation cells', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkpoint: { id: '22222222-2222-4222-8222-222222222222', statementDate: '2026-06-15', rowCount: 1 },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<BalanceReportPositionForm sourcePageCount={7} accounts={accounts} />);
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-06-15' } });
    confirmAllSectionsAsZero();
    fireEvent.click(screen.getAllByLabelText('原本記載の明細を入力する')[4]);
    fireEvent.change(screen.getByLabelText('状態'), {
      target: { value: 'settled' },
    });
    fireEvent.change(screen.getByLabelText('元PDFのページ'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('ページ内の明細番号（上から）'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('銘柄コード'), { target: { value: '3579' } });
    fireEvent.change(screen.getByLabelText('銘柄名'), { target: { value: '合成信用銘柄' } });
    fireEvent.change(screen.getByLabelText('弁済期限（原本表記）'), { target: { value: '合成期限' } });
    fireEvent.change(screen.getByLabelText('指定表示（記載がある場合）'), { target: { value: '合成指定表示' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('約定年月日'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('約定単価'), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText('最終決済期日または決済予定日'), {
      target: { value: '2026-06-16' },
    });
    fireEvent.click(screen.getByLabelText(/関係する全ページを元の報告書で確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した残高証拠を保存' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body).margin.rows).toEqual([{
      state: 'settled',
      securityCode: '3579', securityName: '合成信用銘柄',
      repaymentTermLabel: '合成期限', designationLabel: '合成指定表示', quantity: '6',
      market: 'tokyo', side: 'buy', contractDate: '2026-06-01', contractUnitPrice: '220',
      currentPrice: null, fees: null, unrealizedPnl: null,
      finalSettlementOrPlannedDate: '2026-06-16',
      sourcePage: 1, sourceRow: 5,
    }]);
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
    fireEvent.click(screen.getByRole('button', { name: '確認した残高証拠を保存' }));
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
