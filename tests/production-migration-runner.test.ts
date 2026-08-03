import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  formatProductionMigrationError, ProductionMigrationError, runLockedMigration,
} from '../scripts/migrate-production-locked.mjs';

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
      })).rejects.toMatchObject({ message: 'Production migration failed.', stage: 'validation', sqlState: 'unknown' });
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
      })).rejects.toMatchObject({ message: 'Production migration failed.', stage: 'validation', sqlState: 'unknown' });
      expect(createPool).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires a dedicated credential without printing or falling back to runtime DATABASE_URL', async () => {
    await expect(runLockedMigration({ url: undefined, migrationsFolder: 'drizzle' }))
      .rejects.toMatchObject({ message: 'Production migration failed.', stage: 'configuration', sqlState: 'unknown' });
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
      applyMigrations: async () => {
        h.events.push('migrate');
        throw Object.assign(new Error('synthetic migration failure'), { code: '42501' });
      },
    })).rejects.toMatchObject({ message: 'Production migration failed.', stage: 'migration', sqlState: '42501' });
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
  });

  it('allowlists stage and SQLSTATE again at the output boundary', () => {
    const forged = new ProductionMigrationError(
      'migration\nLEAKED' as never,
      Object.assign(new Error('postgresql://user:secret@example.invalid/db'), { code: '28p01\nLEAKED' }),
    );
    expect(forged).toMatchObject({ stage: 'unknown', sqlState: 'unknown' });
    expect(formatProductionMigrationError(forged))
      .toBe('Production migration failed (stage=unknown, sqlstate=unknown).');
  });

  it('reclassifies an already-tagged error at the current trusted boundary', async () => {
    const forged = new ProductionMigrationError(
      'migration\nLEAKED' as never,
      Object.assign(new Error('synthetic secret'), { code: '42501' }),
    );
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:***@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: () => { throw forged; },
    })).rejects.toMatchObject({ stage: 'connection', sqlState: '42501' });
  });

  it('preserves migration failure when release also fails and still closes the pool', async () => {
    const h = harness();
    h.session.release.mockImplementationOnce(() => { h.events.push('release'); throw new Error('release secret'); });
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:***@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
      applyMigrations: async () => {
        h.events.push('migrate');
        throw Object.assign(new Error('migration secret'), { code: '42501' });
      },
    })).rejects.toMatchObject({ stage: 'migration', sqlState: '42501' });
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
  });

  it('preserves unlock failure over release failure and still closes the pool', async () => {
    const h = harness();
    h.session.unsafe.mockImplementation(async (query: string) => {
      const event = query.includes('unlock') ? 'unlock' : 'lock';
      h.events.push(event);
      if (event === 'unlock') throw Object.assign(new Error('unlock secret'), { code: '08006' });
    });
    h.session.release.mockImplementationOnce(() => { h.events.push('release'); throw new Error('release secret'); });
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:***@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
      applyMigrations: async () => { h.events.push('migrate'); },
    })).rejects.toMatchObject({ stage: 'unlock', sqlState: '08006' });
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
  });

  it('preserves release failure over close failure after successful migration', async () => {
    const h = harness();
    h.session.release.mockImplementationOnce(() => {
      h.events.push('release');
      throw Object.assign(new Error('release secret'), { code: '58000' });
    });
    h.pool.end.mockImplementationOnce(async () => { h.events.push('end'); throw new Error('close secret'); });
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:***@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
      applyMigrations: async () => { h.events.push('migrate'); },
    })).rejects.toMatchObject({ stage: 'release', sqlState: '58000' });
    expect(h.events).toEqual(['reserve', 'lock', 'migrate', 'unlock', 'release', 'end']);
  });

  it('closes the pool when reserving a session fails', async () => {
    const h = harness();
    h.pool.reserve.mockRejectedValueOnce(new Error('synthetic reserve failure'));
    await expect(runLockedMigration({
      url: 'postgresql://synthetic:synthetic@localhost/synthetic', migrationsFolder: 'drizzle',
      createPool: h.createPool,
    })).rejects.toMatchObject({ message: 'Production migration failed.', stage: 'connection', sqlState: 'unknown' });
    expect(h.events).toEqual(['end']);
  });
});
