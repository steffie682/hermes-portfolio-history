const SBI_TRADE_HEADERS = [
  '約定日',
  '銘柄',
  '銘柄コード',
  '市場',
  '取引',
  '期限',
  '預り',
  '課税',
  '約定数量',
  '約定単価',
  '手数料/諸経費等',
  '税額',
  '受渡日',
  '受渡金額/決済損益',
] as const;

export interface SbiTradeHistoryRow {
  sourceRowNumber: number;
  contractDate: string;
  securityName: string;
  securityCode: string | null;
  market: string | null;
  transactionType: string;
  term: string;
  custodyType: string;
  taxationType: string;
  quantity: string;
  unitPrice: string;
  feesOrExpenses: string | null;
  feesOrExpensesRaw: string;
  taxAmount: string | null;
  taxAmountRaw: string;
  settlementDate: string;
  settlementAmountOrProfitLoss: string | null;
  settlementAmountOrProfitLossRaw: string;
}

export interface ParsedSbiTradeHistory {
  metadata: {
    encoding: 'utf-8' | 'utf-8-bom' | 'shift_jis';
    headerRowNumber: number;
  };
  rows: SbiTradeHistoryRow[];
}

function decodeSource(source: Uint8Array): {
  text: string;
  encoding: ParsedSbiTradeHistory['metadata']['encoding'];
} {
  if (source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf) {
    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(3)),
        encoding: 'utf-8-bom',
      };
    } catch {
      throw new Error('SBI約定履歴CSVの文字コードを認識できません');
    }
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(source),
      encoding: 'utf-8',
    };
  } catch {
    try {
      return {
        text: new TextDecoder('shift_jis', { fatal: true }).decode(source),
        encoding: 'shift_jis',
      };
    } catch {
      throw new Error('SBI約定履歴CSVの文字コードを認識できません');
    }
  }
}

interface CsvRecord {
  values: string[];
  lineNumber: number;
  physicalBlank: boolean;
}

function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let physicalLine = 1;
  let recordStartLine = 1;
  let recordHadSyntax = false;

  const finishField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    records.push({ values: row, lineNumber: recordStartLine, physicalBlank: !recordHadSyntax });
    row = [];
    recordHadSyntax = false;
  };
  const consumeNewline = (textIndex: number): number => {
    const character = text[textIndex];
    const nextIndex = character === '\r' && text[textIndex + 1] === '\n' ? textIndex + 1 : textIndex;
    physicalLine += 1;
    return nextIndex;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== '\n' && character !== '\r') recordHadSyntax = true;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else if (character === '\n' || character === '\r') {
        field += '\n';
        index = consumeNewline(index);
      } else {
        field += character;
      }
    } else if (closedQuote) {
      if (character === ',') {
        finishField();
      } else if (character === '\n' || character === '\r') {
        finishRecord();
        index = consumeNewline(index);
        recordStartLine = physicalLine;
      } else {
        throw new Error('SBI約定履歴CSVの引用符の後に不正な文字があります');
      }
    } else if (character === '"') {
      if (field.length > 0) {
        throw new Error('SBI約定履歴CSVの引用符の位置が不正です');
      }
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      finishRecord();
      index = consumeNewline(index);
      recordStartLine = physicalLine;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('SBI約定履歴CSVに閉じていない引用符があります');
  if (field.length > 0 || row.length > 0 || closedQuote) finishRecord();
  return records;
}

function isHeader(row: string[]): boolean {
  return (
    row.length === SBI_TRADE_HEADERS.length &&
    SBI_TRADE_HEADERS.every((header, index) => row[index] === header)
  );
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value: string, rowNumber: number, column: string): string {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  throw new Error(`SBI約定履歴CSVの${rowNumber}行目: ${column}の形式が不正です`);
}

function normalizedDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed === '--') return null;
  const parenthesized = /^\((.+)\)$/.exec(trimmed);
  const candidate = parenthesized ? parenthesized[1] : trimmed;
  const groupingPattern = parenthesized
    ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
    : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!groupingPattern.test(candidate)) return null;
  const withoutSeparators = candidate.replaceAll(',', '');
  const negative = Boolean(parenthesized) || withoutSeparators.startsWith('-');
  const unsigned = withoutSeparators.replace(/^[+-]/, '');
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '');
  const fraction = fractionPart.replace(/0+$/, '');
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return /^0(?:\.0*)?$/.test(magnitude) ? '0' : `${negative ? '-' : ''}${magnitude}`;
}

function requiredDecimal(value: string, rowNumber: number, column: string): string {
  const normalized = normalizedDecimal(value);
  if (normalized === null) {
    throw new Error(`SBI約定履歴CSVの${rowNumber}行目: ${column}の形式が不正です`);
  }
  return normalized;
}

function rejectDisallowedControlCharacters(text: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
    throw new Error('SBI約定履歴CSVに許可されていない制御文字が含まれています');
  }
}

function rejectUnsafeParsedFields(values: string[]) {
  if (values.some((value) => /[\u0000-\u001f\u007f-\u009f]|\p{Bidi_Control}/u.test(value))) {
    throw new Error('SBI約定履歴CSVに許可されていない制御文字が含まれています');
  }
}

export function parseSbiTradeHistory(source: Uint8Array): ParsedSbiTradeHistory {
  const decoded = decodeSource(source);
  rejectDisallowedControlCharacters(decoded.text);
  const csvRecords = parseCsv(decoded.text);
  const headerIndex = csvRecords.findIndex((record) => isHeader(record.values));
  if (headerIndex < 0) {
    throw new Error('SBI約定履歴CSVに対応する14列の見出しがありません');
  }

  const dataRecords = csvRecords.slice(headerIndex + 1);
  let dataEnd = dataRecords.length;
  while (
    dataEnd > 0 &&
    dataRecords[dataEnd - 1].physicalBlank
  ) {
    dataEnd -= 1;
  }

  const rows = dataRecords.slice(0, dataEnd).map((record): SbiTradeHistoryRow => {
    const sourceRowNumber = record.lineNumber;
    const values = record.values;
    rejectUnsafeParsedFields(values);
    if (values.every((value) => value.length === 0)) {
      throw new Error(`SBI約定履歴CSVの${sourceRowNumber}行目: 空行は取り込めません`);
    }
    if (values.length !== SBI_TRADE_HEADERS.length) {
      throw new Error(`SBI約定履歴CSVの${sourceRowNumber}行目: 列数が不正です`);
    }

    return {
      sourceRowNumber,
      contractDate: normalizeDate(values[0], sourceRowNumber, '約定日'),
      securityName: values[1].trim(),
      securityCode: nullableText(values[2]),
      market: nullableText(values[3]),
      transactionType: values[4].trim(),
      term: values[5].trim(),
      custodyType: values[6].trim(),
      taxationType: values[7].trim(),
      quantity: requiredDecimal(values[8], sourceRowNumber, '約定数量'),
      unitPrice: requiredDecimal(values[9], sourceRowNumber, '約定単価'),
      feesOrExpenses: normalizedDecimal(values[10]),
      feesOrExpensesRaw: values[10].trim(),
      taxAmount: normalizedDecimal(values[11]),
      taxAmountRaw: values[11].trim(),
      settlementDate: normalizeDate(values[12], sourceRowNumber, '受渡日'),
      settlementAmountOrProfitLoss: normalizedDecimal(values[13]),
      settlementAmountOrProfitLossRaw: values[13].trim(),
    };
  });

  return {
    metadata: {
      encoding: decoded.encoding,
      headerRowNumber: csvRecords[headerIndex].lineNumber,
    },
    rows,
  };
}
