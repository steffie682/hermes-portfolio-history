import type { NextRequest } from 'next/server';
import { getAuthRuntime } from '@/auth/runtime';
import { getDatabase } from '@/db/client';
import { createBalanceReportSnapshotHandlers } from '@/import/sbi/balance-report-snapshot-http';
import { createBalanceReportSnapshotRepository } from '@/import/sbi/balance-report-snapshot-repository';

export async function POST(request: NextRequest) {
  try {
    const runtime = await getAuthRuntime();
    return createBalanceReportSnapshotHandlers({
      expectedOrigin: runtime.config.origin,
      sessionStore: runtime.repository.sessionStore,
      repository: createBalanceReportSnapshotRepository(getDatabase()),
    }).POST(request);
  } catch {
    return Response.json(
      { error: { code: 'snapshot_unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
