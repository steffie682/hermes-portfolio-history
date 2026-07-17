import { sql } from 'drizzle-orm';
import type { AppDatabase } from './client';

export type RuntimeRole = {
  rolsuper: boolean;
  rolbypassrls: boolean;
};

export function validateRuntimeRole(role: RuntimeRole): void {
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error('Application database role must enforce row-level security');
  }
}

export async function verifyRuntimeRole(db: AppDatabase): Promise<void> {
  const rows = await db.execute<RuntimeRole>(sql`
    select rolsuper, rolbypassrls
    from pg_roles
    where rolname = current_user
  `);
  const role = rows[0];
  if (!role) throw new Error('Application database role was not found');
  validateRuntimeRole(role);
}
