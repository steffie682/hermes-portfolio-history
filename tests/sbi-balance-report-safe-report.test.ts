import { describe, expect, it } from 'vitest';
import { buildSbiBalanceReportSafeReport } from '@/import/sbi/balance-report-safe-report';

describe('SBI balance report safe structure', () => {
  it('keeps only validated numeric operator diagnostics', () => {
    const report = buildSbiBalanceReportSafeReport([{
      pageNumber: 1, width: 600, height: 320, extractionMode: 'none', items: [],
      textPaintOperatorCount: 4, imagePaintOperatorCount: 8, pathOperatorCount: 2,
      totalOperatorCount: 16, operatorGlyphEntryCount: 9,
      operatorUnicodeGlyphCount: 7, operatorFontCharFallbackCount: 2,
    }]);

    expect(report.pages[0]).toMatchObject({
      textPaintOperatorCount: 4, imagePaintOperatorCount: 8,
      pathOperatorCount: 2, totalOperatorCount: 16, operatorGlyphEntryCount: 9,
      operatorUnicodeGlyphCount: 7, operatorFontCharFallbackCount: 2,
    });
    expect(JSON.stringify(report)).not.toContain('undefined');
  });

  it.each([
    { operatorGlyphEntryCount: 1 },
    { operatorGlyphEntryCount: 1, operatorUnicodeGlyphCount: 1 },
    { operatorGlyphEntryCount: 1, operatorUnicodeGlyphCount: 1, operatorFontCharFallbackCount: 1 },
    { operatorGlyphEntryCount: 20_001, operatorUnicodeGlyphCount: 0, operatorFontCharFallbackCount: 0 },
    { operatorGlyphEntryCount: 1.5, operatorUnicodeGlyphCount: 0, operatorFontCharFallbackCount: 0 },
  ])('rejects partial or malformed glyph diagnostics %#', (diagnostics) => {
    expect(() => buildSbiBalanceReportSafeReport([{
      pageNumber: 1, width: 600, height: 320, items: [],
      textPaintOperatorCount: 1, imagePaintOperatorCount: 0, pathOperatorCount: 0,
      totalOperatorCount: 1, ...diagnostics,
    }])).toThrow('構造が大きすぎます');
  });

  it('rejects aggregate operator glyph entries above 20,000', () => {
    expect(() => buildSbiBalanceReportSafeReport([1, 2].map((pageNumber) => ({
      pageNumber, width: 600, height: 320, items: [],
      textPaintOperatorCount: 1, imagePaintOperatorCount: 0, pathOperatorCount: 0,
      totalOperatorCount: 1, operatorGlyphEntryCount: 10_001,
      operatorUnicodeGlyphCount: 0, operatorFontCharFallbackCount: 0,
    })))).toThrow('構造が大きすぎます');
  });

  it.each([NaN, -1, 1.5, 200_001])('rejects an invalid operator diagnostic %s', (invalid) => {
    expect(() => buildSbiBalanceReportSafeReport([{
      pageNumber: 1, width: 600, height: 320, items: [],
      textPaintOperatorCount: invalid, imagePaintOperatorCount: 0,
      pathOperatorCount: 0, totalOperatorCount: 0,
    }])).toThrow('構造が大きすぎます');
  });
  it('keeps known labels and layout types without retaining source text or values', () => {
    const report = buildSbiBalanceReportSafeReport([{
      pageNumber: 1,
      width: 595,
      height: 842,
      items: [
        { text: '取引残高報告書', x: 103, y: 801, width: 120, height: 12 },
        { text: '信用取引 建玉明細', x: 98, y: 700, width: 130, height: 12 },
        { text: 'SECRET_NAME', x: 401, y: 801, width: 80, height: 12 },
        { text: '123-4567890', x: 401, y: 780, width: 80, height: 12 },
        { text: 'SECRET_SECURITY', x: 100, y: 650, width: 90, height: 12 },
        { text: '1,234,567円', x: 400, y: 650, width: 70, height: 12 },
        { text: '2026年7月18日', x: 300, y: 801, width: 80, height: 12 },
      ],
    }]);

    expect(report).toMatchObject({
      schemaVersion: 1,
      documentKind: 'sbi-balance-report-structure',
      pageCount: 1,
      pages: [{ rawItemCount: 7, discardedItemCount: 0 }],
    });
    expect(report.pages[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'known-label', labels: ['取引残高報告書'], x: 100, y: 800 }),
      expect.objectContaining({ kind: 'known-label', labels: ['信用取引', '建玉'], x: 100, y: 700 }),
      expect.objectContaining({ kind: 'date' }),
      expect.objectContaining({ kind: 'number' }),
      expect.objectContaining({ kind: 'masked-text' }),
    ]));
    const serialized = JSON.stringify(report);
    for (const secret of ['SECRET_NAME', '123-4567890', 'SECRET_SECURITY', '1,234,567', '2026', '7月18日']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
