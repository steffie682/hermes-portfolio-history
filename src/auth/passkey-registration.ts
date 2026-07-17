import { randomUUID } from 'node:crypto';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createPasskeyRegistrationOptions } from './passkey-options';
import {
  createRegistrationContext,
  verifyRegistrationContext,
} from './registration-context';
import {
  createSessionToken as createOpaqueSessionToken,
  hashSessionToken,
} from './session-token';
import type { AuthConfig } from './types';

export type ChallengeRecord = {
  challenge: string;
  ceremony: 'registration' | 'authentication';
  contextHash: string;
  expiresAt: Date;
};

export type SaveChallenge = (record: ChallengeRecord) => Promise<void>;

export async function beginPasskeyRegistration(
  input: { name: string },
  dependencies: {
    config: AuthConfig;
    saveChallenge: SaveChallenge;
    createUserId?: () => string;
    now?: Date;
  },
) {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new Error('Display name must be between 1 and 80 characters');
  }
  const now = dependencies.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const userId = (dependencies.createUserId ?? randomUUID)();
  const context = createRegistrationContext(
    { userId, name, expiresAt: expiresAt.getTime() },
    dependencies.config.secret,
  );
  const options = await createPasskeyRegistrationOptions(dependencies.config, {
    userId,
    name,
  });
  await dependencies.saveChallenge({
    challenge: options.challenge,
    ceremony: 'registration',
    contextHash: hashSessionToken(context),
    expiresAt,
  });
  return { options, context };
}

export type PersistRegistrationInput = {
  user: { id: string; name: string };
  credential: {
    id: string;
    userId: string;
    publicKey: Buffer;
    counter: number;
    deviceType: string;
    backedUp: boolean;
    transports?: string[];
  };
  session: { userId: string; tokenHash: string; expiresAt: Date };
  contextHash: string;
  now: Date;
};

export async function finishPasskeyRegistration(
  input: { context: string; response: RegistrationResponseJSON },
  dependencies: {
    config: AuthConfig;
    loadChallenge: (
      contextHash: string,
      now: Date,
    ) => Promise<{ challenge: string } | null>;
    verifyRegistration?: typeof verifyRegistrationResponse;
    persistRegistration: (input: PersistRegistrationInput) => Promise<void>;
    createSessionToken?: () => string;
    now?: Date;
  },
) {
  const now = dependencies.now ?? new Date();
  const identity = verifyRegistrationContext(
    input.context,
    dependencies.config.secret,
    now.getTime(),
  );
  const contextHash = hashSessionToken(input.context);
  const challenge = await dependencies.loadChallenge(contextHash, now);
  if (!challenge) throw new Error('Registration challenge is missing or expired');

  const verification = await (
    dependencies.verifyRegistration ?? verifyRegistrationResponse
  )({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: dependencies.config.origin,
    expectedRPID: dependencies.config.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration verification failed');
  }

  const token = (dependencies.createSessionToken ?? createOpaqueSessionToken)();
  const credential = verification.registrationInfo.credential;
  await dependencies.persistRegistration({
    user: { id: identity.userId, name: identity.name },
    credential: {
      id: credential.id,
      userId: identity.userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: credential.transports,
    },
    session: {
      userId: identity.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
    contextHash,
    now,
  });
  return { sessionToken: token };
}
