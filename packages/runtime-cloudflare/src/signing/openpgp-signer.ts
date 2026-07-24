import { createCleartextMessage, createMessage, decryptKey, readPrivateKey, sign } from "openpgp";

export interface SignInput {
  text: string;
  privateKeyArmored: string;
  passphrase: string;
  signingDate: Date;
}

const DETERMINISTIC_SIGNATURE_CONFIG = {
  nonDeterministicSignaturesViaNotation: false,
};

export class OpenPgpSigner {
  async clearSign(input: SignInput): Promise<string> {
    const signingKeys = await this.decryptPrivateKey(input);
    return sign({
      message: await createCleartextMessage({ text: input.text }),
      signingKeys,
      format: "armored",
      date: input.signingDate,
      config: DETERMINISTIC_SIGNATURE_CONFIG,
    }) as Promise<string>;
  }

  async detachSign(input: SignInput): Promise<string> {
    const signingKeys = await this.decryptPrivateKey(input);
    return sign({
      message: await createMessage({ text: input.text, date: input.signingDate }),
      signingKeys,
      detached: true,
      format: "armored",
      date: input.signingDate,
      config: DETERMINISTIC_SIGNATURE_CONFIG,
    }) as Promise<string>;
  }

  private async decryptPrivateKey(input: SignInput) {
    const privateKey = await readPrivateKey({ armoredKey: input.privateKeyArmored });
    return decryptKey({ privateKey, passphrase: input.passphrase });
  }
}
