import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { resolveSessionPrincipal } from '@/auth/session';
import type { AppDatabase } from '@/db/client';
import { createBalanceReportSnapshotRepository } from '@/import/sbi/balance-report-snapshot-repository';
import { canonicalizeBalanceReportSnapshot } from '@/import/sbi/balance-report-snapshot';
import { applyAllMigrations } from './helpers/migrations';

const input = canonicalizeBalanceReportSnapshot({
  brokerAccountId: '00000000-0000-4000-8000-000000000001',
  statementDate: '2026-07-23',
  confirmedFromOriginal: true,
  confirmedNoPositions: false,
  positions: [{
    sourcePage: 3, side: 'sell', securityCode: 'Z9Y8', securityName: '合成銘柄',
    quantity: '7', unitPriceYen: '2500.25', openedOn: '2026-07-02', dueOn: null,
  }],
});

async function setup() {
  const client = new PGlite();
  await applyAllMigrations(client);
  await client.exec(`
    insert into "user" (id, name) values ('user-a', 'A'), ('user-b', 'B');
    insert into broker_accounts (id, owner_user_id, broker, display_name) values
      ('00000000-0000-4000-8000-000000000001', 'user-a', 'sbi', 'SBI A'),
      ('00000000-0000-4000-8000-000000000002', 'user-a', 'other', 'Other A'),
      ('00000000-0000-4000-8000-000000000003', 'user-b', 'sbi', 'SBI B');
  `);
  const principal = (await resolveSessionPrincipal('a', {
    findActiveUserByTokenHash: async () => 'user-a',
  }))!;
  return {
    client,
    repository: createBalanceReportSnapshotRepository(
      drizzle({ client }) as unknown as AppDatabase,
    ),
    principal,
  };
}

describe('balance report snapshot repository', () => {
  it('saves and exactly replays a zero-position checkpoint without inserting positions', async () => {
    const context = await setup();
    try {
      const zero = canonicalizeBalanceReportSnapshot({
        brokerAccountId: input.brokerAccountId,
        statementDate: '2026-07-22',
        confirmedFromOriginal: true,
        confirmedNoPositions: true,
        positions: [],
      });
      const first = await context.repository.save(context.principal, zero);
      const replay = await context.repository.save(context.principal, zero);
      expect(first).toMatchObject({ created: true, snapshot: { positionCount: 0 } });
      expect(replay).toMatchObject({ created: false, snapshot: first.snapshot });
      const counts = await context.client.query<{ snapshots: number; positions: number }>(
        `select
          (select count(*)::int from balance_report_snapshots) snapshots,
          (select count(*)::int from balance_report_positions) positions`,
      );
      expect(counts.rows[0]).toEqual({ snapshots: 1, positions: 0 });
    } finally {
      await context.client.close();
    }
  });

  it('saves once and returns an exact replay without duplicate positions', async () => {
    const context = await setup();
    try {
      const first = await context.repository.save(context.principal, input);
      const replay = await context.repository.save(context.principal, input);
      expect(first.created).toBe(true);
      expect(replay).toMatchObject({ created: false, snapshot: first.snapshot });
      const counts = await context.client.query<{ snapshots: number; positions: number }>(
        `select
          (select count(*)::int from balance_report_snapshots) snapshots,
          (select count(*)::int from balance_report_positions) positions`,
      );
      expect(counts.rows[0]).toEqual({ snapshots: 1, positions: 1 });
    } finally {
      await context.client.close();
    }
  });

  it.each([
    ['cross-owner', '00000000-0000-4000-8000-000000000003'],
    ['wrong broker', '00000000-0000-4000-8000-000000000002'],
    ['missing', '00000000-0000-4000-8000-000000000099'],
  ])('fails closed for a %s account', async (_case, brokerAccountId) => {
    const context = await setup();
    try {
      await expect(context.repository.save(context.principal, { ...input, brokerAccountId }))
        .rejects.toMatchObject({ code: 'invalid_account' });
    } finally {
      await context.client.close();
    }
  });

  it('lists only the principal snapshots without owner identifiers', async () => {
    const context = await setup();
    try {
      await context.repository.save(context.principal, input);
      const rows = await context.repository.listRecent(context.principal);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ positionCount: 1, statementDate: '2026-07-23' });
      expect(rows[0]).not.toHaveProperty('ownerUserId');
      expect(rows[0]).not.toHaveProperty('purpose');
    } finally {
      await context.client.close();
    }
  });
});
