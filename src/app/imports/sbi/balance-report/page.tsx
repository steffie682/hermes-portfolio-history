import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolvePageSessionPrincipal } from '@/auth/page-session';
import { getDatabase } from '@/db/client';
import { getImportRuntime } from '@/import/runtime';
import { createBalanceReportSnapshotRepository } from '@/import/sbi/balance-report-snapshot-repository';
import { createFullBalanceReportCheckpointRepository } from '@/import/sbi/full-balance-report-checkpoint-repository';
import SbiBalanceReportClient from './client';

export const metadata: Metadata = {
  title: 'SBI取引残高報告書の確認',
  robots: { index: false, follow: false },
};

const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SbiBalanceReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ batchId?: string }>;
} = {}) {
  const principal = await resolvePageSessionPrincipal();
  if (!principal) return redirect('/login');
  const batchId = (await searchParams)?.batchId;
  const runtime = await getImportRuntime();
  const batch = batchId && BATCH_ID.test(batchId)
    ? await runtime.importRepository.getBatchTrace({ principal, batchId })
    : null;
  const returnHref = batch ? `/imports/sbi/${batch.batchId}` : '/imports/sbi';
  const db = getDatabase();
  const v1Repository = createBalanceReportSnapshotRepository(db);
  const v2Repository = createFullBalanceReportCheckpointRepository(db);
  const [allAccounts, v1Snapshots, v2Snapshots] = await Promise.all([
    runtime.repository.listBrokerAccounts(principal),
    v1Repository.listRecentForMerge(principal),
    v2Repository.listRecentForMerge(principal),
  ]);
  const snapshots = [...v1Snapshots, ...v2Snapshots]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10)
    .map((snapshot) => 'positionCount' in snapshot
      ? {
          id: snapshot.id,
          statementDate: snapshot.statementDate,
          positionCount: snapshot.positionCount,
        }
      : {
          id: snapshot.id,
          statementDate: snapshot.statementDate,
          rowCount: snapshot.rowCount,
        });
  const accounts = allAccounts
    .filter((account) => account.broker === 'sbi')
    .map(({ id, displayName }) => ({ id, displayName }))
    .sort((left, right) => {
      if (left.id === batch?.brokerAccountId) return -1;
      if (right.id === batch?.brokerAccountId) return 1;
      return 0;
    });
  return (
    <main className="import-shell">
      <section className="import-card" aria-labelledby="sbi-balance-report-title">
        <p className="preview-badge">ログイン済みの利用者向け</p>
        <h1 id="sbi-balance-report-title">SBI取引残高報告書の確認</h1>
        <p>
          PDFの形式を端末内で確認した後、元の報告書を見ながら各残高欄を本人確認して保存します。
        </p>
        <SbiBalanceReportClient
          accounts={accounts}
          recentSnapshots={snapshots}
          returnHref={returnHref}
        />
      </section>
    </main>
  );
}
