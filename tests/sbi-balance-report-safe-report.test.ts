import { describe, expect, it } from 'vitest';
import { buildSbiBalanceReportSafeReport } from '@/import/sbi/balance-report-safe-report';

describe('SBI balance report safe structure', () => {
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
