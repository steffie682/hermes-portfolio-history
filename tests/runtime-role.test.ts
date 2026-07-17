import { describe, expect, it } from 'vitest';
import { validateRuntimeRole } from '@/db/security';

describe('runtime database role', () => {
  it('rejects roles that can bypass RLS', () => {
    expect(() => validateRuntimeRole({ rolsuper: true, rolbypassrls: false })).toThrow(
      'row-level security',
    );
    expect(() => validateRuntimeRole({ rolsuper: false, rolbypassrls: true })).toThrow(
      'row-level security',
    );
    expect(() => validateRuntimeRole({ rolsuper: false, rolbypassrls: false })).not.toThrow();
  });
});
