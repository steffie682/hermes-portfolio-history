'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  async function register() {
    setMessage('新しいアカウントを作成しています…');
    const optionsResponse = await fetch('/api/auth/passkey/register/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!optionsResponse.ok) throw new Error('登録を開始できませんでした');
    const { options } = await optionsResponse.json();
    const credential = await startRegistration({ optionsJSON: options });
    const verifyResponse = await fetch('/api/auth/passkey/register/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: credential }),
    });
    if (!verifyResponse.ok) throw new Error('利用登録できませんでした');
    router.push('/');
    router.refresh();
  }

  async function signIn() {
    setMessage('端末で本人確認しています…');
    const optionsResponse = await fetch('/api/auth/passkey/login/options', {
      method: 'POST',
    });
    if (!optionsResponse.ok) throw new Error('ログインを開始できませんでした');
    const { options } = await optionsResponse.json();
    const credential = await startAuthentication({ optionsJSON: options });
    const verifyResponse = await fetch('/api/auth/passkey/login/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: credential }),
    });
    if (!verifyResponse.ok) throw new Error('ログインできませんでした');
    router.push('/imports/sbi');
    router.refresh();
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作に失敗しました');
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">PASSWORDLESS</p>
        <h1>資産履歴管理</h1>
        <p>端末の顔認証・指紋認証・PINを使って安全にログインします。</p>
        <button type="button" onClick={() => void run(signIn)}>
          顔認証・指紋・PINでログイン
        </button>
        <div className="divider">新しく使い始める場合</div>
        <label htmlFor="display-name">表示名</label>
        <input
          id="display-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          autoComplete="nickname"
        />
        <button type="button" disabled={!name.trim()} onClick={() => void run(register)}>
          新しいアカウントを作る
        </button>
        <p className="auth-note">
          別の端末で同じアカウントを使う場合は、ログイン済みの端末からスマホを追加してください。
        </p>
        <p className="auth-note">
          この仕組みにはPasskeyを使用します。パスワードを覚える必要はありません。
        </p>
        <p role="status">{message}</p>
      </section>
    </main>
  );
}
