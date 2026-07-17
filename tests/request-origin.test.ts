import { describe, expect, it } from 'vitest';
import { hasExpectedOrigin } from '@/auth/request-origin';

describe('state-changing request origin', () => {
  it('accepts only the exact configured origin', () => {
    expect(
      hasExpectedOrigin(
        new Request('https://app.example.com/api', {
          headers: { origin: 'https://app.example.com' },
        }),
        'https://app.example.com',
      ),
    ).toBe(true);
    expect(
      hasExpectedOrigin(
        new Request('https://app.example.com/api', {
          headers: { origin: 'https://evil.example.com' },
        }),
        'https://app.example.com',
      ),
    ).toBe(false);
    expect(hasExpectedOrigin(new Request('https://app.example.com/api'), 'https://app.example.com')).toBe(false);
  });
});
