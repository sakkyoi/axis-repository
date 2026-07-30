#!/usr/bin/env node
/**
 * Checks a deployed Axis Repository against the things only a deployment can
 * settle.
 *
 * The test suite runs against an in-memory object store and Node, so three
 * things it cannot reach stay unproven until this runs:
 *
 *   1. Ranged reads against real R2. Publishing reads a package's control
 *      fields through `bucket.get(key, { range })` rather than downloading it,
 *      and R2's range semantics are only approximated locally.
 *   2. Hashing an R2 body with `crypto.DigestStream`. The worker has it and
 *      Node does not, so every local run takes the other branch.
 *   3. Objects larger than a worker's 128 MB heap. Nothing local is big
 *      enough for buffering to hurt.
 *
 * Each check below fails loudly rather than warning, because a warning about
 * a repository nobody can install from is worth nothing.
 *
 * Usage:
 *   node scripts/verify-deployment.mjs \
 *     --base-url https://axis.example \
 *     --admin-user admin --admin-password '...'
 *
 * Options:
 *   --size-mb N   Size of the large package (default 200, enough to exceed
 *                 the worker heap if anything buffers).
 *   --keep        Leave the scratch repositories behind for inspection.
 */

import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

const options = parseArguments(process.argv.slice(2));
const SUITE = "noble";
const COMPONENT = "main";
const scratch = options.suffix ?? randomUUID().slice(0, 8);
const APT_REPOSITORY = `verify-apt-${scratch}`;
const PYPI_REPOSITORY = `verify-pypi-${scratch}`;

const results = [];
let failed = false;

await main();

async function main() {
  console.log(`Verifying ${options.baseUrl}`);
  console.log(`Scratch repositories: ${APT_REPOSITORY}, ${PYPI_REPOSITORY}\n`);

  const admin = await login();
  try {
    await verifyApt(admin);
    await verifyPypi(admin);
  } catch (error) {
    failed = true;
    console.error(`\nAborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (options.keep) {
      console.log("\nLeaving the scratch repositories in place (--keep).");
    } else {
      await cleanUp(admin);
    }
  }

  console.log("");
  for (const result of results) {
    console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  console.log("");
  process.exit(failed || results.some((result) => !result.ok) ? 1 : 0);
}

function check(name, ok, detail) {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    failed = true;
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ apt -- */

async function verifyApt(admin) {
  console.log("APT");
  await request(admin, "POST", "/admin/repositories", {
    name: APT_REPOSITORY,
    ecosystem: "apt",
    visibility: "public",
    config: { apt: { codename: SUITE, components: [COMPONENT] } },
    provisioning: {
      apt: {
        signingKey: {
          mode: "generate",
          name: "verify",
          userIdName: "Axis Verify",
          userIdEmail: "verify@example.test",
        },
      },
    },
  });

  const repository = await request(admin, "GET", `/admin/repositories/${APT_REPOSITORY}`);
  const token = await createToken(admin, APT_REPOSITORY, [repository.config.apt.signingKeyId]);

  // A package big enough that reading its control fields by downloading it
  // would exhaust the worker heap.
  const bytes = buildDeb({ name: "verify-large", version: "1.0.0", padding: options.sizeMb * 1024 * 1024 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = "verify-large_1.0.0_amd64.deb";
  console.log(`  publishing ${filename} (${(bytes.length / 1024 / 1024).toFixed(0)} MiB)…`);
  // Everything below this asks whether a package too big to hold in a worker
  // survives the round trip. A package that turned out not to be big answers
  // none of it, and answers it in the shape of a pass.
  check(
    "the verification package is as large as it was asked to be",
    bytes.length >= options.sizeMb * 1024 * 1024,
    `${(bytes.length / 1024 / 1024).toFixed(1)} MiB of ${options.sizeMb}`,
  );

  await publishSession({
    token,
    repositoryName: APT_REPOSITORY,
    ecosystem: "apt",
    artifact: {
      filename,
      size: bytes.length,
      sha256,
      contentType: "application/vnd.debian.binary-package",
      metadata: { component: COMPONENT },
    },
    body: bytes,
  });

  const packagesUrl = `${options.baseUrl}/repositories/${APT_REPOSITORY}`
    + `/dists/${SUITE}/${COMPONENT}/binary-amd64/Packages`;
  const packages = await (await fetch(packagesUrl)).text();
  check(
    "control fields read from a large package through ranged reads",
    packages.includes("Package: verify-large") && packages.includes("Version: 1.0.0"),
    packages.includes("Package: verify-large") ? undefined : "stanza missing or unparsed",
  );
  check(
    "index records the digest the upload was verified against",
    packages.includes(`SHA256: ${sha256}`),
  );

  const downloaded = await fetch(
    `${options.baseUrl}/repositories/${APT_REPOSITORY}/pool/${COMPONENT}/verify-large/${filename}`,
  );
  const downloadedHash = createHash("sha256")
    .update(Buffer.from(await downloaded.arrayBuffer()))
    .digest("hex");
  check("a large package is served back byte for byte", downloadedHash === sha256);

  // Reconciling an unindexed pool object is the one path that hashes a stored
  // object, which on the worker means streaming it past crypto.DigestStream.
  console.log("  rebuilding the index from stored objects…");
  // No body: the route does not read one, and an unread request stream is
  // something the dev runtime treats as an error.
  await request(admin, "POST", `/admin/repositories/${APT_REPOSITORY}/artifacts/rebuild-index`);
  const rebuilt = await (await fetch(packagesUrl)).text();
  check(
    "rebuilding hashes a stored package by streaming it",
    rebuilt.includes(`SHA256: ${sha256}`),
    rebuilt.includes("Package: verify-large") ? undefined : "package lost during rebuild",
  );

  const release = await (await fetch(
    `${options.baseUrl}/repositories/${APT_REPOSITORY}/dists/${SUITE}/Release`,
  )).text();
  check(
    "Release names an index for every component and architecture",
    /SHA256:/.test(release) && release.includes(`${COMPONENT}/binary-amd64/Packages`),
  );
}

/* ----------------------------------------------------------------- pypi -- */

async function verifyPypi(admin) {
  console.log("\nPyPI");
  await request(admin, "POST", "/admin/repositories", {
    name: PYPI_REPOSITORY,
    ecosystem: "pypi",
    visibility: "public",
    config: {},
  });
  const token = await createToken(admin, PYPI_REPOSITORY, []);

  const sdist = buildSdist({ name: "axis-verify", version: "1.0.0" });
  const form = new FormData();
  form.set(":action", "file_upload");
  form.set("protocol_version", "1");
  form.set("sha256_digest", createHash("sha256").update(sdist).digest("hex"));
  form.set("content", new File([sdist], "axis_verify-1.0.0.tar.gz"));

  const upload = await fetch(`${options.baseUrl}/repositories/${PYPI_REPOSITORY}/legacy/`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`__token__:${token}`).toString("base64")}` },
    body: form,
  });
  check("twine-shaped upload is accepted", upload.ok, upload.ok ? undefined : `HTTP ${upload.status}`);

  const project = await fetch(`${options.baseUrl}/repositories/${PYPI_REPOSITORY}/simple/axis-verify/`);
  const projectHtml = await project.text();
  check(
    "the project page lists the distribution with its hash",
    projectHtml.includes("axis_verify-1.0.0.tar.gz") && projectHtml.includes("#sha256="),
  );
  check(
    "core metadata is published beside the distribution",
    projectHtml.includes("data-core-metadata="),
  );

  const json = await fetch(`${options.baseUrl}/repositories/${PYPI_REPOSITORY}/simple/axis-verify/`, {
    headers: { accept: "application/vnd.pypi.simple.v1+json" },
  });
  check(
    "the Simple API negotiates JSON",
    (json.headers.get("content-type") ?? "").includes("application/vnd.pypi.simple.v1+json"),
  );
}

