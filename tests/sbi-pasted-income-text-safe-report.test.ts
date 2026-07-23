import { describe, expect, it } from 'vitest';
import { buildSbiPastedIncomeTextSafeReport } from '@/import/sbi/pasted-income-text-safe-report';

describe('SBI pasted income text safe report', () => {
  it('classifies known labels while never serializing source canaries, dates, or numbers', () => {
    const report = buildSbiPastedIncomeTextSafeReport(
      '収益分配金\tCANARY_SECRET_VALUE\t2026/07/23\t123,456円',
    );
    const json = JSON.stringify(report);

    expect(report.pages[0].items.map((item) => item.kind))
      .toEqual(['known-label', 'masked-text', 'date', 'number']);
    expect(report.pages[0]).toMatchObject({
      extractionMode: 'pasted-text', rawItemCount: 4, discardedItemCount: 0,
    });
    expect(json).not.toContain('CANARY_SECRET_VALUE');
    expect(json).not.toContain('2026/07/23');
    expect(json).not.toContain('123,456');
  });

  it('uses only row and tab column indices for coarse rounded geometry', () => {
    const report = buildSbiPastedIncomeTextSafeReport('収益分配金\t再投資\r\n\t所得税\r住民税');

    expect(report.pages[0].items.map(({ x, y, width, height }) => ({ x, y, width, height })))
      .toEqual([
        { x: 0, y: 0, width: 0, height: 10 },
        { x: 10, y: 0, width: 0, height: 10 },
        { x: 10, y: 10, width: 0, height: 10 },
        { x: 0, y: 20, width: 0, height: 10 },
      ]);
  });

  it.each(['', ' \t\r\n '])('rejects empty or whitespace-only input', (raw) => {
    expect(() => buildSbiPastedIncomeTextSafeReport(raw)).toThrow();
  });

  it.each(['\0', '\u0001', '\u000b', '\u007f', '\u0085', '\u202a', '\u2066', '\u2069'])(
    'rejects forbidden control or bidi character %j',
    (character) => {
      expect(() => buildSbiPastedIncomeTextSafeReport(`収益分配金${character}再投資`)).toThrow();
    },
  );

  it.each(['\t', '\r', '\n'])('allows the permitted separator/control %j', (character) => {
    expect(() => buildSbiPastedIncomeTextSafeReport(`収益分配金${character}再投資`)).not.toThrow();
  });

  it('accepts exactly 2,000,000 UTF-16 units and rejects one more', () => {
    const prefix = '収益分配金';
    expect(() => buildSbiPastedIncomeTextSafeReport(
      `${prefix}${'a'.repeat(2_000_000 - prefix.length)}`,
    )).not.toThrow();
    expect(() => buildSbiPastedIncomeTextSafeReport(
      `${prefix}${'a'.repeat(2_000_001 - prefix.length)}`,
    )).toThrow();
  });

  it('accepts exactly 20,000 nonempty cells and fails before accepting a later cell', () => {
    const exact = Array.from({ length: 20_000 }, () => '収益分配金').join('\t');
    expect(buildSbiPastedIncomeTextSafeReport(exact).pages[0].rawItemCount).toBe(20_000);
    expect(() => buildSbiPastedIncomeTextSafeReport(`${exact}\tCANARY_LATER_ENTRY`)).toThrow();
  });
});
