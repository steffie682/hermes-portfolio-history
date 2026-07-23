import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import { getImportRuntime } from '@/import/runtime';
import { importReasonLabel } from '@/import/reason-label';
import { DistributionDetailsForm } from './distribution-details-form';

export const metadata = {
  title: 'SBI取込の原本追跡',
  robots: { index: false, follow: false },
};

function eventDescription(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '自動計上対象外';
  const value = payload as Record<string, unknown>;
  const instrument = value.instrument && typeof value.instrument === 'object'
    ? value.instrument as Record<string, unknown>
    : {};
  const side = value.side === 'buy' ? '買付' : value.side === 'sell' ? '売却' : '取引';
  const securityName = typeof instrument.securityName === 'string' ? instrument.securityName : '銘柄名なし';
  const quantity = typeof value.quantity === 'string'
    ? `数量 ${value.quantity}`
    : typeof value.quantityIncrease === 'string'
      ? `再投資数量 ${value.quantityIncrease}`
      : '';
  const contractDate = typeof value.contractDate === 'string' ? `約定日 ${value.contractDate}` : '';
  const quoted = value.sourceQuotedUnitPrice && typeof value.sourceQuotedUnitPrice === 'object'
    ? value.sourceQuotedUnitPrice as Record<string, unknown>
    : {};
  const nav = typeof quoted.value === 'string' ? `CSV単価 ${quoted.value}` : '';
  const operation = value.operation === 'reinvestment-units' ? '分配金再投資' : side;
  return [operation, securityName, quantity, nav, contractDate].filter(Boolean).join(' / ');
}

function isEligibleDistributionRow(row: {
  status: string;
  reasonCode: string | null;
  payload: unknown;
}) {
  if (row.status !== 'needs_review' || row.reasonCode !== 'needs-distribution-details'
    || !row.payload || typeof row.payload !== 'object') return false;
  const payload = row.payload as Record<string, unknown>;
  return payload.operation === 'reinvestment-units'
    && typeof payload.quantityIncrease === 'string'
    && payload.sourceQuotedUnitPrice !== null
    && typeof payload.sourceQuotedUnitPrice === 'object';
}

export default async function ImportTracePage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  const { batchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    notFound();
  }
  const { importRepository } = await getImportRuntime();
  const trace = await importRepository.getBatchTrace({ principal, batchId });
  if (!trace) notFound();

  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="trace-title">
        <p className="preview-badge">ログイン中の本人だけが閲覧できます</p>
        <h1 id="trace-title">取込内容と原本行の対応</h1>
        <p>表示した取引が、保存済みCSVの何行目から作られたかを確認できます。</p>
        <p>状態: {trace.status === 'committed' ? '確定済み' : '確定前'}</p>
        <ol>
          {trace.rows.map((row) => (
            <li key={row.locator} className="cash-readiness">
              <strong>CSV {row.sourceRow}行目</strong>
              <p>{eventDescription(row.payload)}</p>
              <p>判定: {row.status === 'new' ? '新規' : row.status === 'duplicate' ? '重複' : row.status === 'rejected' ? '拒否' : '要確認'}</p>
              {importReasonLabel(row.reasonCode) ? <p>理由: {importReasonLabel(row.reasonCode)}</p> : null}
              {trace.status === 'preview_ready' && isEligibleDistributionRow(row) ? (
                <>
                  <p>PDFはアップロードされません。通知書から入力した値だけが本人専用の取込情報として保存されます。</p>
                  <p>総分配金と源泉徴収額は未解決のままです。税率や税額は推定しません。</p>
                  <DistributionDetailsForm
                    batchId={trace.batchId}
                    sourceRowNumber={row.sourceRow!}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ol>
        <p><Link href="/imports/sbi">SBI CSV取込へ戻る</Link></p>
      </section>
    </main>
  );
}
