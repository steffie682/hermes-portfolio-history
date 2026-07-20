import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export type PasskeyRelyingParty = {
  rpID: string;
  rpName: string;
};

export async function createPasskeyRegistrationOptions(
  relyingParty: PasskeyRelyingParty,
  user: { userId: string; name: string },
) {
  return generateRegistrationOptions({
    rpID: relyingParty.rpID,
    rpName: relyingParty.rpName,
    userID: new TextEncoder().encode(user.userId),
    userName: user.userId,
    userDisplayName: user.name,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}


type ExcludedCredential = NonNullable<
  Parameters<typeof generateRegistrationOptions>[0]['excludeCredentials']
>[number];

export async function createPasskeyDeviceEnrollmentOptions(
  relyingParty: PasskeyRelyingParty,
  input: {
    userId: string;
    name: string;
    challenge: string;
    excludeCredentials: ExcludedCredential[];
  },
) {
  return generateRegistrationOptions({
    rpID: relyingParty.rpID,
    rpName: relyingParty.rpName,
    userID: new TextEncoder().encode(input.userId),
    userName: input.userId,
    userDisplayName: input.name,
    challenge: isoBase64URL.toBuffer(input.challenge),
    excludeCredentials: input.excludeCredentials,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

export async function createPasskeyAuthenticationOptions(
  relyingParty: Pick<PasskeyRelyingParty, 'rpID'>,
) {
  return generateAuthenticationOptions({
    rpID: relyingParty.rpID,
    userVerification: 'required',
  });
}
