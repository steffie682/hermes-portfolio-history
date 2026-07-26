import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbiBalanceReportClient from '@/app/imports/sbi/balance-report/client';

const safeReport = {
  schemaVersion: 1 as const,
  documentKind: 'sbi-balance-report-structure' as const,
  pageCount: 1,
  pages: [{
    pageNumber: 1,
    width: 600,
    height: 840,
    rawItemCount: 2,
    discardedItemCount: 0,
    items: [
      { kind: 'known-label' as const, labels: ['取引残高報告書', '信用取引'], x: 100, y: 800, width: 100, height: 10 },
      { kind: 'masked-text' as const, x: 400, y: 800, width: 80, height: 10 },
    ],
  }],
};

const emptyReport = {
  ...safeReport,
  pages: [{
    pageNumber: 1,
    width: 600,
    height: 840,
    extractionMode: 'none' as const,
    rawItemCount: 0,
    discardedItemCount: 0,
    items: [],
  }],
};

const ocrReport = {
  ...safeReport,
  pages: safeReport.pages.map((page) => ({ ...page, extractionMode: 'ocr' as const })),
};

function choose(file: File) {
  const input = screen.getByLabelText('SBI取引残高報告書PDF') as HTMLInputElement;
  Object.defineProperty(input, 'value', {
    value: 'C:\\fakepath\\report.pdf', writable: true, configurable: true,
  });
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

function pdfFile(marker = 1) {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, marker]);
  return { size: bytes.byteLength, arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer) } as unknown as File;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => cleanup());

