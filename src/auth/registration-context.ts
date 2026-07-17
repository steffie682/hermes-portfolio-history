import { createHmac, timingSafeEqual } from 'node:crypto';

export type RegistrationContext = {
  userId: string;
  name: string;
  expiresAt: number;
};

function validate(context: RegistrationContext): RegistrationContext {
  if (
    typeof context.userId !== 'string' ||
    context.userId.length === 0 ||
    typeof context.name !== 'string' ||
    context.name.trim().length === 0 ||
    !Number.isSafeInteger(context.expiresAt)
  ) {
    throw new Error('Invalid registration context');
  }
  return { ...context, name: context.name.trim() };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createRegistrationContext(
  context: RegistrationContext,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(validate(context))).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyRegistrationContext(
  token: string,
  secret: string,
  now: number,
): RegistrationContext {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    throw new Error('Invalid registration context');
  }
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid registration context');
  }
  const context = validate(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RegistrationContext,
  );
  if (context.expiresAt <= now) {
    throw new Error('Expired registration context');
  }
  return context;
}
