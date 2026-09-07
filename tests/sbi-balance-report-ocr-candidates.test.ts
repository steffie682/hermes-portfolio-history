import { describe, expect, it } from 'vitest';
import {
  diagnoseBalanceReportOcrCandidates,
  emptyBalanceReportOcrCandidates,
  extractBalanceReportOcrCandidates,
  mergeBalanceReportOcrCandidates,
  type OcrCandidatePage,
} from '@/import/sbi/balance-report-ocr-candidates';

function line(y: number, entries: Array<[string, number]>) {
  return {
    text: entries.map(([text]) => text).join(' '), confidence: 90,
    bbox: { x0: 0, y0: y, x1: 1_000, y1: y + 15 },
    words: entries.map(([text, x]) => ({ text, confidence: 90, bbox: { x0: x, y0: y, x1: x + 60, y1: y + 15 } })),
  };
}
function preciseLine(y: number, entries: Array<[string, number, number]>) {
  const result = line(y, entries.map(([text, x]) => [text, x]));
  result.words.forEach((word, index) => { word.bbox.x1 = entries[index][1] + entries[index][2]; });
  return result;
}
function page(pageNumber: number, lines: ReturnType<typeof line>[]): OcrCandidatePage {
  return { pageNumber, width: 1_000, height: 1_400, blocks: [{ paragraphs: [{ lines }] }] };
}

