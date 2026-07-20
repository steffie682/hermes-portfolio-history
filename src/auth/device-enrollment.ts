import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createPasskeyDeviceEnrollmentOptions } from './passkey-options';
import { createSessionToken, hashSessionToken } from './session-token';
import type { StoredPasskey } from './passkey-authentication';
import type { AuthConfig } from './types';
import type { AuthenticatedPrincipal } from './session';

export type DeviceEnrollmentGrantRecord = {
  tokenHash: string;
  challenge: string;
};

export type SaveDeviceEnrollmentGrant = (
  principal: AuthenticatedPrincipal,
  recentSessionTokenHash: string,
  grant: DeviceEnrollmentGrantRecord,
  now: Date,
) => Promise<Date>;

export async function beginDeviceEnrollment(
  input: {
    principal: AuthenticatedPrincipal;
    sessionToken: string;
  },
  dependencies: {
    saveGrant: SaveDeviceEnrollmentGrant;
    createToken?: () => string;
    createChallenge?: () => string;
    now?: Date;
  },
) {
  const now = dependencies.now ?? new Date();
  const grantToken = (dependencies.createToken ?? createSessionToken)();
  const challenge = (dependencies.createChallenge ?? createSessionToken)();

  const expiresAt = await dependencies.saveGrant(
    input.principal,
    hashSessionToken(input.sessionToken),
    {
      tokenHash: hashSessionToken(grantToken),
      challenge,
    },
    now,
  );

  return { grantToken, expiresAt };
}


export type DeviceEnrollmentGrantContext = {
  userId: string;
  name: string;
  challenge: string;
  excludeCredentials: Array<{
    id: string;
    transports?: StoredPasskey['transports'];
  }>;
};

export type LoadDeviceEnrollmentGrant = (
  tokenHash: string,
  now: Date,
) => Promise<DeviceEnrollmentGrantContext | null>;

export async function getDeviceEnrollmentOptions(
  grantToken: string,
  dependencies: {
    config: AuthConfig;
    loadGrant: LoadDeviceEnrollmentGrant;
    now?: Date;
  },
) {
  const now = dependencies.now ?? new Date();
  const grant = await dependencies.loadGrant(hashSessionToken(grantToken), now);
  if (!grant) throw new Error('Device enrollment grant is missing or expired');
  return createPasskeyDeviceEnrollmentOptions(dependencies.config, grant);
}

export type PersistDeviceEnrollmentInput = {
  tokenHash: string;
  userId: string;
  challenge: string;
  credential: {
    id: string;
    userId: string;
    publicKey: Buffer;
    counter: number;
    deviceType: string;
    backedUp: boolean;
    transports?: string[];
  };
  session: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    authMethod: 'passkey_device_enrollment';
    authenticatedAt: Date;
  };
  now: Date;
};

export async function finishDeviceEnrollment(
  input: {
    grantToken: string;
    response: RegistrationResponseJSON;
  },
  dependencies: {
    config: AuthConfig;
    loadGrant: LoadDeviceEnrollmentGrant;
    persistEnrollment: (input: PersistDeviceEnrollmentInput) => Promise<void>;
    verifyRegistration?: typeof verifyRegistrationResponse;
    createSessionToken?: () => string;
    now?: Date;
  },
) {
  const now = dependencies.now ?? new Date();
  const tokenHash = hashSessionToken(input.grantToken);
  const grant = await dependencies.loadGrant(tokenHash, now);
  if (!grant) throw new Error('Device enrollment grant is missing or expired');

  const verification = await (
    dependencies.verifyRegistration ?? verifyRegistrationResponse
  )({
    response: input.response,
    expectedChallenge: grant.challenge,
    expectedOrigin: dependencies.config.origin,
    expectedRPID: dependencies.config.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Device enrollment verification failed');
  }

  const sessionToken = (dependencies.createSessionToken ?? createSessionToken)();
  const credential = verification.registrationInfo.credential;
  await dependencies.persistEnrollment({
    tokenHash,
    userId: grant.userId,
    challenge: grant.challenge,
    credential: {
      id: credential.id,
      userId: grant.userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: credential.transports,
    },
    session: {
      userId: grant.userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      authMethod: 'passkey_device_enrollment',
      authenticatedAt: now,
    },
    now,
  });
  return { sessionToken };
}
