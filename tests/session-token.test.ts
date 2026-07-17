import { describe, expect, it } from 'vitest';
import { createSessionToken, hashSessionToken } from '@/auth/session-token';

describe('session tokens', () => {
  it('generates an opaque token and stores only a deterministic hash', () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });
});
