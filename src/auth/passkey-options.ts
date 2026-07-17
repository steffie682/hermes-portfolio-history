import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from '@simplewebauthn/server';

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


export async function createPasskeyAuthenticationOptions(
  relyingParty: Pick<PasskeyRelyingParty, 'rpID'>,
) {
  return generateAuthenticationOptions({
    rpID: relyingParty.rpID,
    userVerification: 'required',
  });
}
