'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { buildSbiIncomeStructureSafeReport } from '@/import/sbi/balance-report-safe-report';
import { extractPdfStructure, type PdfDocumentLoader } from '@/import/sbi/pdf-structure-extractor';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
type SafeReport = ReturnType<typeof buildSbiIncomeStructureSafeReport>;

async function inspectPdfInBrowser(source: Uint8Array, signal: AbortSignal): Promise<SafeReport> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const pages = await extractPdfStructure(source, pdfjs.getDocument as unknown as PdfDocumentLoader, signal);
  return buildSbiIncomeStructureSafeReport(pages);
}

function hasPdfMagic(source: Uint8Array): boolean {
  return source.length >= 5
    && source[0] === 0x25
    && source[1] === 0x50
    && source[2] === 0x44
    && source[3] === 0x46
    && source[4] === 0x2d;
}

export default function SbiDistributionReportClient({
  inspectPdf = inspectPdfInBrowser,
}: {
  inspectPdf?: (source: Uint8Array, signal: AbortSignal) => Promise<SafeReport>;
}) {
  const operationVersion = useRef(0);
  const activeInspection = useRef<AbortController | null>(null);
  const [report, setReport] = useState<SafeReport | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => {
    operationVersion.current += 1;
    activeInspection.current?.abort();
    activeInspection.current = null;
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    activeInspection.current?.abort();
    activeInspection.current = null;
    const version = ++operationVersion.current;
    const file = event.currentTarget.files?.[0];
    setReport(null);
    setStatus('');
    setError('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('PDFは20 MB以下のファイルを選んでください。');
      return;
    }
    setStatus('PDFを端末内で確認しています…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (version !== operationVersion.current) return;
      if (!hasPdfMagic(bytes)) throw new Error('not-pdf');
      const controller = new AbortController();
      activeInspection.current = controller;
      const nextReport = await inspectPdf(bytes, controller.signal);
      if (version !== operationVersion.current) return;
      setReport(nextReport);
      setStatus(`PDF ${nextReport.pageCount}ページ`);
    } catch {
      if (version !== operationVersion.current) return;
      setReport(null);
      setStatus('');
      setError('PDFを確認できませんでした。SBIの分配金・再投資PDFを選び直してください。');
    } finally {
      if (version === operationVersion.current) activeInspection.current = null;
    }
  }

  const labels = report
    ? [...new Set(report.pages.flatMap((page) => page.items.flatMap((item) => item.labels ?? [])))]
    : [];
  const acceptedItemCount = report
    ? report.pages.reduce((total, page) => total + page.items.length, 0)
    : 0;
  const reportHref = report
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`
    : '';

  return (
    <>
      <div className="import-file-panel">
        <p>
          取引履歴CSVで「分配金再投資」と表示されている取引に対応するSBIのPDFを1つだけ選んでください。
          最初の形式確認では、その中で最新のものを選んでください。
        </p>
        <label htmlFor="sbi-distribution-report-pdf">SBI分配金・再投資PDF</label>
        <input id="sbi-distribution-report-pdf" type="file" accept=".pdf,application/pdf" onChange={handleFileChange} />
        <strong>PDFは送信されません</strong>
        <p>このブラウザ内で、許可された会計ラベルと配置、文字種別だけを安全なJSONにします。</p>
      </div>
      {status ? <p className="import-live-status" role="status">{status}</p> : null}
      {error ? <div className="import-error" role="alert">{error}</div> : null}
      {report ? (
        <section className="safe-report-result" aria-labelledby="distribution-safe-report-title">
          <h2 id="distribution-safe-report-title">安全な構造レポート</h2>
          <p>検出できた許可済みの会計ラベル</p>
          {labels.length > 0 ? (
            <ul>{labels.map((label) => <li key={label}>{label}</li>)}</ul>
          ) : (
            <p>許可済みの会計ラベルを検出できませんでした。</p>
          )}
          {acceptedItemCount === 0 ? (
            <p>
              PDFからテキスト項目を抽出できませんでした。
              保存される安全なJSONに追加される診断情報は、非機密のカウントのみです。
            </p>
          ) : null}
          <a className="safe-report-download" download="sbi-distribution-safe-structure.json" href={reportHref}>
            安全な構造レポートを保存
          </a>
          <p className="preview-note">
            この結果で確認できるのはPDFのレイアウトだけです。分配金額、税金、取得価額、再投資の会計処理、
            保留中のインポート状態はまだ解決しません。
          </p>
          <p className="preview-note">保存した安全なJSONだけを共有した後、実装を続けられます。</p>
        </section>
      ) : null}
    </>
  );
}
