import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runLockedMigration } from '../scripts/migrate-production-locked.mjs';

function harness() {
  const events: string[] = [];
  const session = {
    unsafe: vi.fn(async (query: string) => { events.push(query.includes('unlock') ? 'unlock' : 'lock'); }),
    release: vi.fn(() => { events.push('release'); }),
  };
  const pool = {
    reserve: vi.fn(async () => { events.push('reserve'); return session; }),
    end: vi.fn(async () => { events.push('end'); }),
  };
  return { events, session, pool, createPool: vi.fn(() => pool) };
}

describe('serialized production migration runner', () => {
  it('rejects migration.sql symlink escape before creating a database pool', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'migration-tree-'));
    const directory = path.join(root, '20260101000000_synthetic');
    await mkdir(directory);
    await writeFile(path.join(directory, 'snapshot.json'), '{}');
    await symlink('/proc/self/environ', path.join(directory, 'migration.sql'));
    const createPool = vi.fn();
    try {
      await expect(runLockedMigration({
        url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: root, createPool,
      })).rejects.toThrow('Invalid migration tree.');
      expect(createPool).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unexpected candidate files before creating a database pool', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'migration-tree-'));
    const directory = path.join(root, '20260101000000_synthetic');
    await mkdir(directory);
    await writeFile(path.join(directory, 'snapshot.json'), '{}');
    await writeFile(path.join(directory, 'migration.sql'), 'select 1;');
    await writeFile(path.join(directory, 'unexpected.txt'), 'synthetic');
    const createPool = vi.fn();
    try {
      await expect(runLockedMigration({
        url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: root, createPool,
      })).rejects.toThrow('Invalid migration tree.');
      expect(createPool).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires a dedicated credential without printing or falling back to runtime DATABASE_URL', async () => {
    await expect(runLockedMigration({ url: undefined, migrationsFolder: 'drizzle' }))
      .rejects.toThrow('Dedicated migration credential is required.');
  });

  it('reserves one session and holds its advisory lock across journal and DDL work', async () => {
    const h = harness();
    const applyMigrations = vi.fn(async () => { h.events.push('migrate'); });
    await runLockedMigration({
      url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool, applyMigrations,
    });
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
    expect(applyMigrations).toHaveBeenCalledWith(h.session, expect.stringMatching(/drizzle$/));
  });

  it('unlocks, releases, and closes the same session when migration fails', async () => {
    const h = harness();
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
      applyMigrations: async () => { h.events.push('migrate'); throw new Error('synthetic migration failure'); },
    })).rejects.toThrow('synthetic migration failure');
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
  });

  it('closes the pool when reserving a session fails', async () => {
    const h = harness();
    h.pool.reserve.mockRejectedValueOnce(new Error('synthetic reserve failure'));
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
    })).rejects.toThrow('synthetic reserve failure');
    expect(h.events).toEqual(['end']);
  });
});
