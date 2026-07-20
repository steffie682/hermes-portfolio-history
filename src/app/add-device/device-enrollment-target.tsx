'use client';

import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { startRegistration } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function DeviceEnrollmentTarget() {
  const router = useRouter();
  const initialized = useRef(false);
  const [options, setOptions] = useState<PublicKeyCredentialCreationOptionsJSON | null>(null);
  const [message, setMessage] = useState('QRコードを確認しています…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const preparation = window.__portfolioDeviceEnrollmentPreparation;
    delete window.__portfolioDeviceEnrollmentPreparation;

    async function prepare() {
      if (!preparation) {
        setMessage('QRコードが無効です。PCでもう一度作成してください。');
        return;
      }
      const result = await preparation;
      if ('error' in result) {
        setMessage('QRコードが期限切れか、すでに使用されています。');
        return;
      }
      setOptions(result.options);
      setMessage('このスマホの顔認証・指紋・PINを登録します。');
    }
    void prepare();
  }, []);

  async function enroll() {
    if (!options) return;
    setBusy(true);
    setMessage('スマホで本人確認しています…');
    try {
      const registration = await startRegistration({ optionsJSON: options });
      setOptions(null);
      const response = await fetch('/api/auth/passkey/device-enrollment/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: registration }),
      });
      if (!response.ok) throw new Error();
      router.push('/imports/sbi');
      router.refresh();
    } catch {
      setMessage('スマホを追加できませんでした。PCでQRコードを作り直してください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-enrollment-target">
      {options ? (
        <button type="button" disabled={busy} onClick={() => void enroll()}>
          このスマホを追加する
        </button>
      ) : null}
      <p role="status">{message}</p>
    </div>
  );
}
