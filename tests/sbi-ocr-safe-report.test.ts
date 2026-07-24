import { describe, expect, it } from 'vitest';
import {
  buildSbiBalanceReportSafeReportFromOcr,
  createSbiOcrSafeReportBuilder,
} from '@/import/sbi/ocr-safe-report';

describe('SBI OCR safe report conversion', () => {
  it('classifies allowlisted labels while excluding private OCR canaries', () => {
    const report = buildSbiBalanceReportSafeReportFromOcr([{
      pageNumber: 2,
      width: 612,
      height: 792,
      text: '取引残高報告書\tPRIVATE-NAME-CANARY\n銘柄\tSECRET-ACCOUNT-123\t999,999円',
    }]);

    expect(report.pages[0]).toMatchObject({
      pageNumber: 2,
      extractionMode: 'ocr',
      rawItemCount: 5,
      discardedItemCount: 0,
    });
    expect(report.pages[0].items.some((item) => item.kind === 'known-label')).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('PRIVATE-NAME-CANARY');
    expect(serialized).not.toContain('SECRET-ACCOUNT-123');
    expect(serialized).not.toContain('999,999');
    expect(serialized).not.toContain('"text":');
  });

  it.each([
    ['', 'ocr-text-empty'],
    [' \r\n\t ', 'ocr-text-empty'],
    [`取引残高報告書\u0000`, 'ocr-text-forbidden-character'],
    [`取引残高報告書\u0085`, 'ocr-text-forbidden-character'],
    [`取引残高報告書\u202eSECRET`, 'ocr-text-forbidden-character'],
    ['x'.repeat(2_000_001), 'ocr-text-too-large'],
  ])('rejects unsafe or empty OCR text', (text, message) => {
    expect(() => buildSbiBalanceReportSafeReportFromOcr([{
      pageNumber: 1, width: 600, height: 800, text,
    }])).toThrow(message);
  });

  it('rejects more than 20,000 nonempty OCR cells', () => {
    const text = Array.from({ length: 20_001 }, () => 'x').join('\t');
    expect(() => buildSbiBalanceReportSafeReportFromOcr([{
      pageNumber: 1, width: 600, height: 800, text,
    }])).toThrow('ocr-text-too-many-cells');
  });

  it('rejects a safe report with no task-specific known label', () => {
    expect(() => buildSbiBalanceReportSafeReportFromOcr([{
      pageNumber: 1, width: 600, height: 800, text: 'PRIVATE NAME\t123456',
    }])).toThrow('ocr-known-label-required');
  });

  it('classifies and clears each page immediately while allowing one selected page without a label', () => {
    const builder = createSbiOcrSafeReportBuilder();
    const unknown = {
      pageNumber: 1, width: 600, height: 800, text: 'PAGE-ONE-PRIVATE-CANARY\t123456',
    };
    const known = {
      pageNumber: 2, width: 600, height: 800, text: '取引残高報告書\tPAGE-TWO-PRIVATE-CANARY',
    };
    builder.addPage(unknown);
    expect(unknown.text).toBe('');
    expect(JSON.stringify(builder.safePages)).not.toContain('PAGE-ONE-PRIVATE-CANARY');
    builder.addPage(known);
    expect(known.text).toBe('');

    const report = builder.finish();
    expect(report.pages).toHaveLength(2);
    expect(report.pages[0].items.every((item) => item.kind !== 'known-label')).toBe(true);
    expect(report.pages[1].items.some((item) => item.kind === 'known-label')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('PRIVATE-CANARY');
  });
});
