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
    const download = screen.getByRole('link', { name: '安全な構造レポートを保存' });
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
    expect(screen.queryByRole('link', { name: '安全な構造レポートを保存' })).toBeNull();
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
    expect(screen.getByRole('link', { name: '安全な構造レポートを保存' })).toBeTruthy();
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
      expect(screen.queryByRole('link', { name: '安全な構造レポートを保存' })).toBeNull();
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
    expect(screen.queryByRole('link', { name: '安全な構造レポートを保存' })).toBeNull();
  });
});