describe('SBI balance-report on-device OCR candidates', () => {
  it('keeps optional local metadata unknown for older inputs and preserves explicit booleans', () => {
    const inputs = [page(1, []), { ...page(2, []), textPresent: false, maskApplied: false },
      { ...page(3, []), textPresent: true, maskApplied: true }];
    const results = diagnoseBalanceReportOcrCandidates(inputs, emptyBalanceReportOcrCandidates()).pages;
    expect(results.map(({ textPresent, maskApplied }) => ({ textPresent, maskApplied }))).toEqual([
      { textPresent: null, maskApplied: null }, { textPresent: false, maskApplied: false },
      { textPresent: true, maskApplied: true },
    ]);
  });

  it('distinguishes empty OCR structure from a received low-confidence rejected line', () => {
    const low = line(70, [['合成診断ヘッダー', 100]]);
    low.confidence = 20;
    low.words[0].confidence = 30;
    const inputs = [{ ...page(1, []), blocks: null }, page(2, [line(10, []), low])];
    const diagnostics = diagnoseBalanceReportOcrCandidates(inputs, emptyBalanceReportOcrCandidates());
    expect(diagnostics.pages[0]).toMatchObject({
      rawBlockCount: 0, rawLineCount: 0, rawWordCount: 0, evaluatedNonemptyLineCount: 0,
      trustedLineCount: 0, rejectedLineCount: 0,
      rejectionReasonCounts: { lineConfidence: 0, wordConfidence: 0 },
      rejectionReasonCountsOverlap: true,
    });
    expect(diagnostics.pages[1]).toMatchObject({
      rawBlockCount: 1, rawLineCount: 2, rawWordCount: 1, evaluatedNonemptyLineCount: 1,
      trustedLineCount: 0, rejectedLineCount: 1,
      rejectionReasonCounts: { lineConfidence: 1, wordConfidence: 1 },
      rejectionReasonCountsOverlap: true,
    });
  });

  it.each([
    ['line confidence nonfinite', 'lineConfidence', (entry: ReturnType<typeof line>) => { entry.confidence = Number.NaN; }],
    ['word confidence nonfinite', 'wordConfidence', (entry: ReturnType<typeof line>) => { entry.words[0].confidence = Number.POSITIVE_INFINITY; }],
    ['line control', 'textControlOrLength', (entry: ReturnType<typeof line>) => { entry.text += '\u202e'; }],
    ['word control', 'textControlOrLength', (entry: ReturnType<typeof line>) => { entry.words[0].text += '\n'; }],
    ['original line length', 'textControlOrLength', (entry: ReturnType<typeof line>) => { entry.text = ' '.repeat(501); }],
    ['word length', 'textControlOrLength', (entry: ReturnType<typeof line>) => { entry.words[0].text = '合'.repeat(101); entry.text = entry.words[0].text; }],
    ['empty word', 'textControlOrLength', (entry: ReturnType<typeof line>) => { entry.words[0].text = ''; entry.text = ''; }],
    ['mismatch', 'lineWordMismatch', (entry: ReturnType<typeof line>) => { entry.text = '別の合成ヘッダー'; }],
    ['line geometry', 'geometryOrContainment', (entry: ReturnType<typeof line>) => { entry.bbox.x1 = 1_001; }],
    ['word geometry', 'geometryOrContainment', (entry: ReturnType<typeof line>) => { entry.words[0].bbox.x0 = Number.NaN; }],
    ['containment', 'geometryOrContainment', (entry: ReturnType<typeof line>) => { entry.words[0].bbox.y1 += 2; }],
  ])('counts %s per rejected line without mutating evidence', (_label, reason, invalidate) => {
    const entry = line(70, [['合成診断ヘッダー', 100]]);
    invalidate(entry);
    const input = page(1, [entry]);
    const before = structuredClone(input);
    const result = diagnoseBalanceReportOcrCandidates([input], emptyBalanceReportOcrCandidates()).pages[0];
    expect(result.rejectionReasonCounts).toHaveProperty(reason, 1);
    expect(result).toMatchObject({ evaluatedNonemptyLineCount: 1, rejectedLineCount: 1, trustedLineCount: 0 });
    expect(extractBalanceReportOcrCandidates([input])).toEqual(emptyBalanceReportOcrCandidates());
    expect(input).toEqual(before);
  });

  it('counts overlapping reasons and keeps previousY from rejected lines and across paragraphs', () => {
    const high = line(200, [['合成診断ヘッダー', 100]]);
    high.confidence = 0;
    const invalidY = line(Number.NaN, [['合成診断ヘッダー', 100]]);
    const reversed = line(100, [['合成診断ヘッダー', 100]]);
    reversed.words[0].confidence = 0;
    const near = line(199, [['合成診断ヘッダー', 100]]);
    const input = page(1, [high, invalidY]);
    input.blocks!.push({ paragraphs: [{ lines: [reversed, near] }] });
    const result = diagnoseBalanceReportOcrCandidates([input], emptyBalanceReportOcrCandidates()).pages[0];
    expect(result).toMatchObject({ rawBlockCount: 2, rawLineCount: 4, rawWordCount: 4,
      evaluatedNonemptyLineCount: 4, rejectedLineCount: 3, trustedLineCount: 1,
      rejectionReasonCountsOverlap: true,
      rejectionReasonCounts: { lineConfidence: 1, wordConfidence: 1, textControlOrLength: 0,
        lineWordMismatch: 0, geometryOrContainment: 1, reversedReadingOrder: 2 },
    });
  });

  it('serializes only diagnostic counts and booleans, never synthetic source canaries or values', () => {
    const input = page(1, [line(70, [['SYNTHETIC-DIAGNOSTIC-CANARY', 100], ['987654321円', 300]])]);
    const candidates = emptyBalanceReportOcrCandidates();
    candidates.margin.push({ sourcePage: '1', securityName: 'SYNTHETIC-CANDIDATE-CANARY', quantity: '987654321' });
    const before = structuredClone({ input, candidates });
    const diagnostic = diagnoseBalanceReportOcrCandidates([input], candidates);
    const serialized = JSON.stringify(diagnostic);
    for (const secret of ['SYNTHETIC-DIAGNOSTIC-CANARY', 'SYNTHETIC-CANDIDATE-CANARY', '987654321']) {
      expect(serialized).not.toContain(secret);
    }
    expect({ input, candidates }).toEqual(before);
    expect(diagnostic.pages[0].marginCandidateCount).toBe(1);
  });

  it('accepts the single trailing LF emitted by Tesseract without mutating OCR evidence', () => {
    const lines = [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(120, [['合成株式会社', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ];
    for (const entry of lines) entry.text += '\n';
    const input = page(6, lines);
    const before = structuredClone(input);
    const candidates = extractBalanceReportOcrCandidates([input]);
    expect(candidates.domesticStockLots).toHaveLength(1);
    expect(candidates.domesticStockLots[0]).toMatchObject({ securityCode: '1234', quantity: '100', acquisitionUnitPrice: '1000' });
    expect(diagnoseBalanceReportOcrCandidates([input], candidates).pages[0].trustedLineCount).toBe(3);
    expect(input).toEqual(before);
  });

  it.each([
    ['embedded LF', '1,000\n円'],
    ['embedded TAB', '1,000\t円'],
    ['embedded CR', '1,000\r円'],
    ['double LF', '1,000円\n\n'],
    ['CRLF', '1,000円\r\n'],
    ['bare CR', '1,000円\r'],
    ['NUL', '1,000円\u0000'],
    ['bidi control', '1,000円\u202e'],
  ])('does not admit %s by accepting a line terminator', (_label, malicious) => {
    const entry = line(120, [['合成株式会社', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    entry.text = entry.text.replace('1,000円', malicious) + '\n';
    const input = page(6, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]), entry,
    ]);
    expect(extractBalanceReportOcrCandidates([input]).domesticStockLots).toEqual([]);
    expect(diagnoseBalanceReportOcrCandidates([input], emptyBalanceReportOcrCandidates()).pages[0].trustedLineCount).toBe(2);
  });

  it.each(['word LF', 'low confidence', 'mismatched text', 'oversize text'])('keeps %s rejected on LF-terminated lines', (kind) => {
    const entry = line(70, [['信用取引の建玉残高', 100]]);
    entry.text += '\n';
    if (kind === 'word LF') entry.words[0].text += '\n';
    if (kind === 'low confidence') entry.words[0].confidence = 69;
    if (kind === 'mismatched text') entry.text = '信用取引の建玉残高別紙\n';
    if (kind === 'oversize text') entry.text = `${' '.repeat(500)}${entry.text}`;
    const input = page(6, [entry]);
    expect(diagnoseBalanceReportOcrCandidates([input], emptyBalanceReportOcrCandidates()).pages[0].trustedLineCount).toBe(0);
  });

  it('recognizes a split-word Japanese section with a real-engine-style terminal LF', () => {
    const text = '信用取引の建玉残高';
    const entry = preciseLine(70, Array.from(text).map((character, index) => [character, 50 + index * 25, 20]));
    entry.text += '\n';
    const input = page(6, [entry]);
    expect(diagnoseBalanceReportOcrCandidates([input], emptyBalanceReportOcrCandidates()).pages[0]).toMatchObject({ trustedLineCount: 1, marginSectionMarkerCount: 1 });
  });

  it('never autofills cash or collateral from short OCR labels', () => {
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(100, [['預り金', 100], ['0円', 850]]),
      line(130, [['信用取引保証金', 100], ['0円', 850]]),
      line(160, [['信用取引保証金（担保貸株担保金）', 100], ['99,000円', 850]]),
      line(190, [['先物・オプション取引証拠金', 100], ['0円', 850]]),
    ])]);
    expect(candidates.deposits).toEqual([]);
    expect(candidates.collateral).toEqual([]);
  });

  it('extracts domestic acquisition rows and maps parenthesized values to reference fields', () => {
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(120, [['合成株式会社', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
      line(145, [['(900円)', 690], ['(90,000円)', 860]]),
      line(180, [['テスト工業', 80], ['[5678]', 280], ['2023/02/10', 420], ['200株', 560], ['2,000円', 690], ['400,000円', 860]]),
      line(205, [['(2,100円)', 690], ['(420,000円)', 860]]),
    ])]);
    expect(candidates.domesticStockLots).toEqual([
      expect.objectContaining({ securityCode: '1234', securityName: '合成株式会社', acquisitionDate: '2024-01-15', quantity: '100', acquisitionUnitPrice: '1000', purchaseAmount: '100000', referencePrice: '', evaluationAmount: '', sourcePage: '', sourceRow: '' }),
      expect.objectContaining({ securityCode: '5678', sourcePage: '', sourceRow: '' }),
    ]);
  });

  it('extracts only self-contained fund rows and skips multi-line totals', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成世界ファンド', 80], ['[901.23]', 320], ['2024/01/10', 470], ['10口', 600]]),
      line(145, [['2024/02/20', 470], ['20口', 600]]),
      line(170, [['銘柄計', 470], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]),
      line(210, [['合成米国ファンド', 80], ['[902.34]', 320], ['2024/03/01', 470], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([
      expect.objectContaining({ securityCode: '902.34', securityName: '合成米国ファンド', units: '40', referencePrice: '30000', referencePriceUnit: '', evaluationAmount: '2000', sourcePage: '', sourceRow: '' }),
    ]);
  });

  it('drops a group when a missed adjacent code would mix two securities', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成第一ファンド', 80], ['[901.23]', 320]]),
      line(180, [['合成第二ファンド', 80], ['コード不鮮明', 320], ['2024/02/10', 470], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('never combines a later physical line into an incomplete candidate', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成境界ファンド', 80], ['[901.23]', 320]]),
      line(450, [['30口', 590], ['120,000円', 740], ['1,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('rejects low-confidence rows and invalid page geometry', () => {
    const low = line(100, [['合成低信頼ファンド', 80], ['[901.23]', 320], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]);
    low.confidence = 20;
    for (const word of low.words) word.confidence = 20;
    const invalid = page(5, [line(100, [['合成無効ファンド', 80], ['[902.34]', 320], ['40口', 600], ['30,000円', 740], ['2,000円', 890]])]);
    invalid.height = Number.NaN;
    expect(extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]), low]), invalid]).fundBalances).toEqual([]);
  });


  it('rejects rows outside a proven section and expected column header', () => {
    const unrelated = page(2, [
      line(80, [['信用取引', 80]]),
      line(100, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(130, [['合成建玉', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ]);
    const noColumns = page(3, [
      line(80, [['国内株式', 80]]),
      line(130, [['合成株式', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ]);
    expect(extractBalanceReportOcrCandidates([unrelated, noColumns]).domesticStockLots).toEqual([]);
  });

  it('rejects a domestic security code outside the server grammar', () => {
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(120, [['合成株式会社', 80], ['[ABCD]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });

  it('rejects low-confidence required words, impossible dates, and malformed boxes', () => {
    const low = line(130, [['合成低信頼株', 80], ['[1234]', 280], ['2024/02/20', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    low.words[1].confidence = 0;
    const badDate = line(160, [['合成無効日株', 80], ['[5678]', 280], ['2024/02/31', 420], ['200株', 560], ['2,000円', 690], ['400,000円', 860]]);
    const badBox = line(190, [['合成無効座標株', 80], ['[9012]', 280], ['2024/03/01', 420], ['300株', 560], ['3,000円', 690], ['900,000円', 860]]);
    badBox.words[3].bbox.x1 = -1;
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      low, badDate, badBox,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });

  it('keeps distinct identical-looking lots by private row position and deduplicates an overlapping batch', () => {
    const first = { _localId: '4:domestic:100:1400:1234', securityCode: '1234', securityName: '合成株', acquisitionDate: '2024-01-15', quantity: '100', acquisitionUnitPrice: '1000' };
    const second = { ...first, _localId: '4:domestic:200:1400:1234' };
    const batchA = emptyBalanceReportOcrCandidates(); batchA.domesticStockLots = [first, second];
    const batchB = emptyBalanceReportOcrCandidates(); batchB.domesticStockLots = [{ ...first }];
    expect(mergeBalanceReportOcrCandidates(batchA, batchB).domesticStockLots).toEqual([first, second]);
  });



  it('treats a low-confidence identifying continuation as a hard section boundary', () => {
    const first = line(120, [['第一ファンド', 80], ['[901.23]', 320]]);
    const hiddenSecond = line(160, [['第二ファンド', 80], ['[902.34]', 320], ['40口', 600], ['30,000円', 740], ['2,000円', 890]]);
    hiddenSecond.words[0].confidence = 0;
    hiddenSecond.words[1].confidence = 0;
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      first, hiddenSecond,
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('treats a low-confidence section marker as a boundary instead of carrying stale context', () => {
    const boundary = line(140, [['信用取引', 80]]);
    boundary.words[0].confidence = 0;
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      boundary,
      line(170, [['合成信用行', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });


  it('treats aggregate line text missing from words as a hard boundary', () => {
    const hiddenBoundary = line(140, [['信用取引', 80]]);
    hiddenBoundary.words = [];
    const hiddenFundIdentity = line(160, [['40口', 600], ['30,000円', 740], ['2,000円', 890]]);
    hiddenFundIdentity.text = '第二ファンド [902.34] 40口 30,000円 2,000円';
    const domestic = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      hiddenBoundary,
      line(170, [['合成信用行', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]),
    ])]);
    const fund = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['第一ファンド', 80], ['[901.23]', 320]]),
      hiddenFundIdentity,
    ])]);
    expect(domestic.domesticStockLots).toEqual([]);
    expect(fund.fundBalances).toEqual([]);
  });

  it('rejects words whose geometry is outside their containing line', () => {
    const displaced = line(120, [['合成座標株', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    for (const word of displaced.words) { word.bbox.y0 = 900; word.bbox.y1 = 915; }
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      displaced,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });


  it('rejects a tall line whose identity and values occupy different vertical bands', () => {
    const split = line(120, [['合成縦分離株', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]]);
    split.bbox.y1 = 230;
    for (const word of split.words.slice(3)) { word.bbox.y0 = 200; word.bbox.y1 = 215; }
    const candidates = extractBalanceReportOcrCandidates([page(4, [
      line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      split,
    ])]);
    expect(candidates.domesticStockLots).toEqual([]);
  });

  it('rejects physically reversed lines regardless of OCR array order', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(200, [['第一ファンド', 80], ['[901.23]', 320]]),
      line(120, [['40口', 600], ['30,000円', 740], ['2,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('does not treat a bare decimal amount in the code column as a fund code', () => {
    const candidates = extractBalanceReportOcrCandidates([page(5, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成集計値', 80], ['901.23', 320], ['30口', 600], ['120,000円', 740], ['1,000円', 890]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
  });

  it('reports the candidate cap instead of silently treating a truncated merge as complete', () => {
    const first = emptyBalanceReportOcrCandidates();
    first.domesticStockLots = Array.from({ length: 100 }, (_, index) => ({ _localId: `4:domestic:${100 + index * 50}:10000:1234`, securityCode: '1234' }));
    const next = emptyBalanceReportOcrCandidates();
    next.domesticStockLots = [{ _localId: '5:domestic:100:1400:5678', securityCode: '5678' }];
    const merged = mergeBalanceReportOcrCandidates(first, next);
    expect(merged.domesticStockLots).toHaveLength(100);
    expect(merged.limitReached).toBe(true);
  });

  it('never classifies futures positions as credit margin positions', () => {
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['先物建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      line(120, [['合成銘柄[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
        ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
        ['-10,000円', 850], ['2024/07/15', 910]]),
    ])]);
    expect(candidates.margin).toEqual([]);
  });

  it('requires every margin header label in its corresponding proven column', () => {
    const shiftedHeader = line(90, [['銘柄名(弁済期限)', 20], ['指定', 22], ['数量・市場', 24], ['区分', 26],
      ['約定年月日', 28], ['約定単価', 30], ['時価', 32], ['手数料', 34], ['評価損益', 36], ['最終決済期日', 38]]);
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['信用取引の建玉残高', 40]]), shiftedHeader,
      line(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
        ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
        ['-10,000円', 850], ['2024/07/15', 910]]),
    ])]);
    expect(candidates.margin).toEqual([]);
  });

  it('rejects non-exact section markers and geometrically unproven headers', () => {
    const marginHeader = line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
      ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790], ['評価損益', 850], ['最終決済期日', 910]]);
    for (const word of marginHeader.words) word.bbox.x1 = 999;
    const marginRow = line(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
      ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790], ['-10,000円', 850], ['2024/07/15', 910]]);
    const nonExact = extractBalanceReportOcrCandidates([page(6, [line(70, [['非信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440], ['約定年月日', 520],
        ['約定単価', 630], ['時価', 720], ['手数料', 790], ['評価損益', 850], ['最終決済期日', 910]]), marginRow])]);
    const overlapping = extractBalanceReportOcrCandidates([page(6, [line(70, [['信用取引の建玉残高', 40]]), marginHeader, marginRow])]);
    const shiftedDomestic = extractBalanceReportOcrCandidates([page(4, [line(70, [['国内株式', 100]]),
      line(90, [['銘柄名', 80], ['数量', 100], ['取得価格', 120], ['買付金額', 140]]),
      line(120, [['合成株式会社', 80], ['[1234]', 280], ['2024/01/15', 420], ['100株', 560], ['1,000円', 690], ['100,000円', 860]])])]);
    const shiftedFund = extractBalanceReportOcrCandidates([page(5, [line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 100], ['参考価格', 120], ['評価額', 140]]),
      line(120, [['合成ファンド', 80], ['[902.34]', 320], ['40口', 600], ['30,000円', 740], ['2,000円', 890]])])]);
    expect(nonExact.margin).toEqual([]); expect(overlapping.margin).toEqual([]);
    expect(shiftedDomestic.domesticStockLots).toEqual([]); expect(shiftedFund.fundBalances).toEqual([]);
  });

  it('rejects malformed punctuation before canonicalizing financial decimals', () => {
    const header = line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
      ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790], ['評価損益', 850], ['最終決済期日', 910]]);
    const rows = ['1,2,3円', '1(2)3円', '(1,000)円'].map((price, index) => line(120 + index * 25, [
      [`合成建設[${1234 + index * 2}]6ヶ月`, 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
      ['2024/01/15', 520], [price, 630], ['900円', 720], ['-', 790], ['-10,000円', 850], ['2024/07/15', 910],
    ]));
    const candidates = extractBalanceReportOcrCandidates([page(6, [line(70, [['信用取引の建玉残高', 40]]), header, ...rows])]);
    expect(candidates.margin).toEqual([]);
  });

  it('does not collapse distinct rows just beyond the normalized jitter boundary', () => {
    const first = { _localId: '6:margin:100000:1000000:1234', securityCode: '1234', securityName: '合成建設' };
    const second = { ...first, _localId: '6:margin:103004:1000000:1234' };
    const left = emptyBalanceReportOcrCandidates(); left.margin = [first];
    const right = emptyBalanceReportOcrCandidates(); right.margin = [second];
    expect(mergeBalanceReportOcrCandidates(left, right).margin).toEqual([first, second]);
  });

  it('rejects a server-incompatible margin security code and confidence below 70', () => {
    const header = line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
      ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
      ['評価損益', 850], ['最終決済期日', 910]]);
    const invalidCode = line(120, [['合成建設[ABCD]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
      ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790], ['-10,000円', 850], ['2024/07/15', 910]]);
    const lowConfidence = line(150, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
      ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790], ['-10,000円', 850], ['2024/07/15', 910]]);
    lowConfidence.confidence = 65; for (const token of lowConfidence.words) token.confidence = 65;
    const candidates = extractBalanceReportOcrCandidates([page(6, [line(70, [['信用取引の建玉残高', 40]]), header, invalidCode, lowConfidence])]);
    expect(candidates.margin).toEqual([]);
  });

  it('deduplicates the same identical margin row across one-pixel OCR jitter', () => {
    const candidatePage = (y: number) => page(6, [
      line(70, [['信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      line(y, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
        ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
        ['-10,000円', 850], ['2024/07/15', 910]]),
    ]);
    const first = extractBalanceReportOcrCandidates([candidatePage(120)]);
    const repeated = extractBalanceReportOcrCandidates([candidatePage(121)]);
    expect(mergeBalanceReportOcrCandidates(first, repeated).margin).toHaveLength(1);
  });

  it('extracts the live SBI two-line margin layout with a separate code column', () => {
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['【信用取引の建玉残高】', 40]]),
      line(90, [['銘柄名（弁済期限）', 20], ['コード', 265], ['数量・市場', 330], ['区分', 390],
        ['約定年月日', 490], ['約定単価', 560], ['作成基準日現在の時価', 660], ['手数料その他経費', 760],
        ['評価損益', 850], ['最終決済期日または決済予定日', 920]]),
      preciseLine(120, [['合成建設（6ヶ月期限）', 20, 215], ['1234', 265, 25], ['100株', 330, 20], ['買', 390, 20],
        ['2024.6.20', 440, 50], ['223円', 520, 50], ['2024.6.27', 900, 70]]),
      preciseLine(136, [['特定対象', 200, 35], ['東京', 330, 20], ['決済ずみ', 390, 35]]),
    ])]);
    expect(candidates.margin).toEqual([expect.objectContaining({
      securityCode: '1234', securityName: '合成建設', repaymentTermLabel: '6ヶ月期限',
      designationLabel: '特定対象', quantity: '100', market: 'tokyo', side: 'buy', state: 'settled',
      contractDate: '2024-06-20', contractUnitPrice: '223', currentPrice: '', fees: '', unrealizedPnl: '',
      finalSettlementOrPlannedDate: '2024-06-27', sourcePage: '6', sourceRow: '',
    })]);
  });

  it('reports only non-sensitive parser-stage counts for live margin OCR', () => {
    const candidatePage = page(6, [
      line(70, [['【信用取引の建玉残高】', 40]]),
      line(90, [['銘柄名（弁済期限）', 20], ['コード', 265], ['数量・市場', 330], ['区分', 390],
        ['約定年月日', 490], ['約定単価', 560], ['作成基準日現在の時価', 660], ['手数料その他経費', 760],
        ['評価損益', 850], ['最終決済期日または決済予定日', 920]]),
      preciseLine(120, [['合成建設（6ヶ月期限）', 20, 215], ['1234', 265, 25], ['100株', 330, 20], ['買', 390, 20],
        ['2024.6.20', 440, 50], ['223円', 520, 50], ['2024.6.27', 900, 70]]),
      preciseLine(136, [['特定対象', 200, 35], ['東京', 330, 20], ['決済ずみ', 390, 35]]),
      { ...line(180, [['LOW-CONFIDENCE-CANARY', 20]]), confidence: 65 },
    ]);
    candidatePage.blocks![0].paragraphs[0].lines[4].words[0].confidence = 65;
    const candidates = extractBalanceReportOcrCandidates([candidatePage]);
    expect(diagnoseBalanceReportOcrCandidates([candidatePage], candidates)).toEqual({ pages: [{
      pageNumber: 6, trustedLineCount: 4, marginSectionMarkerCount: 1,
      textPresent: null, maskApplied: null,
      marginHeaderCount: 1, eligibleMarginLineCount: 2, marginCandidateCount: 1,
      rawBlockCount: 1, rawLineCount: 5, rawWordCount: 22, evaluatedNonemptyLineCount: 5, rejectedLineCount: 1,
      rejectionReasonCountsOverlap: true,
      rejectionReasonCounts: { lineConfidence: 1, wordConfidence: 1, textControlOrLength: 0,
        lineWordMismatch: 0, geometryOrContainment: 0, reversedReadingOrder: 0 },
    }] });
    expect(JSON.stringify(diagnoseBalanceReportOcrCandidates([candidatePage], candidates)))
      .not.toMatch(/合成建設|1234|223|特定対象/u);
  });

  it('rejects an overlapping live header and a low-confidence live continuation', () => {
    const header = () => line(90, [['銘柄名（弁済期限）', 20], ['コード', 265], ['数量・市場', 330], ['区分', 390],
      ['約定年月日', 490], ['約定単価', 560], ['作成基準日現在の時価', 660], ['手数料その他経費', 760],
      ['評価損益', 850], ['最終決済期日または決済予定日', 920]]);
    const primary = () => preciseLine(120, [['合成建設（6ヶ月期限）', 20, 215], ['1234', 265, 25],
      ['100株', 330, 20], ['買', 390, 20], ['2024.6.20', 440, 50], ['223円', 520, 50], ['2024.6.27', 900, 70]]);
    const continuation = (y = 136, designation = true) => preciseLine(y, [
      ...(designation ? [['特定対象', 200, 35] as [string, number, number]] : []),
      ['東京', 330, 20], ['決済ずみ', 390, 35],
    ]);
    const overlapping = header(); overlapping.words[1].bbox.x1 = 390;
    const low = continuation(); low.words[2].confidence = 65;
    const section = line(70, [['【信用取引の建玉残高】', 40]]);
    expect(extractBalanceReportOcrCandidates([page(6, [section, overlapping, primary(), continuation()])]).margin).toEqual([]);
    expect(extractBalanceReportOcrCandidates([page(6, [section, header(), primary(), low])]).margin).toEqual([]);

    const crossRowContinuation = continuation(150);
    expect(extractBalanceReportOcrCandidates([page(6, [section, header(), primary(), crossRowContinuation])]).margin).toEqual([]);

    const paddedPrimary = primary(); paddedPrimary.bbox.y1 = 150;
    const splitWordBand = continuation(150); splitWordBand.bbox.y1 = 180;
    for (const word of splitWordBand.words) { word.bbox.y0 = 175; word.bbox.y1 = 180; }
    expect(extractBalanceReportOcrCandidates([page(6, [section, header(), paddedPrimary, splitWordBand])]).margin).toEqual([]);

    const spanningPrimary = primary(); spanningPrimary.words[1].bbox.x1 = 340;
    expect(extractBalanceReportOcrCandidates([page(6, [section, header(), spanningPrimary, continuation()])]).margin).toEqual([]);

    expect(extractBalanceReportOcrCandidates([page(6, [section, header(), primary(), continuation(136, false)])]).margin)
      .toEqual([expect.objectContaining({ designationLabel: '' })]);
  });

  it('extracts a complete self-contained margin row after a trusted margin header', () => {
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      line(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
        ['2024/01/15', 520], ['1,000.00円', 630], ['900.50円', 720], ['1.00円', 790],
        ['-10,000.00円', 850], ['2024/07/15', 910]]),
    ])]);
    expect(candidates.margin).toEqual([expect.objectContaining({
      securityCode: '1234', securityName: '合成建設', repaymentTermLabel: '6ヶ月', designationLabel: '',
      quantity: '100', market: 'tokyo', side: 'buy', state: 'open', contractDate: '2024-01-15',
      contractUnitPrice: '1000', currentPrice: '900.5', fees: '1', unrealizedPnl: '-10000',
      finalSettlementOrPlannedDate: '2024-07-15', sourcePage: '6', sourceRow: '',
    })]);
  });

  it('keeps 28 distinct physical margin rows even when every financial field is identical', () => {
    const rows = Array.from({ length: 28 }, (_, index) => line(120 + index * 25, [
      ['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
      ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
      ['-10,000円', 850], ['2024/07/15', 910],
    ]));
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      ...rows,
    ])]);
    expect(candidates.margin).toHaveLength(28);
    expect(new Set(candidates.margin.map((row) => row._localId)).size).toBe(28);
    expect(candidates.limitReached).toBe(false);
  });

  it('rejects a nonpositive current price before it reaches the editable form', () => {
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      line(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買未決済', 440],
        ['2024/01/15', 520], ['1,000円', 630], ['-900円', 720], ['-', 790],
        ['-10,000円', 850], ['2024/07/15', 910]]),
    ])]);
    expect(candidates.margin).toEqual([]);
  });

  it('rejects an ambiguous margin side instead of choosing the first matching label', () => {
    const candidates = extractBalanceReportOcrCandidates([page(6, [
      line(70, [['信用取引の建玉残高', 40]]),
      line(90, [['銘柄名(弁済期限)', 20], ['指定', 260], ['数量・市場', 330], ['区分', 440],
        ['約定年月日', 520], ['約定単価', 630], ['時価', 720], ['手数料', 790],
        ['評価損益', 850], ['最終決済期日', 910]]),
      line(120, [['合成建設[1234]6ヶ月', 20], ['-', 260], ['100株東京', 330], ['買売未決済', 440],
        ['2024/01/15', 520], ['1,000円', 630], ['900円', 720], ['-', 790],
        ['-10,000円', 850], ['2024/07/15', 910]]),
    ])]);
    expect(candidates.margin).toEqual([]);
  });

  it('drops incomplete or ambiguous rows instead of inventing values', () => {
    const candidates = extractBalanceReportOcrCandidates([page(7, [
      line(70, [['投資信託', 100]]),
      line(90, [['銘柄名', 80], ['口数', 600], ['参考価格', 740], ['評価額', 890]]),
      line(120, [['合成欠損ファンド', 80], ['[901.23]', 320], ['30口', 600], ['1,000円', 890]]),
      line(180, [['国内株式', 100]]),
      line(200, [['銘柄名', 80], ['数量', 560], ['取得価格', 690], ['買付金額', 860]]),
      line(220, [['合成欠損株', 80], ['[1234]', 280], ['100株', 560], ['1,000円', 690]]),
    ])]);
    expect(candidates.fundBalances).toEqual([]);
    expect(candidates.domesticStockLots).toEqual([]);
  });
});
