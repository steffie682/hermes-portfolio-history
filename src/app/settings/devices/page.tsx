import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import DeviceEnrollmentSource from './device-enrollment-source';

export const metadata: Metadata = {
  title: 'スマホを追加',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">ADD A DEVICE</p>
        <h1>スマホを追加</h1>
        <p>PCで本人確認して、同じアカウントをスマホでも使えるようにします。</p>
        <DeviceEnrollmentSource />
      </section>
    </main>
  );
}
