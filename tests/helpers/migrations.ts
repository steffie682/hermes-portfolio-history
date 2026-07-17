import { readdir, readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';

export async function migrationDirectories(): Promise<string[]> {
  const entries = await readdir('drizzle', { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function applyAllMigrations(db: PGlite): Promise<void> {
  for (const directory of await migrationDirectories()) {
    const sql = await readFile(`drizzle/${directory}/migration.sql`, 'utf8');
    await db.exec(sql);
  }
}
