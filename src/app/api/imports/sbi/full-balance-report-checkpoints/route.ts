import type { NextRequest } from 'next/server';
import { getAuthRuntime } from '@/auth/runtime';
import { getDatabase } from '@/db/client';
import { createFullBalanceReportCheckpointHandlers } from '@/import/sbi/full-balance-report-checkpoint-http';
import { createFullBalanceReportCheckpointRepository } from '@/import/sbi/full-balance-report-checkpoint-repository';

export async function POST(request: NextRequest) {
  try {
    const runtime = await getAuthRuntime();
    return createFullBalanceReportCheckpointHandlers({
      expectedOrigin: runtime.config.origin,
      sessionStore: runtime.repository.sessionStore,
      repository: createFullBalanceReportCheckpointRepository(getDatabase()),
    }).POST(request);
  } catch {
    return Response.json({ error: { code: 'checkpoint_unavailable' } }, {
      status: 503, headers: { 'Cache-Control': 'no-store, private' },
    });
  }
}
