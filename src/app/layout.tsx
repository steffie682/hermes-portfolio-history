import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '資産履歴管理',
  description: 'SBI証券の取込基盤と残高証拠を本人専用で管理',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
