'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { buildSbiBalanceReportSafeReport } from '@/import/sbi/balance-report-safe-report';
import { extractPdfStructure, type PdfDocumentLoader } from '@/import/sbi/pdf-structure-extractor';

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

export default function SbiBalanceReportClient({
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
      setError('PDFを確認できませんでした。SBIの取引残高報告書PDFを選び直してください。');
    } finally {
      if (version === operationVersion.current) activeInspection.current = null;
    }
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
      <div className="import-file-panel">
        <label htmlFor="sbi-balance-report-pdf">SBI取引残高報告書PDF</label>
        <input id="sbi-balance-report-pdf" type="file" accept=".pdf,application/pdf" onChange={handleFileChange} />
        <strong>PDFは外部へ送信されません</strong>
        <p>このbrowser内で見出しと表の配置だけを確認し、氏名・口座番号・銘柄・金額はレポートへ残しません。</p>
      </div>
      {status ? <p className="import-live-status" role="status">{status}</p> : null}
      {error ? <div className="import-error" role="alert">{error}</div> : null}
      {report ? (
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
            安全な構造レポートを保存
          </a>
          <p className="preview-note">元PDFではなく、保存したJSONだけを共有できます。</p>
        </section>
      ) : null}
    </>
  );
}
