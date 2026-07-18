import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import SbiBalanceReportClient from './client';

export const metadata: Metadata = {
  title: 'SBI取引残高報告書の確認',
  robots: { index: false, follow: false },
};

export default async function SbiBalanceReportPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-balance-report-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-balance-report-title">SBI取引残高報告書の確認</h1>
        <p>信用取引の開始・終了建玉を正確に復元するため、PDFの形式だけを端末内で確認します。</p>
        <SbiBalanceReportClient />
      </section>
    </main>
  );
}
