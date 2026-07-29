import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { R2PresignedUploadBroker } from "../uploads/r2-upload-broker";

/**
 * What a deployment is asked for, and what it is told about each answer.
 *
 * Deploy to Cloudflare reads `.dev.vars.example` to know which secrets to
 * prompt for, and `cloudflare.bindings` in `package.json` for the text shown
 * beside each field. Neither is reachable from the worker's own code, so a
 * secret added to the runtime rots them silently: nobody is asked for it, and
 * the deploy fails on a value its operator was never told existed.
 */

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function exampleSecretNames(): string[] {
  const text = readFileSync(`${repositoryRoot}.dev.vars.example`, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => line.split("=")[0]?.trim() ?? "");
}

function describedBindingNames(): string[] {
  const manifest = JSON.parse(readFileSync(`${repositoryRoot}package.json`, "utf8")) as {
    cloudflare?: { bindings?: Record<string, { description?: string }> };
  };
  return Object.entries(manifest.cloudflare?.bindings ?? {})
    .filter(([, binding]) => (binding.description ?? "").trim() !== "")
    .map(([name]) => name);
}

describe("what a deploy is asked to supply", () => {
  it("asks for everything the worker refuses to start without", () => {
    // Each of these throws out of createDurableObjectDependencies or the admin
    // auth service, so a deployment missing one answers 500 to its own login
    // page.
    const required = [
      "AXIS_SESSION_SECRET",
      "TOKEN_HASH_PEPPER",
      "SIGNING_KEY_ENCRYPTION_SECRET",
    ];

    expect(exampleSecretNames()).toEqual(expect.arrayContaining(required));
  });

  it("asks for what it takes to sign an upload URL", () => {
    // The default backend hands publishing clients a presigned URL so artifact
    // bytes go straight to R2. Without these it cannot sign one, and refuses
    // every request rather than only the uploads.
    expect(exampleSecretNames()).toEqual(
      expect.arrayContaining([
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        // Asked for rather than configured: deploying may rename the bucket,
        // and a constant in the Wrangler config would go on naming the old one
        // while the binding followed the new.
        "R2_BUCKET_NAME",
      ]),
    );
  });

  it("does not also set a name it asks for", () => {
    // A value given in both places is a value that can disagree with itself.
    const wrangler = readFileSync(`${repositoryRoot}wrangler.jsonc`, "utf8");
    const declaredVars = /"vars"\s*:\s*\{([^}]*)\}/.exec(wrangler)?.[1] ?? "";

    for (const name of exampleSecretNames()) {
      expect(declaredVars).not.toContain(`"${name}"`);
    }
  });

  it("asks for a first account, there being no other way to make one", () => {
    // Without a bootstrap owner nothing seeds an admin, and the deployment
    // comes up with no credentials that work.
    expect(exampleSecretNames()).toEqual(
      expect.arrayContaining(["AXIS_ADMIN_USERNAME", "AXIS_ADMIN_PASSWORD"]),
    );
  });

  it("documents a bucket policy that allows what an upload URL signs", async () => {
    // The admin UI PUTs straight to the bucket, and a browser may not send
    // these cross-origin unless CORS names them: the preflight is refused with
    // 403, which says nothing about which header was the problem.
    const target = await new R2PresignedUploadBroker({
      bucket: { head: async () => null, get: async () => null },
      accountId: "account123",
      bucketName: "axis-repository",
      accessKeyId: "access",
      secretAccessKey: "secret",
    }).createUploadTarget({
      repositoryName: "debian-internal",
      sessionId: "pub_1",
      uploadId: "upl_1",
      artifact: {
        filename: "myapp_1.2.3_amd64.deb",
        size: 1,
        sha256: "a".repeat(64),
        contentType: "application/vnd.debian.binary-package",
        metadata: {},
      },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const policy = JSON.parse(readFileSync(`${repositoryRoot}docs/r2-cors.example.json`, "utf8")) as {
      rules: Array<{ allowed: { headers?: string[]; methods: string[] } }>;
    };
    const allowed = policy.rules.flatMap((rule) => rule.allowed.headers ?? []);

    expect(policy.rules.flatMap((rule) => rule.allowed.methods)).toContain(target.method);
    expect(allowed.map((header) => header.toLowerCase()).sort())
      .toEqual(Object.keys(target.headers).map((header) => header.toLowerCase()).sort());
  });

  it("says what each answer is for", () => {
    // A prompt showing only a name leaves an operator guessing at a value that
    // cannot be changed later without cost.
    const undescribed = exampleSecretNames().filter(
      (name) => !describedBindingNames().includes(name),
    );

    expect(undescribed).toEqual([]);
  });
});
