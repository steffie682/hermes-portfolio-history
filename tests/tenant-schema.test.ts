import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { authUsers, brokerAccounts } from '@/db/schema';

describe('tenant-owned schema', () => {
  it('links every broker account to an authentication user', () => {
    expect(getTableName(authUsers)).toBe('user');
    expect(getTableName(brokerAccounts)).toBe('broker_accounts');
    expect(getTableColumns(brokerAccounts).ownerUserId.name).toBe('owner_user_id');
    expect(getTableColumns(brokerAccounts).ownerUserId.notNull).toBe(true);
  });

  it('enables row-level security with an owner policy', () => {
    const config = getTableConfig(brokerAccounts);
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      'broker_accounts_owner_isolation',
    ]);
  });
});
