import type {
  AuthenticationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { createPasskeyAuthenticationOptions } from './passkey-options';
import { createSessionToken, hashSessionToken } from './session-token';
import type { SaveChallenge } from './passkey-registration';
import type { AuthConfig } from './types';

export async function beginPasskeyAuthentication(dependencies: {
  config: AuthConfig;
  saveChallenge: SaveChallenge;
  createChallengeToken?: () => string;
  now?: Date;
}) {
  const now = dependencies.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const challengeToken = (
    dependencies.createChallengeToken ?? createSessionToken
  )();
  const options = await createPasskeyAuthenticationOptions(dependencies.config);
  await dependencies.saveChallenge({
    challenge: options.challenge,
    ceremony: 'authentication',
    contextHash: hashSessionToken(challengeToken),
    expiresAt,
  });
  return { options, challengeToken };
}

export type StoredPasskey = WebAuthnCredential & { userId: string };

export async function finishPasskeyAuthentication(
  input: { challengeToken: string; response: AuthenticationResponseJSON },
  dependencies: {
    config: AuthConfig;
    loadChallenge: (
      contextHash: string,
      now: Date,
    ) => Promise<{ challenge: string } | null>;
    loadCredential: (credentialId: string) => Promise<StoredPasskey | null>;
    verifyAuthentication?: typeof verifyAuthenticationResponse;
    persistAuthentication: (input: {
      credentialId: string;
      previousCounter: number;
      newCounter: number;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      contextHash: string;
      authMethod: 'passkey_authentication';
      authenticatedAt: Date;
      now: Date;
    }) => Promise<void>;
    createSessionToken?: () => string;
    now?: Date;
  },
) {
  const now = dependencies.now ?? new Date();
  const contextHash = hashSessionToken(input.challengeToken);
  const challenge = await dependencies.loadChallenge(contextHash, now);
  if (!challenge) throw new Error('Authentication challenge is missing or expired');
  const credential = await dependencies.loadCredential(input.response.id);
  if (!credential) throw new Error('Passkey credential was not found');

  const verification = await (
    dependencies.verifyAuthentication ?? verifyAuthenticationResponse
  )({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: dependencies.config.origin,
    expectedRPID: dependencies.config.rpID,
    credential,
    requireUserVerification: true,
  });
  if (!verification.verified) {
    throw new Error('Passkey authentication verification failed');
  }

  const token = (dependencies.createSessionToken ?? createSessionToken)();
  await dependencies.persistAuthentication({
    credentialId: credential.id,
    previousCounter: credential.counter,
    newCounter: verification.authenticationInfo.newCounter,
    userId: credential.userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    contextHash,
    authMethod: 'passkey_authentication',
    authenticatedAt: now,
    now,
  });
  return { sessionToken: token };
}
