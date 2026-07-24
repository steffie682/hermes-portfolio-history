'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { buildSbiBalanceReportSafeReport } from '@/import/sbi/balance-report-safe-report';
import { runSbiBrowserOcr, validateOcrPageRange } from '@/import/sbi/browser-ocr';
import { extractPdfStructure, type PdfDocumentLoader } from '@/import/sbi/pdf-structure-extractor';
import BalanceReportPositionForm, {
  type BalanceReportAccountSummary,
  type SavedSnapshotSummary,
} from './balance-report-position-form';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
type SafeReport = ReturnType<typeof buildSbiBalanceReportSafeReport>;

async function inspectPdfInBrowser(source: Uint8Array, signal: AbortSignal): Promise<SafeReport> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const pages = await extractPdfStructure(
    source,
    pdfjs.getDocument as unknown as PdfDocumentLoader,
    signal,
    pdfjs.OPS,
    pdfjs.normalizeUnicode,
  );
  return buildSbiBalanceReportSafeReport(pages);
}

function hasPdfMagic(source: Uint8Array): boolean {
  return source.length >= 5
    && source[0] === 0x25
    && source[1] === 0x50
    && source[2] === 0x44
    && source[3] === 0x46
    && source[4] === 0x2d;
}

function releaseBytes(source: Uint8Array | null) {
  if (!source) return;
  try {
    source.fill(0);
  } catch {
    // PDF.js may transfer the ArrayBuffer to its worker, detaching it from this realm.
  }
}

