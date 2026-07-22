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

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('SBI取引残高報告書PDF'), { target: { files: [file] } });
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
});
