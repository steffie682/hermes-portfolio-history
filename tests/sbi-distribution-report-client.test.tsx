import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbiDistributionReportClient from '@/app/imports/sbi/distribution-report/client';

const safeReport = {
  schemaVersion: 1 as const,
  documentKind: 'sbi-income-structure' as const,
  pageCount: 1,
  pages: [{
    pageNumber: 1, width: 600, height: 840,
    items: [
      { kind: 'known-label' as const, labels: ['収益分配金', '再投資'], x: 100, y: 800, width: 100, height: 10 },
      { kind: 'masked-text' as const, x: 400, y: 800, width: 80, height: 10 },
    ],
  }],
};

function pdfFile(name = 'CANARY_SOURCE_FILENAME.pdf', marker = 1, arrayBuffer?: () => Promise<ArrayBuffer>) {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, marker]);
  return { name, size: bytes.byteLength, arrayBuffer: arrayBuffer ?? vi.fn().mockResolvedValue(bytes.buffer) } as unknown as File;
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('SBI分配金・再投資PDF'), { target: { files: [file] } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => cleanup());

describe('SBI distribution report client', () => {
  it('shows a safe structure result and fixed-name artifact without source canaries', async () => {
    render(<SbiDistributionReportClient inspectPdf={vi.fn().mockResolvedValue(safeReport)} />);
    choose(pdfFile());

    expect(await screen.findByText('PDF 1ページ')).toBeTruthy();
    expect(screen.getByText('収益分配金')).toBeTruthy();
    const download = screen.getByRole('link', { name: '安全な構造レポートを保存' });
    expect(download.getAttribute('download')).toBe('sbi-distribution-safe-structure.json');
    const artifact = decodeURIComponent(download.getAttribute('href') ?? '');
    expect(artifact).toContain('sbi-income-structure');
    expect(artifact).not.toContain('CANARY_SOURCE_FILENAME');
    expect(document.body.textContent).not.toContain('CANARY_SOURCE_FILENAME');
  });

  it('rejects an oversized file before reading it', async () => {
    const arrayBuffer = vi.fn();
    render(<SbiDistributionReportClient inspectPdf={vi.fn()} />);
    choose({ name: 'secret.pdf', size: 20 * 1024 * 1024 + 1, arrayBuffer } as unknown as File);
    expect((await screen.findByRole('alert')).textContent).toContain('20 MB以下');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a non-PDF magic prefix without inspecting it', async () => {
    const inspectPdf = vi.fn();
    render(<SbiDistributionReportClient inspectPdf={inspectPdf} />);
    choose({ name: 'secret.pdf', size: 5, arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5]).buffer) } as unknown as File);
    expect((await screen.findByRole('alert')).textContent).toContain('PDFを確認できません');
    expect(inspectPdf).not.toHaveBeenCalled();
  });

  it('does not let stale operation A overwrite newer operation B', async () => {
    const a = deferred<typeof safeReport>();
    const reportB = { ...safeReport, pageCount: 2 };
    const inspectPdf = vi.fn((bytes: Uint8Array, signal: AbortSignal) => {
      void signal;
      return bytes[5] === 1 ? a.promise : Promise.resolve(reportB);
    });
    render(<SbiDistributionReportClient inspectPdf={inspectPdf} />);
    choose(pdfFile('A.pdf', 1));
    await waitFor(() => expect(inspectPdf).toHaveBeenCalledTimes(1));
    const signalA = inspectPdf.mock.calls[0][1];
    expect(signalA.aborted).toBe(false);
    choose(pdfFile('B.pdf', 2));
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
    const view = render(<SbiDistributionReportClient inspectPdf={inspectPdf} />);
    choose(pdfFile());
    await waitFor(() => expect(inspectPdf).toHaveBeenCalledTimes(1));

    const signal = inspectPdf.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(safeReport);
  });

  it('clears a prior report before rejecting an invalid replacement', async () => {
    render(<SbiDistributionReportClient inspectPdf={vi.fn().mockResolvedValue(safeReport)} />);
    choose(pdfFile());
    expect(await screen.findByText('PDF 1ページ')).toBeTruthy();

    choose({ name: 'replacement.pdf', size: 5, arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(5).buffer) } as unknown as File);
    expect(screen.queryByRole('link', { name: '安全な構造レポートを保存' })).toBeNull();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
