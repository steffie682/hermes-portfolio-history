import { and, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import { gardenStates } from '@/db/schema';
import { authenticatedPrincipalId, type AuthenticatedPrincipal } from '@/auth/session';
import { MAX_REVISION, validateGardenState, type GardenState } from './domain';

export class GardenConflictError extends Error {
  constructor() { super('Stale garden revision'); }
}
export function createGardenRepository(db: AppDatabase) {
  return {
    async load(principal: AuthenticatedPrincipal): Promise<GardenState> {
      const ownerUserId = authenticatedPrincipalId(principal);
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const [row] = await tx.select({ revision: gardenStates.revision, lots: gardenStates.lots })
          .from(gardenStates).where(eq(gardenStates.ownerUserId, ownerUserId));
        return row ? validateGardenState(row) : { revision: 0, lots: [] };
      });
    },
    async save(principal: AuthenticatedPrincipal, input: GardenState): Promise<GardenState> {
      const ownerUserId = authenticatedPrincipalId(principal);
      const state = validateGardenState(input);
      if (state.revision >= MAX_REVISION) throw new GardenConflictError();
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.current_user_id', ${ownerUserId}, true)`);
        const fields = { revision: gardenStates.revision, lots: gardenStates.lots };
        const rows = state.revision === 0
          ? await tx.insert(gardenStates).values({ ownerUserId, revision: 1, lots: state.lots })
            .onConflictDoNothing({ target: gardenStates.ownerUserId }).returning(fields)
          : await tx.update(gardenStates).set({ revision: state.revision + 1, lots: state.lots, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(and(eq(gardenStates.ownerUserId, ownerUserId), eq(gardenStates.revision, state.revision))).returning(fields);
        if (rows.length !== 1) throw new GardenConflictError();
        return validateGardenState(rows[0]);
      });
    },
  };
}
export type GardenRepository = ReturnType<typeof createGardenRepository>;