export default function SbiBalanceReportClient({
  accounts = [],
  recentSnapshots = [],
  inspectPdf = inspectPdfInBrowser,
  runOcr = runSbiBrowserOcr,
}: {
  accounts?: BalanceReportAccountSummary[];
  recentSnapshots?: SavedSnapshotSummary[];
  inspectPdf?: (source: Uint8Array, signal: AbortSignal) => Promise<SafeReport>;
  runOcr?: (
    source: Uint8Array,
    range: { startPage: number; endPage: number },
    signal: AbortSignal,
    onProgress: (completed: number, total: number) => void,
  ) => Promise<SafeReport>;
}) {
  const operationVersion = useRef(0);
  const activeInspection = useRef<AbortController | null>(null);
  const retainedPdfBytes = useRef<Uint8Array | null>(null);
  const [report, setReport] = useState<SafeReport | null>(null);
  const [ocrPageCount, setOcrPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [ocrProgress, setOcrProgress] = useState({ completed: 0, total: 0 });
  const [ocrRunning, setOcrRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  function wipeRetainedBytes() {
    releaseBytes(retainedPdfBytes.current);
    retainedPdfBytes.current = null;
  }

  useEffect(() => () => {
    operationVersion.current += 1;
    activeInspection.current?.abort();
    activeInspection.current = null;
    wipeRetainedBytes();
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    activeInspection.current?.abort();
    activeInspection.current = null;
    wipeRetainedBytes();
    const version = ++operationVersion.current;
    const file = event.currentTarget.files?.[0];
    setReport(null);
    setOcrPageCount(null);
    setOcrRunning(false);
    setOcrProgress({ completed: 0, total: 0 });
    setStatus('');
    setError('');
    if (!file) {
      input.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      input.value = '';
      setError('PDFは20 MB以下のファイルを選んでください。');
      return;
    }
    setStatus('PDFを端末内で確認しています…');
    let bytes: Uint8Array | null = null;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      input.value = '';
      if (version !== operationVersion.current) {
        releaseBytes(bytes);
        bytes = null;
        return;
      }
      if (!hasPdfMagic(bytes)) throw new Error('not-pdf');
      retainedPdfBytes.current = bytes;
      const controller = new AbortController();
      activeInspection.current = controller;
      const inspectionBytes = bytes.slice();
      let nextReport: SafeReport;
      try {
        nextReport = await inspectPdf(inspectionBytes, controller.signal);
      } finally {
        releaseBytes(inspectionBytes);
      }
      if (version !== operationVersion.current) return;
      const needsOcr = nextReport.pages.length > 0
        && nextReport.pages.every((page) =>
          page.extractionMode === 'none' && page.items.length === 0);
      if (needsOcr) {
        const defaultEnd = Math.min(5, nextReport.pageCount);
        setStartPage(1);
        setEndPage(defaultEnd);
        setOcrPageCount(nextReport.pageCount);
        setStatus(`自動抽出できませんでした。PDF ${nextReport.pageCount}ページ`);
      } else {
        setReport(nextReport);
        setStatus(`PDF ${nextReport.pageCount}ページ`);
        wipeRetainedBytes();
        bytes = null;
      }
    } catch {
      if (version !== operationVersion.current) return;
      wipeRetainedBytes();
      setReport(null);
      setOcrPageCount(null);
      setStatus('');
      setError('PDFを確認できませんでした。SBIの取引残高報告書PDFを選び直してください。');
    } finally {
      input.value = '';
      if (bytes && retainedPdfBytes.current !== bytes) releaseBytes(bytes);
      if (version === operationVersion.current) activeInspection.current = null;
    }
  }

  async function handleStartOcr() {
    if (ocrPageCount === null || !retainedPdfBytes.current) return;
    const ocrBytes = retainedPdfBytes.current;
    let range: { startPage: number; endPage: number };
    try {
      range = validateOcrPageRange(startPage, endPage, ocrPageCount);
    } catch {
      setError('開始・終了ページはPDF内の整数で、開始≤終了、合計5ページ以内にしてください。');
      return;
    }
    const version = operationVersion.current;
    const controller = new AbortController();
    activeInspection.current?.abort();
    activeInspection.current = controller;
    setReport(null);
    setError('');
    setOcrRunning(true);
    setOcrProgress({ completed: 0, total: range.endPage - range.startPage + 1 });
    setStatus('端末内で日本語OCRを準備しています…');
    try {
      const nextReport = await runOcr(
        ocrBytes,
        range,
        controller.signal,
        (completed, total) => {
          if (version !== operationVersion.current || controller.signal.aborted) return;
          setOcrProgress({ completed, total });
          setStatus(`端末内で日本語OCRを実行中… ${completed}/${total}ページ`);
        },
      );
      if (version !== operationVersion.current || controller.signal.aborted) return;
      const hasKnownLabel = nextReport.pages.some((page) =>
        page.items.some((item) => item.kind === 'known-label'));
      if (!hasKnownLabel) throw new Error('ocr-known-label-required');
      setReport(nextReport);
      setOcrPageCount(null);
      setStatus(`OCRが完了しました（${range.endPage - range.startPage + 1}ページ）`);
    } catch (ocrError) {
      if (version !== operationVersion.current || controller.signal.aborted) return;
      setReport(null);
      setOcrPageCount(null);
      setStatus('');
      setError(ocrError instanceof Error && ocrError.message === 'ocr-known-label-required'
        ? 'OCR結果に既知の見出しがありません。ページ範囲またはPDFを確認してください。'
        : '日本語OCRを完了できませんでした。ページ範囲またはPDFを確認してください。');
    } finally {
      releaseBytes(ocrBytes);
      if (retainedPdfBytes.current === ocrBytes) retainedPdfBytes.current = null;
      if (version === operationVersion.current) {
        activeInspection.current = null;
        setOcrRunning(false);
      }
    }
  }

  function handleCancelOcr() {
    operationVersion.current += 1;
    activeInspection.current?.abort();
    activeInspection.current = null;
    wipeRetainedBytes();
    setReport(null);
    setOcrPageCount(null);
    setOcrRunning(false);
    setOcrProgress({ completed: 0, total: 0 });
    setError('');
    setStatus('OCRをキャンセルしました。再開するにはPDFを選び直してください。');
  }

  const labels = report
    ? [...new Set(report.pages.flatMap((page) => page.items.flatMap((item) => item.labels ?? [])))]
    : [];
  const reportJson = report ? JSON.stringify(report, null, 2) : '';
  const reportHref = report
    ? `data:application/json;charset=utf-8,${encodeURIComponent(reportJson)}`
    : '';

  return (
    <>
      {accounts.length === 0 ? (
        <p><Link href="/imports/sbi">SBI口座を作成してから続ける</Link></p>
      ) : null}
      {recentSnapshots.length > 0 ? (
        <section aria-labelledby="recent-balance-snapshots">
          <h2 id="recent-balance-snapshots">最近保存した残高報告書</h2>
          <ul>
            {recentSnapshots.map((snapshot) => (
              <li key={snapshot.id}>
                {snapshot.statementDate}・{snapshot.positionCount}件
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="import-file-panel">
        <label htmlFor="sbi-balance-report-pdf">SBI取引残高報告書PDF</label>
        <input id="sbi-balance-report-pdf" type="file" accept=".pdf,application/pdf" onChange={handleFileChange} />
        <strong>PDFは外部へ送信されません</strong>
        <p>このブラウザー内で見出しと表の配置だけを確認し、氏名・口座番号・銘柄・金額はJSONへ残しません。</p>
        <p>処理中の一時的な値は参照を外し、ガベージコレクションの対象として解放します。</p>
      </div>
      {status ? <p className="import-live-status" role="status">{status}</p> : null}
      {error ? <div className="import-error" role="alert">{error}</div> : null}
      {ocrPageCount !== null ? (
        <section className="import-file-panel" aria-labelledby="sbi-ocr-title">
          <h2 id="sbi-ocr-title">端末内の日本語OCR</h2>
          <p>
            テキストを自動抽出できなかったため、指定ページを画像として端末内で読み取ります。
            PDFやOCR結果を外部へ送信せず、最大5ページだけ処理します。
          </p>
          <p>OCRには誤認識があります。JSONは既知の見出し・分類・粗い配置・件数だけを含み、取引値の証拠にはなりません。</p>
          <label htmlFor="sbi-ocr-start-page">開始ページ</label>
          <input
            id="sbi-ocr-start-page"
            type="number"
            min="1"
            max={ocrPageCount}
            step="1"
            value={startPage}
            disabled={ocrRunning}
            onChange={(event) => setStartPage(Number(event.currentTarget.value))}
          />
          <label htmlFor="sbi-ocr-end-page">終了ページ</label>
          <input
            id="sbi-ocr-end-page"
            type="number"
            min="1"
            max={ocrPageCount}
            step="1"
            value={endPage}
            disabled={ocrRunning}
            onChange={(event) => setEndPage(Number(event.currentTarget.value))}
          />
          <button type="button" disabled={ocrRunning} onClick={() => void handleStartOcr()}>
            日本語OCRを開始
          </button>
          <button type="button" onClick={handleCancelOcr}>OCRをキャンセル</button>
          {ocrProgress.total > 0 ? (
            <progress
              aria-label="日本語OCRの進捗"
              value={ocrProgress.completed}
              max={ocrProgress.total}
            />
          ) : null}
        </section>
      ) : null}
      {report ? (
        <>
        {accounts.length > 0 ? <BalanceReportPositionForm accounts={accounts} /> : null}
        <section className="safe-report-result" aria-labelledby="safe-report-title">
          <h2 id="safe-report-title">安全な構造レポート</h2>
          <p>検出できた既知の見出し</p>
          {labels.length > 0 ? (
            <ul>{labels.map((label) => <li key={label}>{label}</li>)}</ul>
          ) : (
            <p>既知の見出しを検出できませんでした。</p>
          )}
          <a
            className="safe-report-download"
            download="sbi-balance-report-safe-structure.json"
            href={reportHref}
          >
            診断用JSONを保存（任意）
          </a>
          <p className="preview-note">
            このJSONは帳票形式の診断用です。元PDFや取引値の代替ではなく、JSONだけを共有できます。
          </p>
        </section>
        </>
      ) : null}
    </>
  );
}
