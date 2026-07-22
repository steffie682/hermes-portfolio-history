import { describe, expect, it } from 'vitest';
import { buildSbiIncomeStructureSafeReport } from '@/import/sbi/balance-report-safe-report';

describe('SBI income document safe structure', () => {
  it('retains only allowlisted labels and type categories with rounded geometry', () => {
    const report = buildSbiIncomeStructureSafeReport([{
      pageNumber: 1,
      width: 595,
      height: 842,
      items: [
        { text: '収益分配金 普通分配金 再投資口数', x: 103, y: 801, width: 123, height: 12 },
        { text: 'CANARY_PRIVATE_NAME', x: 401, y: 781, width: 87, height: 12 },
        { text: '9,876,543円', x: 401, y: 651, width: 73, height: 12 },
        { text: '2026年7月22日', x: 301, y: 801, width: 83, height: 12 },
        { text: '【】・／', x: 20, y: 20, width: 12, height: 12 },
        { text: '取引残高報告書', x: 20, y: 40, width: 50, height: 12 },
      ],
    }]);

    expect(report).toMatchObject({
      schemaVersion: 1,
      documentKind: 'sbi-income-structure',
      pageCount: 1,
      pages: [{ width: 600, height: 840 }],
    });
    expect(report.pages[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'known-label', labels: ['収益分配金', '普通分配金', '再投資', '再投資口数', '口数'], x: 100, y: 800 }),
      expect.objectContaining({ kind: 'date' }),
      expect.objectContaining({ kind: 'number' }),
      expect.objectContaining({ kind: 'punctuation' }),
      expect.objectContaining({ kind: 'masked-text' }),
    ]));
    const serialized = JSON.stringify(report);
    for (const secret of ['CANARY_PRIVATE_NAME', '9,876,543', '2026', '7月22日', '取引残高報告書']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('bounds pages and items', () => {
    expect(() => buildSbiIncomeStructureSafeReport(Array.from({ length: 101 }, (_, index) => ({
      pageNumber: index + 1, width: 1, height: 1, items: [],
    })))).toThrow('構造が大きすぎます');
  });
});
