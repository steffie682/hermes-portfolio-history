import type { Metadata } from 'next';
import { deviceEnrollmentBootstrapScript } from './device-enrollment-bootstrap';
import DeviceEnrollmentTarget from './device-enrollment-target';

export const metadata: Metadata = {
  title: 'このスマホを追加',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default function AddDevicePage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">ADD THIS DEVICE</p>
        <h1>このスマホを追加</h1>
        <script
          data-device-enrollment-bootstrap
          dangerouslySetInnerHTML={{ __html: deviceEnrollmentBootstrapScript }}
        />
        <DeviceEnrollmentTarget />
      </section>
    </main>
  );
}