describe('SBI balance report client', () => {
  it('gates the exact post-OCR save payload on original-report confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        brokerAccountId: '11111111-1111-4111-8111-111111111111',
        statementDate: '2026-07-23',
        status: 'confirmed',
        positionCount: 1,
        createdAt: '2026-07-24T00:00:00.000Z',
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      recentSnapshots={[]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());

    expect(await screen.findByRole('heading', {
      name: '次の手順：信用建玉を本人確認して保存',
    })).toBeTruthy();
    expect(screen.getByRole('link', { name: '診断用JSONを保存（任意）' })).toBeTruthy();
    expect(screen.getByText(/JSONは任意の診断用/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '確認した建玉を保存' }) as HTMLButtonElement).disabled)
      .toBe(true);

    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-07-23' } });
    fireEvent.change(screen.getByLabelText('元PDFのページ'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('ページ内の明細番号（上から）'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('売買'), { target: { value: 'sell' } });
    fireEvent.change(screen.getByLabelText('銘柄コード'), { target: { value: 'Q7W2' } });
    fireEvent.change(screen.getByLabelText('銘柄名'), { target: { value: '合成確認銘柄' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '0008' } });
    fireEvent.change(screen.getByLabelText('建単価（原本記載値・円）'), { target: { value: '0100.50' } });
    fireEvent.change(screen.getByLabelText('建日'), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByLabelText(/元の取引残高報告書の各信用建玉明細ページをすべて確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した建玉を保存' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toBe('/api/imports/sbi/balance-report-snapshots');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      brokerAccountId: '11111111-1111-4111-8111-111111111111',
      statementDate: '2026-07-23',
      confirmedCompleteFromOriginal: true,
      confirmedNoPositions: false,
      positions: [{
        sourcePage: 4,
        sourceRow: 2,
        side: 'sell',
        securityCode: 'Q7W2',
        securityName: '合成確認銘柄',
        quantity: '0008',
        unitPriceYen: '0100.50',
        openedOn: '2026-07-01',
        dueOn: null,
      }],
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('purpose');
    expect(await screen.findByText(/保存しました/)).toBeTruthy();
    expect(screen.getByText(/2026-07-23/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('synthetic-user');
  });

  it('requires both explicit confirmations and sends an intentional zero checkpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        brokerAccountId: '11111111-1111-4111-8111-111111111111',
        statementDate: '2026-07-23',
        status: 'confirmed',
        positionCount: 0,
        createdAt: '2026-07-24T00:00:00.000Z',
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });

    const save = screen.getByRole('button', { name: '確認した建玉を保存' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-07-23' } });
    fireEvent.click(screen.getByLabelText('報告書で信用建玉が0件であることを確認した'));
    expect(screen.queryByRole('group', { name: '信用建玉 1' })).toBeNull();
    expect(save.disabled).toBe(true);
    fireEvent.submit(save.closest('form')!);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/元の取引残高報告書の各信用建玉明細ページをすべて確認/));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      brokerAccountId: '11111111-1111-4111-8111-111111111111',
      statementDate: '2026-07-23',
      confirmedCompleteFromOriginal: true,
      confirmedNoPositions: true,
      positions: [],
    });
  });

  it('disables snapshot controls and ignores a second submit while saving', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetch);
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      recentSnapshots={[]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    fireEvent.click(screen.getByLabelText(/元の取引残高報告書の各信用建玉明細ページをすべて確認/));

    const form = screen.getByRole('button', { name: '確認した建玉を保存' }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    for (const control of form.querySelectorAll('input, select, button')) {
      expect(control.matches(':disabled')).toBe(true);
    }
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledOnce();

    pending.resolve(new Response(JSON.stringify({
      snapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        brokerAccountId: '11111111-1111-4111-8111-111111111111',
        statementDate: '2026-07-23',
        status: 'confirmed',
        positionCount: 1,
        createdAt: '2026-07-24T00:00:00.000Z',
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    expect(await screen.findByText(/保存しました/)).toBeTruthy();
  });

  it('shows saved summaries and links to account setup when SBI has no account', async () => {
    const { rerender } = render(<SbiBalanceReportClient accounts={[]} recentSnapshots={[]} />);
    expect(screen.getByRole('link', { name: /SBI口座を作成/ }).getAttribute('href')).toBe('/imports/sbi');
    rerender(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: 'SBI' }]}
      recentSnapshots={[{
        id: '33333333-3333-4333-8333-333333333333',
        statementDate: '2026-07-20',
        positionCount: 2,
      }]}
    />);
    expect(screen.getByText(/2026-07-20/)).toBeTruthy();
    expect(screen.getByText(/2件/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/開始建玉|終了建玉|保存目的/);
  });

  it('shows a private save error without leaking response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'invalid_account', detail: 'sensitive detail' },
    }), { status: 404, headers: { 'content-type': 'application/json' } })));
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    fireEvent.click(screen.getByLabelText(/元の取引残高報告書の各信用建玉明細ページをすべて確認/));
    fireEvent.submit(screen.getByRole('button', { name: '確認した建玉を保存' }).closest('form')!);
    expect(await screen.findByText('選択したSBI口座を確認できませんでした。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive detail');
  });

  it('maps snapshot unavailability to retry-later copy without leaking details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'snapshot_unavailable', detail: 'sensitive database detail' },
    }), { status: 503, headers: { 'content-type': 'application/json' } })));
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic SBI' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    fireEvent.click(screen.getByLabelText(/元の取引残高報告書の各信用建玉明細ページをすべて確認/));
    fireEvent.submit(screen.getByRole('button', { name: '確認した建玉を保存' }).closest('form')!);
    expect(await screen.findByText('現在保存できません。時間をおいてもう一度お試しください。'))
      .toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive database detail');
  });

  it('clears the file control and releases invalid bytes after reading', async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5, 6]);
    render(<SbiBalanceReportClient inspectPdf={vi.fn()} />);
    const input = choose({
      size: source.length,
      arrayBuffer: vi.fn().mockResolvedValue(source.buffer),
    } as unknown as File);
    await screen.findByRole('alert');
    expect(input.value).toBe('');
    expect([...source]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('describes byte cleanup as garbage-collection release, not secure erasure', () => {
    render(<SbiBalanceReportClient inspectPdf={vi.fn()} />);
    expect(screen.getByText(/ガベージコレクション/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/安全に消去|securely erased/i);
  });

  it('shows only safe structure and provides a fixed-name safe report', async () => {
    const inspectPdf = vi.fn().mockResolvedValue(safeReport);
    render(<SbiBalanceReportClient inspectPdf={inspectPdf} />);
    choose({ name: 'PRIVATE_REPORT_NAME.pdf', size: 5, arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]).buffer) } as unknown as File);

    expect(await screen.findByText('PDF 1ページ')).toBeTruthy();
    expect(screen.getByText('取引残高報告書')).toBeTruthy();
    expect(screen.getByText('信用取引')).toBeTruthy();
    const download = screen.getByRole('link', { name: '診断用JSONを保存（任意）' });
    expect(download.getAttribute('download')).toBe('sbi-balance-report-safe-structure.json');
    expect(download.getAttribute('href')).toMatch(/^data:application\/json/);
    expect(document.body.textContent).not.toContain('PRIVATE_REPORT_NAME');
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('rejects an oversized PDF before reading bytes', async () => {
    const arrayBuffer = vi.fn();
    render(<SbiBalanceReportClient inspectPdf={vi.fn()} />);
    choose({ size: 20 * 1024 * 1024 + 1, arrayBuffer } as unknown as File);
    expect((await screen.findByRole('alert')).textContent).toContain('20 MB以下');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('aborts replacement A and does not let stale A overwrite B', async () => {
    const a = deferred<typeof safeReport>();
    const reportB = { ...safeReport, pageCount: 2 };
    const inspectPdf = vi.fn((bytes: Uint8Array, signal: AbortSignal) => {
      void signal;
      return bytes[5] === 1 ? a.promise : Promise.resolve(reportB);
    });
    render(<SbiBalanceReportClient inspectPdf={inspectPdf} />);
    choose(pdfFile(1));
    await waitFor(() => expect(inspectPdf).toHaveBeenCalledTimes(1));
    const signalA = inspectPdf.mock.calls[0][1];
    expect(signalA.aborted).toBe(false);

    choose(pdfFile(2));
    expect(signalA.aborted).toBe(true);
    expect(await screen.findByText('PDF 2ページ')).toBeTruthy();

    a.resolve(safeReport);
    await waitFor(() => expect(screen.queryByText('PDF 1ページ')).toBeNull());
  });

  it('aborts the active inspection on unmount', async () => {
    const pending = deferred<typeof safeReport>();
    const inspectPdf = vi.fn((bytes: Uint8Array, signal: AbortSignal) => {
      void bytes;
      void signal;
      return pending.promise;
    });
    const view = render(<SbiBalanceReportClient inspectPdf={inspectPdf} />);
    choose(pdfFile());
    await waitFor(() => expect(inspectPdf).toHaveBeenCalledTimes(1));

    const signal = inspectPdf.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(safeReport);
  });

  it('offers OCR after PDF.js transfers the inspection buffer to its worker', async () => {
    const inspectPdf = vi.fn(async (source: Uint8Array) => {
      structuredClone(source.buffer, { transfer: [source.buffer] });
      expect(source.byteLength).toBe(0);
      return emptyReport;
    });
    render(<SbiBalanceReportClient inspectPdf={inspectPdf} />);
    choose(pdfFile());

    expect(await screen.findByRole('heading', { name: '端末内の日本語OCR' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers bounded on-device Japanese OCR instead of an empty diagnostic download', async () => {
    render(<SbiBalanceReportClient inspectPdf={vi.fn().mockResolvedValue(emptyReport)} />);
    choose(pdfFile());

    expect(await screen.findByRole('heading', { name: '端末内の日本語OCR' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '診断用JSONを保存（任意）' })).toBeNull();
    expect(screen.getByText(/外部へ送信せず/)).toBeTruthy();
    expect((screen.getByLabelText('開始ページ') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('終了ページ') as HTMLInputElement).value).toBe('1');
    expect(screen.getByRole('button', { name: 'OCRをキャンセル' })).toBeTruthy();
  });

  it('validates OCR range and exposes only a useful safe OCR report on success', async () => {
    const runOcr = vi.fn().mockResolvedValue(ocrReport);
    render(<SbiBalanceReportClient
      inspectPdf={vi.fn().mockResolvedValue({ ...emptyReport, pageCount: 10 })}
      runOcr={runOcr}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    fireEvent.change(screen.getByLabelText('終了ページ'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    expect((await screen.findByRole('alert')).textContent).toContain('5ページ以内');
    expect(runOcr).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('終了ページ'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    expect(await screen.findByText('OCRが完了しました（5ページ）')).toBeTruthy();
    expect(screen.getByRole('link', { name: '診断用JSONを保存（任意）' })).toBeTruthy();
  });

  it('wipes retained PDF bytes after OCR success', async () => {
    const source = new Uint8Array([37, 80, 68, 70, 45, 7]);
    const runOcr = vi.fn().mockResolvedValue(ocrReport);
    render(<SbiBalanceReportClient inspectPdf={vi.fn().mockResolvedValue(emptyReport)} runOcr={runOcr} />);
    choose({ size: source.length, arrayBuffer: vi.fn().mockResolvedValue(source.buffer) } as unknown as File);
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    await screen.findByText('OCRが完了しました（1ページ）');
    expect([...source]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('aborts OCR and wipes bytes on cancel without allowing its stale result', async () => {
    const source = new Uint8Array([37, 80, 68, 70, 45, 8]);
    const pending = deferred<typeof ocrReport>();
    const runOcr = vi.fn().mockReturnValue(pending.promise);
    render(<SbiBalanceReportClient inspectPdf={vi.fn().mockResolvedValue(emptyReport)} runOcr={runOcr} />);
    choose({ size: source.length, arrayBuffer: vi.fn().mockResolvedValue(source.buffer) } as unknown as File);
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    await waitFor(() => expect(runOcr).toHaveBeenCalledOnce());
    const signal = runOcr.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'OCRをキャンセル' }));
    expect(signal.aborted).toBe(true);
    expect([...source]).toEqual([0, 0, 0, 0, 0, 0]);
    pending.resolve(ocrReport);
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '診断用JSONを保存（任意）' })).toBeNull();
    });
  });

  it('wipes retained bytes on replacement and unmount', async () => {
    const first = new Uint8Array([37, 80, 68, 70, 45, 9]);
    const second = new Uint8Array([37, 80, 68, 70, 45, 10]);
    const inspectPdf = vi.fn().mockResolvedValue(emptyReport);
    const view = render(<SbiBalanceReportClient inspectPdf={inspectPdf} />);
    choose({ size: first.length, arrayBuffer: vi.fn().mockResolvedValue(first.buffer) } as unknown as File);
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    choose({ size: second.length, arrayBuffer: vi.fn().mockResolvedValue(second.buffer) } as unknown as File);
    await waitFor(() => expect([...first]).toEqual([0, 0, 0, 0, 0, 0]));
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    view.unmount();
    expect([...second]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('shows an error and no download when OCR has no known label', async () => {
    const runOcr = vi.fn().mockRejectedValue(new Error('ocr-known-label-required'));
    render(<SbiBalanceReportClient inspectPdf={vi.fn().mockResolvedValue(emptyReport)} runOcr={runOcr} />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    expect((await screen.findByRole('alert')).textContent).toContain('既知の見出し');
    expect(screen.queryByRole('link', { name: '診断用JSONを保存（任意）' })).toBeNull();
  });

  it('keeps diagnostics but gates saving when extracted labels are not the exact report label', async () => {
    const wrongReport = {
      ...safeReport,
      pages: [{
        ...safeReport.pages[0],
        items: [{ kind: 'known-label' as const, labels: ['信用取引'], x: 1, y: 1, width: 1, height: 1 }],
      }],
    };
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(wrongReport)}
    />);
    choose(pdfFile());
    expect((await screen.findByRole('alert')).textContent).toContain('保存できません');
    expect(screen.getByRole('link', { name: '診断用JSONを保存（任意）' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認した建玉を保存' })).toBeNull();
  });

  it('does not expose the save form after OCR finds only a generic known label', async () => {
    const genericOcr = {
      ...ocrReport,
      pages: [{
        ...ocrReport.pages[0],
        items: [{ kind: 'known-label' as const, labels: ['信用取引'], x: 1, y: 1, width: 1, height: 1 }],
      }],
    };
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(emptyReport)}
      runOcr={vi.fn().mockResolvedValue(genericOcr)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '端末内の日本語OCR' });
    fireEvent.click(screen.getByRole('button', { name: '日本語OCRを開始' }));
    expect((await screen.findByRole('alert')).textContent).toContain('保存できません');
    expect(screen.queryByRole('button', { name: '確認した建玉を保存' })).toBeNull();
  });

  it.each([
    ['account', () => fireEvent.change(screen.getByLabelText('SBI口座'), { target: { value: '22222222-2222-4222-8222-222222222222' } })],
    ['statement date', () => fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-07-22' } })],
    ['zero toggle', () => fireEvent.click(screen.getByLabelText('報告書で信用建玉が0件であることを確認した'))],
    ['position field', () => fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } })],
    ['add row', () => fireEvent.click(screen.getByRole('button', { name: '建玉を追加' }))],
  ])('synchronously invalidates confirmation after changing %s', async (_category, mutate) => {
    render(<SbiBalanceReportClient
      accounts={[
        { id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座1' },
        { id: '22222222-2222-4222-8222-222222222222', displayName: '合成SBI口座2' },
      ]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    const confirmation = screen.getByLabelText(/各信用建玉明細ページをすべて確認/) as HTMLInputElement;
    fireEvent.click(confirmation);
    const save = screen.getByRole('button', { name: '確認した建玉を保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    mutate();
    expect(confirmation.checked).toBe(false);
    expect(save.disabled).toBe(true);
  });

  it('synchronously invalidates confirmation when removing a row', async () => {
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    fireEvent.click(screen.getByRole('button', { name: '建玉を追加' }));
    const confirmation = screen.getByLabelText(/各信用建玉明細ページをすべて確認/) as HTMLInputElement;
    fireEvent.click(confirmation);
    const save = screen.getByRole('button', { name: '確認した建玉を保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'この建玉を削除' })[0]);
    expect(confirmation.checked).toBe(false);
    expect(save.disabled).toBe(true);
  });

  it('replaces a confirmed report with a fresh unchecked persistence form', async () => {
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile(1));
    const confirmation = await screen.findByLabelText(/各信用建玉明細ページをすべて確認/) as HTMLInputElement;
    fireEvent.click(confirmation);
    expect(confirmation.checked).toBe(true);
    choose(pdfFile(2));
    const replacement = await screen.findByLabelText(/各信用建玉明細ページをすべて確認/) as HTMLInputElement;
    expect(replacement.checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認した建玉を保存' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('clears the saved summary and save status when confirmed input becomes stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        statementDate: '2026-07-23',
        positionCount: 1,
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } })));
    render(<SbiBalanceReportClient
      accounts={[{ id: '11111111-1111-4111-8111-111111111111', displayName: '合成SBI口座' }]}
      inspectPdf={vi.fn().mockResolvedValue(safeReport)}
    />);
    choose(pdfFile());
    await screen.findByRole('heading', { name: '次の手順：信用建玉を本人確認して保存' });
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-07-23' } });
    fireEvent.click(screen.getByLabelText('報告書で信用建玉が0件であることを確認した'));
    fireEvent.click(screen.getByLabelText(/各信用建玉明細ページをすべて確認/));
    fireEvent.click(screen.getByRole('button', { name: '確認した建玉を保存' }));
    expect(await screen.findByText(/本人確認した信用建玉を保存しました/)).toBeTruthy();
    expect(screen.getByText(/保存内容：2026-07-23/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('報告書基準日'), { target: { value: '2026-07-22' } });
    expect(screen.queryByText(/本人確認した信用建玉を保存しました/)).toBeNull();
    expect(screen.queryByText(/保存内容：2026-07-23/)).toBeNull();
  });
});
