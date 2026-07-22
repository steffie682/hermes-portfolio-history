import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import SbiDistributionReportClient from './client';

export const metadata: Metadata = {
  title: 'SBI分配金・再投資PDFの構造確認',
  robots: { index: false, follow: false },
};

export default async function SbiDistributionReportPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-distribution-report-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-distribution-report-title">SBI分配金・再投資PDFの構造確認</h1>
        <p>実際の金額や日付は解釈・保存せず、PDFの安全な構造だけを端末内で確認します。</p>
        <SbiDistributionReportClient />
      </section>
    </main>
  );
}
