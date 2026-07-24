import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { verifyRuntimeRole } from '@/db/security';
import { createAuthRepository } from '@/auth/repository';
import { resolveSessionPrincipal } from '@/auth/session';
import { hashSessionToken } from '@/auth/session-token';
import type { AppDatabase } from '@/db/client';
import { createImportRepository } from '@/import/repository';
import { createBalanceReportSnapshotRepository } from '@/import/sbi/balance-report-snapshot-repository';
import { canonicalizeBalanceReportSnapshot } from '@/import/sbi/balance-report-snapshot';
import { createMemoryPrivateSourceStorage } from '@/import/storage/memory-private-source-storage';
import { migrationDirectories } from './helpers/migrations';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const postgresDescribe = adminUrl ? describe : describe.skip;

postgresDescribe('real PostgreSQL tenant security', () => {
  it('applies migrations and enforces RLS for the least-privilege runtime role', async () => {
    const adminTarget = new URL(adminUrl!);
    if (adminTarget.pathname !== '/portfolio_history_test') {
      throw new Error('Real PostgreSQL integration requires portfolio_history_test');
    }
    const admin = postgres(adminTarget.toString(), { max: 1 });
    const revoker = postgres(adminTarget.toString(), { max: 1 });
    const appUrl = new URL(adminTarget);
    appUrl.username = 'portfolio_app';
    appUrl.password = 'test-only-password';
    const app = postgres(appUrl.toString(), { max: 4 });
    const appSecond = postgres(appUrl.toString(), { max: 1 });
    try {
      for (const statement of [
        `CREATE ROLE portfolio_app LOGIN PASSWORD 'test-only-password' NOSUPERUSER NOBYPASSRLS`,
        'GRANT CONNECT ON DATABASE portfolio_history_test TO portfolio_app',
        'GRANT USAGE ON SCHEMA public TO portfolio_app',
      ]) {
        await admin.unsafe(statement);
      }
      for (const directory of await migrationDirectories()) {
        const migration = await readFile(
          resolve(process.cwd(), 'drizzle', directory, 'migration.sql'),
          'utf8',
        );
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await admin.unsafe(statement);
        }
      }
      for (const statement of [
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "user", auth_sessions, passkey_credentials, auth_challenges TO portfolio_app',
        'GRANT SELECT, INSERT, DELETE ON device_enrollment_grants TO portfolio_app',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON broker_accounts TO portfolio_app',
        `INSERT INTO "user" (id, name)
          VALUES ('user-a', 'User A'), ('user-b', 'User B'),
                 ('user-device', 'Device User')`,
        `INSERT INTO broker_accounts (owner_user_id, broker, display_name)
          VALUES ('user-a', 'sbi', 'A account'), ('user-b', 'sbi', 'B account')`,
      ]) {
        await admin.unsafe(statement);
      }

      const importAcl = await admin<{
        table_name: string;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }[]>`
        select table_name,
               has_table_privilege('portfolio_app', format('%I.%I', table_schema, table_name), 'SELECT') as can_select,
               has_table_privilege('portfolio_app', format('%I.%I', table_schema, table_name), 'INSERT') as can_insert,
               has_table_privilege('portfolio_app', format('%I.%I', table_schema, table_name), 'UPDATE') as can_update,
               has_table_privilege('portfolio_app', format('%I.%I', table_schema, table_name), 'DELETE') as can_delete
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('private_source_objects', 'source_documents', 'import_batches', 'source_records', 'staged_events', 'ledger_events')
        order by table_name
      `;
      expect(importAcl).toHaveLength(6);
      expect(importAcl.every((entry) => entry.can_select && entry.can_insert)).toBe(true);
      expect(importAcl.find((entry) => entry.table_name === 'ledger_events')).toMatchObject({
        can_update: false,
        can_delete: false,
      });
      expect(importAcl.filter((entry) => entry.table_name !== 'ledger_events').every(
        (entry) => entry.can_update && entry.can_delete,
      )).toBe(true);

      const sourceToken = 'postgres-device-source';
      const sourceHash = hashSessionToken(sourceToken);
      await admin`
        insert into auth_sessions
          (user_id, token_hash, expires_at, auth_method, authenticated_at)
        values
          ('user-device', ${sourceHash}, CURRENT_TIMESTAMP + interval '30 minutes',
           'passkey_authentication', CURRENT_TIMESTAMP)
      `;

      await expect(
        admin`
          insert into device_enrollment_grants
            (token_hash, user_id, source_session_id, purpose, challenge, expires_at)
          select 'postgres-overlong-grant', 'user-device', id, 'add_device',
                 'postgres-overlong-challenge', CURRENT_TIMESTAMP + interval '6 minutes'
          from auth_sessions where token_hash = ${sourceHash}
        `,
      ).rejects.toMatchObject({ code: '23514' });

      const appDb = drizzle({ client: app }) as AppDatabase;
      const repository = createAuthRepository(appDb);
      const principal = await resolveSessionPrincipal(sourceToken, repository.sessionStore);
      expect(principal).not.toBeNull();
      await admin`
        update auth_sessions
        set authenticated_at = CURRENT_TIMESTAMP + interval '1 hour'
        where token_hash = ${sourceHash}
      `;
      await expect(
        repository.saveDeviceEnrollmentGrant(
          principal!,
          sourceHash,
          {
            tokenHash: 'postgres-future-auth-grant',
            challenge: 'postgres-future-auth-challenge',
          },
          new Date(),
        ),
      ).rejects.toThrow('Recent user verification is required');
      await admin`
        update auth_sessions
        set authenticated_at = CURRENT_TIMESTAMP
        where token_hash = ${sourceHash}
      `;

      const secondSourceToken = 'postgres-device-source-second';
      const secondSourceHash = hashSessionToken(secondSourceToken);
      await admin`
        insert into auth_sessions
          (user_id, token_hash, expires_at, auth_method, authenticated_at)
        values
          ('user-device', ${secondSourceHash}, CURRENT_TIMESTAMP + interval '30 minutes',
           'passkey_authentication', CURRENT_TIMESTAMP)
      `;
      const secondPrincipal = await resolveSessionPrincipal(
        secondSourceToken,
        repository.sessionStore,
      );
      expect(secondPrincipal).not.toBeNull();
      await admin.unsafe(`
        create function test_delay_device_grant_insert() returns trigger
        language plpgsql as $$
        begin
          perform pg_sleep(0.2);
          return NEW;
        end
        $$;
        create trigger test_delay_device_grant_insert
        before insert on device_enrollment_grants
        for each row execute function test_delay_device_grant_insert();
      `);
      await Promise.all([
        repository.saveDeviceEnrollmentGrant(
          principal!,
          sourceHash,
          { tokenHash: 'postgres-concurrent-grant-a', challenge: 'postgres-concurrent-a' },
          new Date(),
        ),
        repository.saveDeviceEnrollmentGrant(
          secondPrincipal!,
          secondSourceHash,
          { tokenHash: 'postgres-concurrent-grant-b', challenge: 'postgres-concurrent-b' },
          new Date(),
        ),
      ]);
      await admin.unsafe(`
        drop trigger test_delay_device_grant_insert on device_enrollment_grants;
        drop function test_delay_device_grant_insert();
      `);
      const [concurrentGrantCount] = await admin<{ count: number }[]>`
        select count(*)::int as count
        from device_enrollment_grants
        where user_id = 'user-device' and expires_at > CURRENT_TIMESTAMP
      `;
      expect(concurrentGrantCount.count).toBe(1);
      await admin`delete from device_enrollment_grants where user_id = 'user-device'`;

      await repository.saveDeviceEnrollmentGrant(
        principal!,
        sourceHash,
        {
          tokenHash: 'postgres-revocation-race-grant',
          challenge: 'postgres-revocation-race-challenge',
        },
        new Date(),
      );
      let releaseRevocation!: () => void;
      let markRevocationStarted!: () => void;
      const revocationRelease = new Promise<void>((resolveRelease) => {
        releaseRevocation = resolveRelease;
      });
      const revocationStarted = new Promise<void>((resolveStarted) => {
        markRevocationStarted = resolveStarted;
      });
      const revocation = revoker.begin(async (tx) => {
        await tx`
          update auth_sessions
          set expires_at = CURRENT_TIMESTAMP - interval '1 minute'
          where token_hash = ${sourceHash}
        `;
        markRevocationStarted();
        await revocationRelease;
      });
      await revocationStarted;
      const enrollmentDuringRevocation = repository.persistDeviceEnrollment({
        tokenHash: 'postgres-revocation-race-grant',
        userId: 'user-device',
        challenge: 'postgres-revocation-race-challenge',
        credential: {
          id: 'postgres-revocation-race-credential',
          userId: 'user-device',
          publicKey: Buffer.from([8]),
          counter: 0,
          deviceType: 'multiDevice',
          backedUp: true,
        },
        session: {
          userId: 'user-device',
          tokenHash: hashSessionToken('postgres-revocation-race-target'),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          authMethod: 'passkey_device_enrollment',
          authenticatedAt: new Date(),
        },
        now: new Date(),
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      releaseRevocation();
      await revocation;
      await expect(enrollmentDuringRevocation).rejects.toThrow('already consumed');
      await expect(
        repository.loadCredential('postgres-revocation-race-credential'),
      ).resolves.toBeNull();
      await admin`
        update auth_sessions
        set expires_at = CURRENT_TIMESTAMP + interval '30 minutes'
        where token_hash = ${sourceHash}
      `;
      await admin`delete from device_enrollment_grants where user_id = 'user-device'`;

      const sourceExpiredGrantExpiresAt = await repository.saveDeviceEnrollmentGrant(
        principal!,
        sourceHash,
        {
          tokenHash: 'postgres-source-expired-grant',
          challenge: 'postgres-source-expired-challenge',
        },
        new Date(),
      );
      const [storedSourceExpiredGrant] = await admin<{
        expires_at: Date;
        lifetime_seconds: number;
      }[]>`
        select expires_at,
               extract(epoch from (expires_at - created_at))::int as lifetime_seconds
        from device_enrollment_grants
        where token_hash = 'postgres-source-expired-grant'
      `;
      expect(sourceExpiredGrantExpiresAt).toEqual(storedSourceExpiredGrant.expires_at);
      expect(storedSourceExpiredGrant.lifetime_seconds).toBe(300);
      await admin`
        update auth_sessions
        set expires_at = CURRENT_TIMESTAMP - interval '1 minute'
        where token_hash = ${sourceHash}
      `;
      await expect(
        repository.loadDeviceEnrollmentGrant('postgres-source-expired-grant', new Date()),
      ).resolves.toBeNull();
      await expect(
        repository.persistDeviceEnrollment({
          tokenHash: 'postgres-source-expired-grant',
          userId: 'user-device',
          challenge: 'postgres-source-expired-challenge',
          credential: {
            id: 'postgres-source-expired-credential',
            userId: 'user-device',
            publicKey: Buffer.from([9]),
            counter: 0,
            deviceType: 'multiDevice',
            backedUp: true,
          },
          session: {
            userId: 'user-device',
            tokenHash: hashSessionToken('postgres-source-expired-target-session'),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            authMethod: 'passkey_device_enrollment',
            authenticatedAt: new Date(),
          },
          now: new Date(),
        }),
      ).rejects.toThrow('already consumed');
      await admin`
        update auth_sessions
        set expires_at = CURRENT_TIMESTAMP + interval '30 minutes'
        where token_hash = ${sourceHash}
      `;

      await repository.saveDeviceEnrollmentGrant(
        principal!,
        sourceHash,
        {
          tokenHash: 'postgres-race-grant',
          challenge: 'postgres-race-challenge',
        },
        new Date(),
      );
      const attempts = await Promise.allSettled(
        ['a', 'b'].map((suffix) =>
          repository.persistDeviceEnrollment({
            tokenHash: 'postgres-race-grant',
            userId: 'user-device',
            challenge: 'postgres-race-challenge',
            credential: {
              id: `postgres-device-credential-${suffix}`,
              userId: 'user-device',
              publicKey: Buffer.from([1, suffix === 'a' ? 2 : 3]),
              counter: 0,
              deviceType: 'multiDevice',
              backedUp: true,
            },
            session: {
              userId: 'user-device',
              tokenHash: hashSessionToken(`postgres-device-session-${suffix}`),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              authMethod: 'passkey_device_enrollment',
              authenticatedAt: new Date(),
            },
            now: new Date(),
          }),
        ),
      );
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
      const [deviceCounts] = await admin<{
        users: number;
        credentials: number;
        target_sessions: number;
        grants: number;
      }[]>`
        select
          (select count(*)::int from "user" where id = 'user-device') as users,
          (select count(*)::int from passkey_credentials where user_id = 'user-device') as credentials,
          (select count(*)::int from auth_sessions
             where user_id = 'user-device' and auth_method = 'passkey_device_enrollment') as target_sessions,
          (select count(*)::int from device_enrollment_grants
             where user_id = 'user-device') as grants
      `;
      expect(deviceCounts).toEqual({ users: 1, credentials: 1, target_sessions: 1, grants: 0 });

      await verifyRuntimeRole(appDb);
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        const rows = await tx<{ owner_user_id: string }[]>`
          select owner_user_id from broker_accounts
        `;
        expect(rows).toEqual([{ owner_user_id: 'user-a' }]);
      });
      await expect(
        app.begin(async (tx) => {
          await tx`select set_config('app.current_user_id', 'user-a', true)`;
          await tx`
            insert into broker_accounts (owner_user_id, broker, display_name)
            values ('user-b', 'sbi', 'spoofed')
          `;
        }),
      ).rejects.toMatchObject({ code: '42501' });

      const [userAAccount] = await admin<{ id: string }[]>`
        select id from broker_accounts where owner_user_id = 'user-a'
      `;
      const [userBAccountForSnapshot] = await admin<{ id: string }[]>`
        select id from broker_accounts where owner_user_id = 'user-b'
      `;
      const userAPrincipal = await resolveSessionPrincipal('import-user-a', {
        findActiveUserByTokenHash: async () => 'user-a',
      });
      const balanceCatalogs = await admin<{
        relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean;
      }[]>`
        select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relname in ('balance_report_snapshots', 'balance_report_positions')
        order by relname
      `;
      expect(balanceCatalogs).toHaveLength(2);
      expect(balanceCatalogs.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      const balanceAcl = await admin<Record<string, boolean>[]>`
        select
          has_table_privilege('portfolio_app', c.oid, 'SELECT') as select,
          has_table_privilege('portfolio_app', c.oid, 'INSERT') as insert,
          has_table_privilege('portfolio_app', c.oid, 'UPDATE') as update,
          has_table_privilege('portfolio_app', c.oid, 'DELETE') as delete,
          has_table_privilege('portfolio_app', c.oid, 'TRUNCATE') as truncate,
          has_table_privilege('portfolio_app', c.oid, 'REFERENCES') as references,
          has_table_privilege('portfolio_app', c.oid, 'TRIGGER') as trigger
        from pg_class c
        where c.relname in ('balance_report_snapshots', 'balance_report_positions')
        order by c.relname
      `;
      expect(balanceAcl).toHaveLength(2);
      expect(balanceAcl.every((row) => row.select && row.insert
        && !row.update && !row.delete && !row.truncate && !row.references && !row.trigger)).toBe(true);

      const canonicalSnapshot = canonicalizeBalanceReportSnapshot({
        brokerAccountId: userAAccount.id,
        statementDate: '2026-07-23',
        confirmedCompleteFromOriginal: true,
        confirmedNoPositions: false,
        positions: [
          {
            sourcePage: 2, sourceRow: 1, side: 'buy', securityCode: 'A1B2',
            securityName: '合成建玉', quantity: '2', unitPriceYen: '100',
            openedOn: '2026-07-01', dueOn: null,
          },
          {
            sourcePage: 2, sourceRow: 2, side: 'buy', securityCode: 'A1B2',
            securityName: '合成建玉', quantity: '2', unitPriceYen: '100',
            openedOn: '2026-07-01', dueOn: null,
          },
        ],
      });
      const balanceRepositoryA = createBalanceReportSnapshotRepository(appDb);
      const balanceRepositoryB = createBalanceReportSnapshotRepository(
        drizzle({ client: appSecond }) as AppDatabase,
      );
      const concurrentSnapshots = await Promise.all([
        balanceRepositoryA.save(userAPrincipal!, canonicalSnapshot),
        balanceRepositoryB.save(userAPrincipal!, canonicalSnapshot),
      ]);
      expect(concurrentSnapshots.map((result) => result.created).sort()).toEqual([false, true]);
      expect(new Set(concurrentSnapshots.map((result) => result.snapshot.id)).size).toBe(1);
      const [balanceCounts] = await admin<{ parents: number; children: number }[]>`
        select
          (select count(*)::int from balance_report_snapshots where owner_user_id = 'user-a') parents,
          (select count(*)::int from balance_report_positions where owner_user_id = 'user-a') children
      `;
      expect(balanceCounts).toEqual({ parents: 1, children: 2 });
      const snapshotId = concurrentSnapshots[0].snapshot.id;

      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        await tx`
          insert into balance_report_snapshots
            (owner_user_id, broker_account_id, statement_date, fingerprint, status, position_count)
          values ('user-b', ${userBAccountForSnapshot.id}, '2026-07-23', ${'f'.repeat(64)}, 'confirmed', 0)
        `;
      })).rejects.toMatchObject({ code: '42501' });
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-b', true)`;
        const rows = await tx`select id from balance_report_snapshots where id = ${snapshotId}`;
        expect(rows).toEqual([]);
      });
      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-b', true)`;
        await tx`
          insert into balance_report_positions
            (owner_user_id, broker_account_id, snapshot_id, position_index, source_page,
             source_row, side, security_code, security_name, quantity, unit_price_yen, opened_on)
          values ('user-b', ${userBAccountForSnapshot.id}, ${snapshotId}, 3, 2, 3,
                  'buy', 'C3D4', '合成混在', '1', 1, '2026-07-01')
        `;
      })).rejects.toMatchObject({ code: '23503' });
      for (const statement of [
        `update balance_report_snapshots set position_count = 0 where id = '${snapshotId}'`,
        `delete from balance_report_snapshots where id = '${snapshotId}'`,
        `update balance_report_positions set quantity = '3' where snapshot_id = '${snapshotId}'`,
        `delete from balance_report_positions where snapshot_id = '${snapshotId}'`,
      ]) {
        await expect(app.begin(async (tx) => {
          await tx`select set_config('app.current_user_id', 'user-a', true)`;
          await tx.unsafe(statement);
        })).rejects.toMatchObject({ code: '42501' });
      }
      const [remainingBalanceCounts] = await admin<{ parents: number; children: number }[]>`
        select
          (select count(*)::int from balance_report_snapshots where id = ${snapshotId}) parents,
          (select count(*)::int from balance_report_positions where snapshot_id = ${snapshotId}) children
      `;
      expect(remainingBalanceCounts).toEqual({ parents: 1, children: 2 });
      const importRepository = createImportRepository(
        appDb,
        createMemoryPrivateSourceStorage(),
      );
      const csv = new TextEncoder().encode([
        '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益',
        '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,10,1000,--,--,2026/07/03,10000',
        '2026/07/02,別の合成銘柄,1111,東証,株式現物買,--,特定,申告,20,500,--,--,2026/07/04,10000',
        '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,10,1000,--,--,2026/07/03,10000',
      ].join('\n'));
      const simultaneousStages = await Promise.all([
        importRepository.stageSbiTradeHistory({
          principal: userAPrincipal!, brokerAccountId: userAAccount.id, mediaType: 'text/csv', bytes: csv,
        }),
        importRepository.stageSbiTradeHistory({
          principal: userAPrincipal!, brokerAccountId: userAAccount.id, mediaType: 'text/csv', bytes: csv,
        }),
      ]);
      const staged = simultaneousStages.find((result) => result.disposition === 'new')!;
      expect(simultaneousStages.map((result) => result.disposition).sort()).toEqual(['duplicate', 'new']);
      expect(new Set(simultaneousStages.map((result) => result.batchId))).toEqual(new Set([staged.batchId]));

      const equivalentCsv = new TextEncoder().encode([
        'synthetic metadata',
        '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益',
        '2026/07/02,別の合成銘柄,1111,東証,株式現物買,--,特定,申告,020.00,0500.0,--,--,2026/07/04,010000.00',
        '2026/07/01,合成銘柄,0000,東証,株式現物買,--,特定,申告,010.00,01000.0,--,--,2026/07/03,010000.00',
      ].join('\n'));
      const overlapping = await importRepository.stageSbiTradeHistory({
        principal: userAPrincipal!, brokerAccountId: userAAccount.id, mediaType: 'text/csv', bytes: equivalentCsv,
      });
      expect(overlapping.disposition).toBe('new');
      const concurrentCommits = await Promise.all([
        importRepository.commitBatch({ principal: userAPrincipal!, batchId: staged.batchId }),
        importRepository.commitBatch({ principal: userAPrincipal!, batchId: overlapping.batchId }),
      ]);
      expect(concurrentCommits.map((result) => result.committed).sort()).toEqual([0, 2]);
      const simultaneousRetries = await Promise.all([
        importRepository.commitBatch({ principal: userAPrincipal!, batchId: staged.batchId }),
        importRepository.commitBatch({ principal: userAPrincipal!, batchId: staged.batchId }),
      ]);
      expect(new Set(simultaneousRetries.map((result) => result.committed)).size).toBe(1);
      await expect(importRepository.stageSbiTradeHistory({
        principal: userAPrincipal!,
        brokerAccountId: userAAccount.id,
        mediaType: 'text/csv',
        bytes: csv,
      })).resolves.toMatchObject({ disposition: 'duplicate' });
      const userBPrincipal = await resolveSessionPrincipal('import-user-b', {
        findActiveUserByTokenHash: async () => 'user-b',
      });
      await expect(importRepository.getBatchTrace({
        principal: userBPrincipal!,
        batchId: staged.batchId,
      })).resolves.toBeNull();
      const [ledgerCount] = await admin<{ count: number }[]>`
        select count(*)::int as count from ledger_events
      `;
      expect(ledgerCount.count).toBe(2);
      const [ownerLedger] = await admin<{ id: string; event_kind: string }[]>`
        select id, event_kind
        from ledger_events
        where owner_user_id = 'user-a'
        limit 1
      `;
      const visibleOwnerLedger = await app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        return tx<{ id: string }[]>`
          select id from ledger_events where id = ${ownerLedger.id}
        `;
      });
      expect(visibleOwnerLedger).toEqual([{ id: ownerLedger.id }]);
      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        await tx`update ledger_events set event_kind = 'tampered' where id = ${ownerLedger.id}`;
      })).rejects.toMatchObject({ code: '42501' });
      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', 'user-a', true)`;
        await tx`delete from ledger_events where id = ${ownerLedger.id}`;
      })).rejects.toMatchObject({ code: '42501' });
      const [unchangedLedger] = await admin<{ event_kind: string }[]>`
        select event_kind from ledger_events where id = ${ownerLedger.id}
      `;
      expect(unchangedLedger.event_kind).toBe(ownerLedger.event_kind);

      const [userBAccount] = await admin<{ id: string }[]>`
        select id from broker_accounts where owner_user_id = 'user-b'
      `;
      await admin.unsafe(`
        insert into private_source_objects
          (id, owner_user_id, broker_account_id, storage_key, status)
        values
          ('b0000000-0000-4000-8000-000000000001', 'user-b', '${userBAccount.id}', 'synthetic/b/source', 'retained');
        insert into source_documents
          (id, owner_user_id, broker_account_id, content_sha256, media_type, byte_size, storage_key, document_type, status)
        values
          ('b0000000-0000-4000-8000-000000000001', 'user-b', '${userBAccount.id}', repeat('b', 64), 'text/csv', 1, 'synthetic/b/source', 'sbi_trade_history_csv', 'stored');
        insert into import_batches
          (id, owner_user_id, broker_account_id, source_document_id, parser_name, parser_version, status)
        values
          ('b0000000-0000-4000-8000-000000000002', 'user-b', '${userBAccount.id}', 'b0000000-0000-4000-8000-000000000001', 'synthetic', '1', 'preview_ready');
        insert into source_records
          (id, owner_user_id, batch_id, source_document_id, locator, source_row, record_sha256)
        values
          ('b0000000-0000-4000-8000-000000000003', 'user-b', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'csv:row:2', 2, repeat('c', 64));
        insert into staged_events
          (id, owner_user_id, broker_account_id, batch_id, source_record_id, status, reason_code, fingerprint)
        values
          ('b0000000-0000-4000-8000-000000000004', 'user-b', '${userBAccount.id}', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'needs_review', 'synthetic', repeat('d', 64));
      `);
      const [own] = await admin<{
        source_document_id: string;
        batch_id: string;
        source_record_id: string;
        staged_event_id: string;
      }[]>`
        select sd.id as source_document_id, ib.id as batch_id,
               sr.id as source_record_id, se.id as staged_event_id
        from source_documents sd
        join import_batches ib on ib.source_document_id = sd.id
        join source_records sr on sr.batch_id = ib.id
        join staged_events se on se.source_record_id = sr.id
        where sd.owner_user_id = 'user-a' and se.status = 'duplicate'
        limit 1
      `;
      const crossOwnerStatements = [
        `insert into private_source_objects (id, owner_user_id, broker_account_id, storage_key, status)
         values ('a0000000-0000-4000-8000-000000000011', 'user-a', '${userBAccount.id}', 'synthetic/a/cross-account', 'pending_upload')`,
        `insert into import_batches (id, owner_user_id, broker_account_id, source_document_id, parser_name, parser_version, status)
         values ('a0000000-0000-4000-8000-000000000012', 'user-a', '${userAAccount.id}', 'b0000000-0000-4000-8000-000000000001', 'synthetic', '1', 'preview_ready')`,
        `insert into source_records (id, owner_user_id, batch_id, source_document_id, locator, source_row, record_sha256)
         values ('a0000000-0000-4000-8000-000000000013', 'user-a', 'b0000000-0000-4000-8000-000000000002', '${own.source_document_id}', 'csv:row:90', 90, repeat('e', 64))`,
        `insert into source_records (id, owner_user_id, batch_id, source_document_id, locator, source_row, record_sha256)
         values ('a0000000-0000-4000-8000-000000000014', 'user-a', '${own.batch_id}', 'b0000000-0000-4000-8000-000000000001', 'csv:row:91', 91, repeat('f', 64))`,
        `insert into staged_events (id, owner_user_id, broker_account_id, batch_id, source_record_id, status, reason_code, fingerprint)
         values ('a0000000-0000-4000-8000-000000000015', 'user-a', '${userAAccount.id}', 'b0000000-0000-4000-8000-000000000002', '${own.source_record_id}', 'needs_review', 'synthetic', repeat('1', 64))`,
        `insert into staged_events (id, owner_user_id, broker_account_id, batch_id, source_record_id, status, reason_code, fingerprint)
         values ('a0000000-0000-4000-8000-000000000016', 'user-a', '${userAAccount.id}', '${own.batch_id}', 'b0000000-0000-4000-8000-000000000003', 'needs_review', 'synthetic', repeat('2', 64))`,
        `insert into ledger_events (owner_user_id, broker_account_id, staged_event_id, fingerprint, event_kind, payload)
         values ('user-a', '${userBAccount.id}', '${own.staged_event_id}', repeat('3', 64), 'synthetic', '{}'::jsonb)`,
        `insert into ledger_events (owner_user_id, broker_account_id, staged_event_id, fingerprint, event_kind, payload)
         values ('user-a', '${userAAccount.id}', 'b0000000-0000-4000-8000-000000000004', repeat('4', 64), 'synthetic', '{}'::jsonb)`,
      ];
      for (const statement of crossOwnerStatements) {
        await expect(app.begin(async (tx) => {
          await tx`select set_config('app.current_user_id', 'user-a', true)`;
          await tx.unsafe(statement);
        })).rejects.toMatchObject({ code: '23503' });
      }

      const catalogs = await admin<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[]>`
        select relname, relrowsecurity, relforcerowsecurity
        from pg_class
        where relname in ('broker_accounts', 'private_source_objects', 'source_documents', 'import_batches', 'source_records', 'staged_events', 'ledger_events')
        order by relname
      `;
      expect(catalogs).toHaveLength(7);
      expect(catalogs.every((catalog) => catalog.relrowsecurity && catalog.relforcerowsecurity)).toBe(true);

      const ledgerForeignKeyActions = await admin<{
        conname: string;
        confdeltype: string;
      }[]>`
        select conname, confdeltype
        from pg_constraint
        where conrelid = 'ledger_events'::regclass
          and contype = 'f'
        order by conname
      `;
      expect(ledgerForeignKeyActions).toEqual([
        { conname: 'ledger_events_owner_account_staged_event_fk', confdeltype: 'r' },
        { conname: 'ledger_events_owner_broker_account_fk', confdeltype: 'c' },
        { conname: 'ledger_events_owner_user_id_user_id_fkey', confdeltype: 'c' },
      ]);
    } finally {
      await appSecond.end();
      await app.end();
      await revoker.end();
      await admin.end();
    }
  }, 30_000);
});
