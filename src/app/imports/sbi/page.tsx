import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import { getAuthRuntime } from '@/auth/runtime';
import SbiImportClient from './import-client';

export const metadata: Metadata = {
  title: 'SBI CSV取込',
  robots: { index: false, follow: false },
};

export default async function SbiImportPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  const { repository } = await getAuthRuntime();
  const accounts = (await repository.listBrokerAccounts(principal))
    .filter((account) => account.broker === 'sbi');

  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-import-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-import-title">SBI CSV取込</h1>
        <p>この画面内でCSVを確認します</p>
        <p><Link href="/settings/devices">スマホでも同じアカウントを使う</Link></p>
        <SbiImportClient initialAccounts={accounts} />
      </section>
    </main>
  );
}
