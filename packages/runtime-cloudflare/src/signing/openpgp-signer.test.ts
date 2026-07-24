import { describe, expect, it, vi } from "vitest";
import { createMessage, generateKey, readCleartextMessage, readKey, verify, readSignature } from "openpgp";
import { OpenPgpSigner } from "./openpgp-signer";

describe("OpenPgpSigner", () => {
  it("creates verifiable clear and detached signatures", async () => {
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
      date: new Date("2026-07-18T00:00:00.000Z"),
    });
    const signer = new OpenPgpSigner();
    const release = "Origin: debian-internal\nCodename: noble\n";

    const inRelease = await signer.clearSign({
      text: release,
      privateKeyArmored: key.privateKey,
      passphrase: "correct-passphrase",
      signingDate: new Date("2026-07-18T00:10:00.000Z"),
    });
    expect(inRelease).toContain("BEGIN PGP SIGNED MESSAGE");

    const publicKey = await readKey({ armoredKey: key.publicKey });
    const cleartext = await readCleartextMessage({ cleartextMessage: inRelease });
    const clearVerification = await verify({ message: cleartext, verificationKeys: publicKey });
    await expect(clearVerification.signatures[0]!.verified).resolves.toBe(true);

    const detachedSignature = await signer.detachSign({
      text: release,
      privateKeyArmored: key.privateKey,
      passphrase: "correct-passphrase",
      signingDate: new Date("2026-07-18T00:10:00.000Z"),
    });
    expect(detachedSignature).toContain("BEGIN PGP SIGNATURE");

    const detachedVerification = await verify({
      message: await createMessage({ text: release }),
      signature: await readSignature({ armoredSignature: detachedSignature }),
      verificationKeys: publicKey,
    });
    await expect(detachedVerification.signatures[0]!.verified).resolves.toBe(true);
  });

  it("creates byte-identical signatures for the same signing date", async () => {
    const key = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Axis Test", email: "axis@example.test" }],
      passphrase: "correct-passphrase",
      date: new Date("2026-07-18T00:00:00.000Z"),
    });
    const signer = new OpenPgpSigner();
    const input = {
      text: "Origin: debian-internal\nCodename: noble\n",
      privateKeyArmored: key.privateKey,
      passphrase: "correct-passphrase",
      signingDate: new Date("2026-07-18T00:10:00.000Z"),
    };

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-18T00:10:01.000Z"));
      const firstClear = await signer.clearSign(input);
      const firstDetached = await signer.detachSign(input);

      vi.setSystemTime(new Date("2026-07-18T00:20:00.000Z"));
      await expect(signer.clearSign(input)).resolves.toBe(firstClear);
      await expect(signer.detachSign(input)).resolves.toBe(firstDetached);
    } finally {
      vi.useRealTimers();
    }
  });
});
