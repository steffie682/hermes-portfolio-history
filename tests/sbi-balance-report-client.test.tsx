import { fireEvent, render, screen } from '@testing-library/react';
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
    items: [
      { kind: 'known-label' as const, labels: ['取引残高報告書', '信用取引'], x: 100, y: 800, width: 100, height: 10 },
      { kind: 'masked-text' as const, x: 400, y: 800, width: 80, height: 10 },
    ],
  }],
};

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('SBI取引残高報告書PDF'), { target: { files: [file] } });
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
});
