import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appMetadata } from '@/db/schema';

describe('database schema', () => {
  it('defines the application metadata table used to verify migrations', () => {
    expect(getTableName(appMetadata)).toBe('app_metadata');
  });
});
