import { createHash } from 'node:crypto';
import { toSbiCashTradeEvent } from './sbi/cash-trade-event';
import { toSbiDistributionReinvestmentEvent } from './sbi/distribution-reinvestment-event';
import { parseSbiTradeHistory } from './sbi/trade-history';

export const MAX_SBI_SOURCE_BYTES = 10 * 1024 * 1024;

const BINARY_MAGIC_BYTES = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP / OOXML
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x7f, 0x45, 0x4c, 0x46], // ELF
] as const;

function hasBinaryMagicBytes(bytes: Uint8Array) {
  return BINARY_MAGIC_BYTES.some((signature) =>
    signature.every((value, index) => bytes[index] === value));
}

export function inspectSbiSourceFile(input: {
  mediaType: string;
  bytes: Uint8Array;
}) {
  if (input.bytes.byteLength > MAX_SBI_SOURCE_BYTES) {
    throw new Error('SBI約定履歴CSVは10 MB以下のファイルを選んでください');
  }
  if (!['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(input.mediaType)) {
    throw new Error('SBI約定履歴CSVのファイル形式を確認できません');
  }
  if (hasBinaryMagicBytes(input.bytes) || input.bytes.includes(0)) {
    throw new Error('SBI約定履歴CSVとして扱えないバイナリ内容です');
  }
  const parsed = parseSbiTradeHistory(input.bytes);
  if (parsed.rows.length === 0) {
    throw new Error('SBI約定履歴CSVに取引がありません');
  }
  return {
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    byteSize: input.bytes.byteLength,
    rows: parsed.rows.map((row) => {
      if (!row.transactionType) {
        return {
          sourceRowNumber: row.sourceRowNumber,
          status: 'rejected' as const,
          eventKind: null,
          reasonCode: 'missing-transaction-type' as const,
        };
      }
      if (!row.securityName) {
        return {
          sourceRowNumber: row.sourceRowNumber,
          status: 'rejected' as const,
          eventKind: null,
          reasonCode: 'missing-security-name' as const,
        };
      }
      if (row.transactionType === '分配金再投資') {
        const candidate = toSbiDistributionReinvestmentEvent(row);
        return candidate.status === 'units-ready'
          ? {
              sourceRowNumber: row.sourceRowNumber,
              status: 'needs_review' as const,
              eventKind: null,
              reasonCode: 'needs-distribution-details' as const,
              payload: candidate.event,
            }
          : {
              sourceRowNumber: row.sourceRowNumber,
              status: 'needs_review' as const,
              eventKind: null,
              reasonCode: candidate.reason,
            };
      }
      const candidate = toSbiCashTradeEvent(row);
      return candidate.status === 'ready'
        ? {
            sourceRowNumber: row.sourceRowNumber,
            status: 'new' as const,
            eventKind: 'cash-trade' as const,
            payload: candidate.event,
          }
        : {
            sourceRowNumber: row.sourceRowNumber,
            status: 'needs_review' as const,
            eventKind: null,
            reasonCode: candidate.reason,
          };
    }),
  };
}
