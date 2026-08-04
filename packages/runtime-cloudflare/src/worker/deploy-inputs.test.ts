import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { R2PresignedUploadBroker } from "../uploads/r2-upload-broker";

/**
 * What a deployment is asked for, and what it is told about each answer.
 *
 * Deploy to Cloudflare asks for two things and shows them differently: the
 * secrets in `.dev.vars.example`, masked, and the `vars` in `wrangler.jsonc`,
 * in the clear. `cloudflare.bindings` in `package.json` supplies the text
 * beside each field. None of the three is reachable from the worker's own
 * code, so a value added to the runtime rots them silently: nobody is asked for
 * it, and the deploy fails on something its operator was never told existed.
 *
 * Which side a value falls on is the point rather than a detail. Masked, a
 * value cannot be proofread against the resource it names; in the clear, a
 * credential is read over the shoulder of whoever deploys.
 */

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function exampleSecretNames(): string[] {
  const text = readFileSync(`${repositoryRoot}.dev.vars.example`, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => line.split("=")[0]?.trim() ?? "");
}

function wranglerVars(): Record<string, string> {
  const text = readFileSync(`${repositoryRoot}wrangler.jsonc`, "utf8");
  const block = /"vars"\s*:\s*\{([^}]*)\}/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)].map(([, name, value]) => [name, value]),
  );
}

/** Everything a deployment is prompted for, however it is shown. */
function promptedNames(): string[] {
  return [...exampleSecretNames(), ...Object.keys(wranglerVars())];
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
    expect(promptedNames()).toEqual(
      expect.arrayContaining([
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        // Asked for rather than fixed: deploying may rename the bucket, and a
        // constant would go on naming the old one while the binding followed
        // the new.
        "R2_BUCKET_NAME",
      ]),
    );
  });

  it("masks what is a credential and shows what is not", () => {
    // The split is the whole point of having two places to declare a value.
    // Masked, the bucket name cannot be checked against the bucket it has to
    // match -- and a field nobody can proofread is one nobody proofreads. In
    // the clear, a key is read by whoever is watching the screen.
    expect(exampleSecretNames().sort()).toEqual([
      "AXIS_ADMIN_PASSWORD",
      "AXIS_SESSION_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "SIGNING_KEY_ENCRYPTION_SECRET",
      "TOKEN_HASH_PEPPER",
    ].sort());
  });

  it("suggests no value for the ones that name a resource", () => {
    // A default that looks plausible is a default nobody edits, and these name
    // resources rather than expressing a preference: filled in with the wrong
    // bucket, reads keep working through the binding while every upload and
    // download addresses somewhere else. A deployment did exactly that.
    const vars = wranglerVars();

    expect(vars.R2_BUCKET_NAME).toBe("");
    expect(vars.R2_ACCOUNT_ID).toBe("");
  });

  it("suggests a value for the ones that express a preference", () => {
    // Unlike a resource name, a wrong guess here is visible immediately and
    // costs nothing to correct, and leaving them blank asks every deployment
    // to make a decision it has no basis for yet.
    const vars = wranglerVars();

    expect(vars.UPLOAD_BACKEND).toBe("r2");
    expect(vars.AXIS_ADMIN_USERNAME).not.toBe("");
  });

  it("does not ask for the same name twice", () => {
    // A value given in both places is a value that can disagree with itself,
    // and the one that wins is not the one the form showed.
    const seen = promptedNames();

    expect(seen).toHaveLength(new Set(seen).size);
  });

  it("asks for a first account, there being no other way to make one", () => {
    // Without a bootstrap owner nothing seeds an admin, and the deployment
    // comes up with no credentials that work.
    expect(promptedNames()).toEqual(
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
    const undescribed = promptedNames().filter(
      (name) => !describedBindingNames().includes(name),
    );

    expect(undescribed).toEqual([]);
  });
});