/* ------------------------------------------------------------- plumbing -- */

async function login() {
  const response = await fetch(`${options.baseUrl}/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: options.adminUser, password: options.adminPassword }),
  });
  if (!response.ok) {
    throw new Error(`admin login failed: HTTP ${response.status}`);
  }
  return (await response.json()).accessToken;
}

async function request(admin, method, path, body) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${admin}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function createToken(admin, repositoryName, signingKeyIds) {
  const created = await request(admin, "POST", "/admin/publish-tokens", {
    name: `verify-${repositoryName}`,
    repositories: [repositoryName],
    permissions: ["publish"],
    ecosystemScopes: {},
    signingKeyIds,
  });
  const secret = created.secret ?? created.token?.secret;
  if (!secret) {
    throw new Error("publish token response carried no secret");
  }
  return secret;
}

/** The four requests an ordinary publishing client makes. */
async function publishSession({ token, repositoryName, ecosystem, artifact, body }) {
  const created = await fetch(`${options.baseUrl}/api/publish-sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ repositoryName, ecosystem, artifacts: [artifact] }),
  });
  if (!created.ok) {
    throw new Error(`creating a publish session failed: HTTP ${created.status} ${await created.text()}`);
  }
  const session = await created.json();
  const upload = session.uploads[0];

  // Which of the two upload paths this deployment uses, because they share
  // nothing: a presigned URL goes straight to R2 and never meets the worker,
  // while a relative one is relayed by it. A result that does not say which
  // was exercised leaves the other one unverified without saying so.
  const relayed = new URL(upload.url, options.baseUrl).origin === new URL(options.baseUrl).origin;
  console.log(`  upload path: ${relayed ? "relayed through the worker" : "presigned, direct to R2"}`);

  const put = await fetch(new URL(upload.url, options.baseUrl), {
    method: upload.method,
    headers: upload.headers,
    body,
  });
  if (!put.ok) {
    throw new Error(`uploading failed: HTTP ${put.status}`);
  }

  for (const path of [
    `/api/publish-sessions/${session.id}/uploads/${upload.uploadId}/verify`,
    `/api/publish-sessions/${session.id}/finalize`,
  ]) {
    const response = await fetch(`${options.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`${path} failed: HTTP ${response.status} ${await response.text()}`);
    }
  }
}

async function cleanUp(admin) {
  // Both, and the tokens too: deleting a repository does not take the publish
  // token that was made to write to it, so every run used to leave one behind
  // -- credentials accumulating on a deployment, from a script whose whole
  // contract is that it borrows one and gives it back.
  for (const name of [APT_REPOSITORY, PYPI_REPOSITORY]) {
    await remove(admin, `/admin/repositories/${name}`, name);
    await remove(admin, `/admin/publish-tokens/verify-${name}`, `token for ${name}`);
  }
}

async function remove(admin, path, what) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${admin}` },
  });
  if (!response.ok && response.status !== 404) {
    console.warn(`  could not remove ${what}: HTTP ${response.status}`);
  }
}

