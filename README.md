# Axis Repository

[![Status: Experimental](https://img.shields.io/badge/status-experimental-orange)](#)
[![Development: Active](https://img.shields.io/badge/development-active-blue)](#)

<p align="center">
  <img src="assets/logo-mark.svg" alt="Axis Repository" width="96" height="96" />
</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sakkyoi/axis-repository)

Axis Repository is a multi-format artifact repository. The current implementation includes a Cloudflare Worker API spine and Durable Object-backed state.

> Axis Repository is under active development. Do not use it as a production artifact source yet.

## Local Checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Plugin Development

Repository format plugins are documented in [docs/plugin-authoring.md](docs/plugin-authoring.md).

## Local Worker

Axis uses the root `wrangler.jsonc` as the Cloudflare Worker configuration for
local development, dry runs, and deploys. For the Durable Object-backed local
worker, local Wrangler variables belong in root `.dev.vars`. This file contains
local secrets and must not be committed.

For normal local development, use Wrangler's local R2 binding:

```text
AXIS_ADMIN_USERNAME=admin
AXIS_ADMIN_PASSWORD=admin-local-password
AXIS_SESSION_SECRET=local-dev-session-secret
TOKEN_HASH_PEPPER=local-dev-pepper
SIGNING_KEY_ENCRYPTION_SECRET=local-dev-signing-secret
UPLOAD_BACKEND=local-r2
```

`AXIS_ADMIN_USERNAME` and `AXIS_ADMIN_PASSWORD` or
`AXIS_ADMIN_PASSWORD_HASH` are bootstrap inputs for the first owner user. After
the owner user has been seeded into state, the bootstrap password secret can be
removed. Keep `AXIS_SESSION_SECRET`; it is still required to sign and verify
admin sessions. `AXIS_ADMIN_PASSWORD` must be at least 8 characters; a shorter
one fails the first sign-in rather than seeding an account nobody can use.

An admin session is held by an `axis_admin_refresh` cookie, which the browser
exchanges for a short-lived access token on every page load. The cookie is
marked `Secure` only when the request itself arrived over HTTPS: a browser
silently discards a `Secure` cookie served from an `http://` origin, so
marking it unconditionally would make signing in over `http://<host>:8787`
appear to work and then drop you back to the login screen on the next reload.
Deployments are served over HTTPS and keep the flag.

Admin passwords are stored with PBKDF2-HMAC-SHA256 using a per-user salt, and
the iteration count is embedded in the stored hash so it can be raised later
without invalidating existing passwords. `AXIS_ADMIN_PASSWORD_HASH` accepts
either a `pbkdf2-sha256$<iterations>$<salt>$<key>` value or the older
`sha256:<hex>` form. Accounts seeded under the older form keep working and are
rewritten to PBKDF2 on the owner's next successful sign-in.

`UPLOAD_BACKEND=local-r2` creates same-origin `PUT` upload URLs and stores
uploaded artifacts through the Worker `AXIS_OBJECTS` R2 binding. Under
`wrangler dev --local`, Wrangler keeps this R2 state in local development state
instead of using production R2.

For deployed or remote R2 uploads, use presigned R2 upload mode:

```text
AXIS_ADMIN_USERNAME=admin
AXIS_ADMIN_PASSWORD_HASH=sha256:<password-hash>
AXIS_SESSION_SECRET=<random-session-secret>
TOKEN_HASH_PEPPER=local-dev-pepper
SIGNING_KEY_ENCRYPTION_SECRET=local-dev-signing-secret
UPLOAD_BACKEND=r2
R2_ACCOUNT_ID=<account-id>
R2_BUCKET_NAME=axis-repository
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
UPLOAD_URL_TTL_SECONDS=900
```

When `UPLOAD_BACKEND` is unset, Axis uses `r2`, which is what a deployment
wants: a presigned URL sends artifact bytes straight to the bucket. Everything
else goes through a single Durable Object, which is billed for as long as it
holds the request and caps an artifact at what fits in memory, so routing
uploads through it costs the most on exactly the largest files.

`local-r2` exists because presigned URLs are signed against the real R2
endpoint, which `wrangler dev --local` does not serve. It is the local answer,
not a smaller deployment: both modes store through the same `AXIS_OBJECTS`
bucket and both serve reads through it. They differ in how bytes get in.

Both hash what was stored and refuse a mismatch. Under `r2` that is the one
point where a presigned upload's bytes pass through the Worker, and it is not
optional: the digest is signed into the upload URL but nothing binds it to the
body, and R2 validates no full-object SHA-256 on `PutObject`, so an unhashed
upload would be published under a digest it does not have. The read is from R2
rather than over the network and is hashed as it streams.

For pure local development without Wrangler R2, use memory upload mode:

```text
AXIS_ADMIN_USERNAME=admin
AXIS_ADMIN_PASSWORD=admin-local-password
AXIS_SESSION_SECRET=local-dev-session-secret
TOKEN_HASH_PEPPER=local-dev-pepper
SIGNING_KEY_ENCRYPTION_SECRET=local-dev-signing-secret
UPLOAD_BACKEND=memory
```

Warning: `UPLOAD_BACKEND=memory` is only for local development. It does not
persist uploaded bytes across worker restarts. It stores uploads in memory and
verifies the uploaded bytes against the publish session's expected size and
SHA-256. Do not use it as a deployed artifact storage backend.

Start the local worker after choosing one of the `.dev.vars` blocks above:

```bash
pnpm dev:worker
```

The `--local` flag keeps Worker bindings local. With `UPLOAD_BACKEND=local-r2`,
uploads go through the Worker and land in Wrangler's local `AXIS_OBJECTS` R2
state.

Testing `UPLOAD_BACKEND=r2` needs more, because a presigned URL is signed
against the real R2 endpoint: the upload lands in the real bucket, while a
`--local` binding reads Wrangler's own state, and verification finds nothing.
Mark the binding remote so both halves address the same bucket, and drop
`--local`, which turns every remote binding back off:

```jsonc
// wrangler.jsonc
"r2_buckets": [
  { "binding": "AXIS_OBJECTS", "bucket_name": "axis-repository", "remote": true }
]
```

```bash
wrangler dev
```

The Worker still runs locally; only that binding is answered by the deployed
bucket, which means real objects and real storage charges. Wrangler prints
`remote` beside the binding when this is in effect.

Log in to get a short-lived admin access token:

```bash
ACCESS_TOKEN="$(
  curl -s -X POST http://localhost:8787/admin/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin-local-password"}' \
    | jq -r .accessToken
)"
```

Create a repository with the admin access token:

```bash
curl -X POST http://localhost:8787/admin/repositories \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"debian-internal","ecosystem":"apt"}'
```

After creating a publish token and publish session, upload each artifact to the
returned `PUT` URL.

For `UPLOAD_BACKEND=local-r2` or `UPLOAD_BACKEND=memory`, the returned URL is
same-origin:

```bash
curl -X PUT "http://localhost:8787/api/uploads/<session-id>/<upload-id>" \
  -H "Content-Type: application/vnd.debian.binary-package" \
  --data-binary @artifact.deb
```

For `UPLOAD_BACKEND=r2`, the returned URL is a presigned R2 URL. Upload with the
returned `PUT` URL and headers:

```bash
curl -X PUT "<presigned-url>" \
  -H "Content-Type: application/vnd.debian.binary-package" \
  -H "x-amz-meta-axis-sha256: <sha256>" \
  -H "x-amz-meta-axis-upload-id: <upload-id>" \
  --data-binary @artifact.deb
```

Then verify the uploaded object:

```bash
curl -X POST "http://localhost:8787/api/publish-sessions/<session-id>/uploads/<upload-id>/verify" \
  -H "Authorization: Bearer <publish-token>"
```

After every artifact in the session is verified, finalize the publish session:

```bash
curl -X POST "http://localhost:8787/api/publish-sessions/<session-id>/finalize" \
  -H "Authorization: Bearer <publish-token>"
```

This phase writes generic publish manifests such as:

```text
repositories/<repository-name>/publishes/<session-id>.json
```

Format-specific repository indexes and repository heads for apt, PyPI, and npm
are future publishers.

## APT Repository Configuration

An apt repository is configured under `config.apt`. Creating one through the
admin UI asks for the codename, the suites, and the signing key; the rest are
optional and editable in the repository's APT settings section, or through
`PATCH /admin/repositories/<name>` with a `config` object.

| Field | Type | Effect |
| --- | --- | --- |
| `codename` | string | Required. The directory under `dists/`, and where a publish goes when it names no suite. |
| `suites` | string[] | Every suite this repository publishes. Must contain `codename`. See below. |
| `signingKeyId` | string | Required. Set when the repository is created. |
| `components` | string[] | Allowed components; defaults to `["main"]`. A publish naming any other component is rejected. |
| `architectures` | string[] | Pins the architectures in `Release`. Left unset, they are discovered from what has been published. |
| `origin`, `label` | string | `Origin:` and `Label:`; both default to the repository name. |
| `suite` | string | `Suite:` when it differs from the codename, as in `stable` vs `bookworm`. |
| `description` | string | `Description:` in `Release`. |
| `validityDays` | number | Emits `Valid-Until:` that many days after each publish. |
| `notAutomatic` | boolean | `NotAutomatic: yes`, so apt will not upgrade into this suite unless asked. |
| `butAutomaticUpgrades` | boolean | `ButAutomaticUpgrades: yes`. Rejected without `notAutomatic`, which apt would silently ignore. |
| `acquireByHash` | boolean | Defaults to true. See below. |

Set `validityDays` if the repository is reachable from outside your network.
Without `Valid-Until`, a signed `Release` is trusted forever, so anyone able to
serve stale bytes can hold a client on a package set whose vulnerabilities are
already fixed.

Setting it does not oblige you to keep publishing. A timer inside the Durable
Object re-signs `Release` once its window is half gone, so a suite nobody has
published to stays valid rather than taking itself offline — apt refuses an
expired `Release` outright, and it would refuse the whole repository, not just
the stale package. Renewal regenerates the indexes from what is already
published, and they come out byte-identical, so their `by-hash` entries do not
churn and no client re-downloads anything; only `Release`, `InRelease` and
`Release.gpg` change.

The timer arms itself when the object starts and re-arms after every pass, so
it survives eviction and cannot be ended by one failed run. A repository whose
signing key has been revoked is logged and skipped rather than stopping the
others.

Free-text fields reject control characters. A newline in `Origin` would
otherwise start a new `Release` field.

### Source Packages And Installer Packages

A publish session can carry more than binary packages. What a file is, is
decided by its name:

| Name | Where it goes |
| --- | --- |
| `*.deb` | `<component>/binary-<arch>/Packages` |
| `*.udeb` | `<component>/debian-installer/binary-<arch>/Packages` |
| `*.dsc` | `<component>/source/Sources` |
| `*.tar.{gz,xz,bz2,zst,lzma}`, `*.diff.gz` | the pool, named by the `.dsc` |

Source packages are published by uploading the `.dsc` together with the
tarballs it names, into the same session. The `.dsc` is authoritative: the
`Sources` stanza is derived from it, `Directory:` points at
`pool/<component>/<source>/`, and the `.dsc` is added to every checksum list
because it describes the other files but never itself.

Every file a `.dsc` names must be reachable, either uploaded in the same
session or already in the pool. That second case is the usual Debian workflow:
a new revision ships only a `.debian.tar` and reuses the `.orig.tar` already
published. A `.dsc` whose files are missing is rejected rather than published,
because it would advertise a source package apt cannot fetch.

The `apt/source` and `apt/install` helpers return `sourcePackageLines`, the
`deb-src` counterpart of `sourceLines`.

### Index Compression

`Packages`, `Sources` and `Translation-en` are each published twice: plain and
gzip. apt takes the gzip form. `Contents` is published gzip-only — see below.

A zstd form was published here too, and was removed. Two measurements settled
it. apt does not pick the smallest variant: it walks
`Acquire::CompressionTypes` in the order those are declared, which upstream
sets to `xz, bz2, lzma, gz, lz4, zst`, so a default client asks for
`Packages.gz` and never for `Packages.zst` — verified against apt 3.2.0, which
only fetched the zstd form once `Acquire::CompressionTypes::Order "zst"` was
set on the client. And producing it cost more CPU than everything else in a
publish combined: at level 19 a 3 MiB index took about 1.8 seconds, against
34 ms for gzip and 40 ms for all three checksums, multiplied by every index in
every component, architecture and suite. Paying that on every publish, for a
file almost no client fetches, was the wrong trade.

### Contents Indexes

Each component publishes `dists/<suite>/<component>/Contents-<arch>.gz`, which
maps every installed path to the packages that own it. That is what backs
`apt-file search`.

The file list is read out of a package's data archive while the upload is
already in memory for control parsing, so publishing does not download anything
twice. `gzip`, `xz`, `zstd` and uncompressed data archives are all read; zstd
matters because dpkg now defaults to it.

Only the gzip form is published. `Contents` names every path of every package,
so it is the one index that can dwarf what it describes, and no client asks for
the plain form.

Entries survive for packages a publish does not touch, and are replaced
wholesale for a package published again — a new version installs a different
set of files. Rebuilding drops the entries of packages that are no longer in
the pool.

### Several Suites In One Repository

List them in `suites` to serve, say, `noble` and `jammy` from one repository:

```json
{ "config": { "apt": { "codename": "noble", "suites": ["noble", "jammy"] } } }
```

Each suite gets its own `dists/<suite>/` tree with its own signed `Release`,
all signed by the repository's one key. The pool is shared: a `.deb` published
to both suites is stored once and referenced from both indexes.

A publish chooses its suite with the `suite` artifact metadata field, the same
way `component` works, and defaults to `codename`. Publishing to a suite the
repository does not list is rejected.

`suite` (singular) overrides the `Suite:` field for a repository publishing one
suite — `stable` for a repository whose codename is `bookworm`, say. It is
rejected alongside more than one entry in `suites`, where it would publish
several suites all claiming to be the same one.

The `apt/source` and `apt/install` helpers return `sourceLines` with one entry
per suite; `sourceLine` remains the default suite alone.

### Acquire-By-Hash

Indexes are published a second time under their own content hash, at
`dists/<codename>/<component>/binary-<arch>/by-hash/SHA256/<digest>` (and
`SHA512`). A client that reads `Release` and then fetches `Packages` can
otherwise be handed a newer index than the one its `Release` describes and
reject the mismatch; fetching by hash removes that race.

Each publish keeps the current generation and the one named by the `Release` it
replaced, so a client that read the old `Release` can still complete. Older
generations are deleted, which bounds the storage this costs. Set
`acquireByHash` to `false` to publish only the plain index paths.

## Serving Artifacts From A Separate Origin

By default one origin serves everything: the admin UI at `/ui/`, the API under
`/admin` and `/api`, and repository objects under `/repositories`. Repository
objects are publisher-controlled bytes with a publisher-chosen content type, so
sharing an origin with the admin UI means any future injection there could reach
them as a same-origin resource. The nonce-only script policy closes the paths
that are reachable today, but the origin boundary is the durable fix.

Set `AXIS_ARTIFACT_ORIGIN` to a bare origin to split them:

```text
AXIS_ARTIFACT_ORIGIN=https://cdn.example
```

Point that hostname at the same Worker. Once set:

- `/repositories/...` is served **only** on that origin; the admin origin
  answers 404 for it.
- `/ui/`, `/admin/...`, and `/api/...` are served **only** on the admin origin.
- `/health` answers on both.
- Generated client instructions follow it: the apt `sources.list` line, the
  signing key URL, and the PyPI index URL all name the artifact origin, even
  when requested through the admin UI.

Leave it unset and nothing changes.

Turning it on breaks existing **consumers**, not existing **data**. Published
metadata contains no absolute URLs — `Packages` records `Filename:` as a
repository-relative path and `Release` lists relative paths — so every stored
object, index, and signature stays valid and nothing needs republishing. What
breaks is the hostname written into each client's configuration: an
already-deployed `sources.list` entry or pip index URL names the old origin,
which now answers 404 for `/repositories`. Plan the switch alongside updating
whatever consumes the repository.

## Upload URLs Are Capabilities

An upload target returned when a publish session is created is a bearer
capability: anyone holding the URL can write those bytes. Revoking the publish
token does not invalidate an already-issued presigned URL, because the signature
is verified by the storage provider, not by Axis.

Two things bound the exposure. The URL is only ever returned once, from the
create response — every later response that echoes the session, including
verify, finalize, and the activity timeline, omits it — and its expiry is
capped to the remaining lifetime of the publish session
(`UPLOAD_URL_TTL_SECONDS` can shorten it further, never extend it). A stale URL
also only reaches the staging area, never the repository: finalizing still
requires a live token, and every upload is checked against the size and SHA-256
the session declared.

## Admin UI API Base URL

`ADMIN_UI_API_BASE_URL` is injected into the admin UI shell and used as the API
base for admin requests. It must resolve to the **same origin** that serves the
admin UI; a path prefix such as `/axis` is the intended use, for deployments
behind a reverse proxy that mounts Axis under a subpath.

Axis deliberately emits no `Access-Control-Allow-Origin` headers, so pointing
this at a different origin does not work in a browser. Leave it unset for a
normal deployment.

The admin UI is served under a nonce-only `script-src` with `strict-dynamic`,
which requires a browser supporting CSP level 3 (Chrome 52+, Firefox 52+,
Safari 15.4+). There is no host-source fallback on purpose: repository objects
are served from the same origin with a publisher-chosen content type, so
allowing `'self'` would let an uploaded artifact be loaded as a script.

Cloudflare deploy configuration lives in root `wrangler.jsonc`. Keep local
secrets in root `.dev.vars`.

`.dev.vars.example` lists the secrets a deployment cannot run without, and is
what the Deploy to Cloudflare button reads to know what to ask for. Each one is
described in `package.json` under `cloudflare.bindings`, which is the text shown
beside the field during setup. A secret added to the worker belongs in both:
without the example entry nobody is asked for it, and without the description
they are asked for a name with no indication of what to put there.
