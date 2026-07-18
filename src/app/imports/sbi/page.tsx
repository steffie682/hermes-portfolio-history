import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import SbiImportClient from './import-client';

export const metadata: Metadata = {
  title: 'SBI CSV取込',
  robots: { index: false, follow: false },
};

export default async function SbiImportPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');

  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-import-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-import-title">SBI CSV取込</h1>
        <p>この画面内でCSVを確認します</p>
        <SbiImportClient />
      </section>
    </main>
  );
}