function parseArguments(argv) {
  const parsed = { sizeMb: 200, keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--base-url") parsed.baseUrl = value?.replace(/\/+$/, "");
    else if (flag === "--admin-user") parsed.adminUser = value;
    else if (flag === "--admin-password") parsed.adminPassword = value;
    else if (flag === "--size-mb") parsed.sizeMb = Number(value);
    else if (flag === "--suffix") parsed.suffix = value;
    else if (flag === "--keep") { parsed.keep = true; continue; }
    else continue;
    index += 1;
  }
  if (!parsed.baseUrl || !parsed.adminUser || !parsed.adminPassword) {
    console.error("Usage: node scripts/verify-deployment.mjs --base-url URL --admin-user USER --admin-password PASS");
    process.exit(2);
  }
  return parsed;
}

/* ------------------------------------------------------------ fixtures -- */

/**
 * A `.deb` whose data archive is padded to the size asked for.
 *
 * The control member stays at the front, so reading it is exactly the ranged
 * read the worker performs — and getting it wrong on a package this size is
 * the failure this script exists to catch.
 */
function buildDeb({ name, version, padding }) {
  const control = [
    `Package: ${name}`,
    `Version: ${version}`,
    "Architecture: amd64",
    "Maintainer: Axis Verify <verify@example.test>",
    "Section: utils",
    `Description: deployment verification package`,
    "",
  ].join("\n");

  const controlTar = gzipSync(tar([{ name: "./control", bytes: Buffer.from(control) }]));
  // Stored, not compressed. The padding is zeroes and gzip turns two hundred
  // megabytes of them into a few hundred kilobytes -- which is how the checks
  // that exist to exceed a worker's heap came to run against a package of no
  // size at all, and pass. Nothing decompresses this member: the worker reads
  // the control archive beside it, so the only property asked of it is that it
  // weighs what it says.
  const dataTar = gzipSync(
    tar([{ name: "./usr/share/axis-verify/payload", bytes: Buffer.alloc(padding) }]),
    { level: 0 },
  );

  return ar([
    { name: "debian-binary", bytes: Buffer.from("2.0\n") },
    { name: "control.tar.gz", bytes: controlTar },
    { name: "data.tar.gz", bytes: dataTar },
  ]);
}

function buildSdist({ name, version }) {

  const metadata = [
    "Metadata-Version: 2.1",
    `Name: ${name}`,
    `Version: ${version}`,
    "Requires-Python: >=3.9",
    "",
    "Deployment verification distribution.",
  ].join("\n");
  return Buffer.from(gzipSync(tar([
    { name: `${name}-${version}/PKG-INFO`, bytes: Buffer.from(metadata) },
    { name: `${name}-${version}/setup.py`, bytes: Buffer.from("# setup\n") },
  ])));
}

function ar(entries) {
  const parts = [Buffer.from("!<arch>\n")];
  for (const entry of entries) {
    const header = `${`${entry.name}/`.padEnd(16)}${"0".padEnd(12)}${"0".padEnd(6)}${"0".padEnd(6)}`
      + `${"100644".padEnd(8)}${String(entry.bytes.length).padEnd(10)}\`\n`;
    parts.push(Buffer.from(header), entry.bytes);
    if (entry.bytes.length % 2) parts.push(Buffer.from("\n"));
  }
  return Buffer.concat(parts);
}

function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100);
    header.write("0000644", 100, 8);
    header.write("0000000", 108, 8);
    header.write("0000000", 116, 8);
    header.write(entry.bytes.length.toString(8).padStart(11, "0"), 124, 12);
    header.write("00000000000", 136, 12);
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1);
    header.write("ustar", 257, 6);
    header.write("00", 263, 2);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    parts.push(header, entry.bytes, Buffer.alloc((512 - (entry.bytes.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
