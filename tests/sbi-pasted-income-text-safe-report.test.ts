import { describe, expect, it } from 'vitest';
import { buildSbiPastedIncomeTextSafeReport } from '@/import/sbi/pasted-income-text-safe-report';

describe('SBI pasted income text safe report', () => {
  it('emits confirmed reinvestment headings only and keeps pasted private values out', () => {
    const raw = [
      '取引店 CANARY_BRANCH',
      'お客様の口座番号 987654321',
      '担当者 CANARY_PERSON',
      '銘柄名 CANARY_FUND',
      '再投資日 2026/07/23',
      '期数 CANARY_TERM',
      '税区分 CANARY_TAX',
      '個別元本単価 12,345円',
      '再投資金額 456,789円',
      '1 万口あたり 再投資の基準価額 11,223円',
      '再投資数量 7,654,321口',
      '備考 備考 CANARY_NOTE',
      '再投資後の残高 9,999,999口',
    ].join('\t');
    const report = buildSbiPastedIncomeTextSafeReport(raw);

    expect(report.pages[0].items.map((item) => item.labels)).toEqual([
      ['取引店'],
      ['お客様の口座番号'],
      ['担当者'],
      ['銘柄名'],
      ['再投資', '再投資日'],
      ['期数'],
      ['税区分'],
      ['個別元本', '個別元本単価'],
      ['再投資', '再投資金額'],
      ['再投資', '基準価額', '1万口あたり再投資の基準価額'],
      ['再投資', '再投資数量'],
      ['備考'],
      ['再投資', '再投資後の残高'],
    ]);
    const serialized = JSON.stringify(report);
    for (const privateValue of [
      'CANARY_', '987654321', '2026/07/23', '12,345', '456,789', '11,223', '7,654,321',
      '9,999,999',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

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
