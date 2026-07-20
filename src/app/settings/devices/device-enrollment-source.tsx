'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';

type QrGrant = { value: string; expiresAt: number };

export default function DeviceEnrollmentSource() {
  const [qr, setQr] = useState<QrGrant | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!qr) return;
    const delay = Math.max(0, qr.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setQr(null);
      setMessage('QRコードの有効期限が切れました。もう一度作成してください。');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [qr]);

  async function createQr() {
    setBusy(true);
    setQr(null);
    setMessage('PCで本人確認しています…');
    try {
      const authOptionsResponse = await fetch('/api/auth/passkey/login/options', {
        method: 'POST',
      });
      if (!authOptionsResponse.ok) throw new Error();
      const { options: authOptions } = await authOptionsResponse.json();
      const authentication = await startAuthentication({ optionsJSON: authOptions });
      const authVerifyResponse = await fetch('/api/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: authentication }),
      });
      if (!authVerifyResponse.ok) throw new Error();

      const grantResponse = await fetch('/api/auth/passkey/device-enrollment/grant', {
        method: 'POST',
      });
      if (!grantResponse.ok) throw new Error();
      const grant = (await grantResponse.json()) as {
        grantToken: string;
        expiresAt: string;
      };
      const expiresAt = Date.parse(grant.expiresAt);
      if (!Number.isFinite(expiresAt)) throw new Error();
      setQr({
        value: `${window.location.origin}/add-device#${grant.grantToken}`,
        expiresAt,
      });
      setMessage('');
    } catch {
      setMessage('QRコードを作成できませんでした。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-enrollment-source">
      <button type="button" disabled={busy} onClick={() => void createQr()}>
        スマホを追加する
      </button>
      {qr ? (
        <div className="device-enrollment-qr">
          <QRCodeSVG value={qr.value} size={240} level="M" marginSize={4} />
          <p>5分以内にスマホで読み取ってください</p>
          <p className="auth-note">QRコードを見せる相手は、自分のスマホだけにしてください。</p>
          <button type="button" onClick={() => setQr(null)}>QRコードを閉じる</button>
        </div>
      ) : null}
      <p role="status">{message}</p>
    </div>
  );
}
