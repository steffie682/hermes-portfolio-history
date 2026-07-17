import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyAllMigrations } from './helpers/migrations';

describe('initial migration', () => {
  it('applies cleanly with the expected app_metadata constraints', async () => {
    const db = new PGlite();
    try {
      await applyAllMigrations(db);

      const columns = await db.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public' and table_name = 'app_metadata'
         order by ordinal_position`,
      );
      expect(columns.rows).toEqual([
        { column_name: 'key', data_type: 'text', is_nullable: 'NO', column_default: null },
        { column_name: 'value', data_type: 'text', is_nullable: 'NO', column_default: null },
        {
          column_name: 'created_at',
          data_type: 'timestamp with time zone',
          is_nullable: 'NO',
          column_default: 'now()',
        },
      ]);

      const primaryKey = await db.query<{ column_name: string }>(
        `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.constraint_schema = kcu.constraint_schema
         where tc.table_schema = 'public'
           and tc.table_name = 'app_metadata'
           and tc.constraint_type = 'PRIMARY KEY'`,
      );
      expect(primaryKey.rows).toEqual([{ column_name: 'key' }]);

      const authTables = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public'
           and table_name in ('auth_challenges', 'auth_sessions', 'passkey_credentials')
         order by table_name`,
      );
      expect(authTables.rows).toEqual([
        { table_name: 'auth_challenges' },
        { table_name: 'auth_sessions' },
        { table_name: 'passkey_credentials' },
      ]);
    } finally {
      await db.close();
    }
  });
});
