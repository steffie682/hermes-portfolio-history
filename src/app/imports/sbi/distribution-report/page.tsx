import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import { getImportRuntime } from '@/import/runtime';
import SbiDistributionReportClient from './client';

export const metadata: Metadata = {
  title: 'SBI分配金・再投資PDFの構造確認',
  robots: { index: false, follow: false },
};

const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SbiDistributionReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ batchId?: string }>;
} = {}) {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  const batchId = (await searchParams)?.batchId;
  const batch = batchId && BATCH_ID.test(batchId)
    ? await (await getImportRuntime()).importRepository.getBatchTrace({ principal, batchId })
    : null;
  const returnHref = batch ? `/imports/sbi/${batch.batchId}` : '/imports/sbi';
  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-distribution-report-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-distribution-report-title">SBI分配金・再投資PDFの構造確認</h1>
        <p>実際の金額や日付は解釈・保存せず、PDFの安全な構造だけを端末内で確認します。</p>
        <SbiDistributionReportClient returnHref={returnHref} />
      </section>
    </main>
  );
}
