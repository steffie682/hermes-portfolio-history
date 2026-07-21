import { describe, expect, it } from 'vitest';
import { inspectSbiSourceFile } from '@/import/source-file-intake';

const HEADER = '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益';
const READY_ROW = '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,10,1000,--,--,2026/07/03,10000';

function validCsvBytes() {
  return new TextEncoder().encode(`${HEADER}\n${READY_ROW}`);
}

describe('source file intake', () => {
  it('validates an SBI trade CSV and classifies a supported row as new', () => {
    const result = inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: validCsvBytes(),
    });

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.byteSize).toBe(validCsvBytes().byteLength);
    expect(result.rows).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        status: 'new',
        eventKind: 'cash-trade',
      }),
    ]);
  });
  it('rejects a source larger than 10 MiB before parsing', () => {
    expect(() => inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
    })).toThrow('10 MB以下');
  });

  it('accepts the legacy Excel CSV media type used by browser uploads', () => {
    expect(inspectSbiSourceFile({
      mediaType: 'application/vnd.ms-excel',
      bytes: validCsvBytes(),
    }).rows).toHaveLength(1);
  });

  it('rejects NUL-containing binary content before CSV parsing', () => {
    const bytes = validCsvBytes();
    const binary = new Uint8Array(bytes.byteLength + 1);
    binary.set(bytes);
    binary[binary.byteLength - 1] = 0;

    expect(() => inspectSbiSourceFile({ mediaType: 'text/csv', bytes: binary }))
      .toThrow('バイナリ');
  });

  it.each([
    ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['ZIP', [0x50, 0x4b, 0x03, 0x04]],
    ['PNG', [0x89, 0x50, 0x4e, 0x47]],
    ['JPEG', [0xff, 0xd8, 0xff]],
    ['GIF', [0x47, 0x49, 0x46, 0x38]],
    ['ELF', [0x7f, 0x45, 0x4c, 0x46]],
  ])('rejects %s magic bytes before CSV parsing', (_name, signature) => {
    expect(() => inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: new Uint8Array(signature),
    })).toThrow('バイナリ');
  });

  it.each([
    ['BEL', '\u0007'],
    ['ESC', '\u001b'],
    ['C1', '\u0085'],
  ])('rejects decoded %s control characters', (_name, control) => {
    const row = READY_ROW.replace('合成銘柄', `合成${control}銘柄`);
    expect(() => inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: new TextEncoder().encode(`${HEADER}\n${row}`),
    })).toThrow('制御文字');
  });

  it('rejects a header-only CSV instead of staging an empty import', () => {
    expect(() => inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: new TextEncoder().encode(HEADER),
    })).toThrow('取引がありません');
  });

  it('stages a row with missing required identity as rejected with its source row', () => {
    const missingTransaction = '2026/07/01,合成銘柄,0000,東証,,--,特定,申告,10,1000,--,--,2026/07/03,10000';
    const result = inspectSbiSourceFile({
      mediaType: 'text/csv',
      bytes: new TextEncoder().encode(`${HEADER}\n${missingTransaction}`),
    });

    expect(result.rows).toEqual([{
      sourceRowNumber: 2,
      status: 'rejected',
      eventKind: null,
      reasonCode: 'missing-transaction-type',
    }]);
  });

});
