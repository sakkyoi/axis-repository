# Axis Repository

Axis Repository is a multi-format artifact repository. The current implementation includes a Cloudflare Worker API spine and Durable Object-backed state.

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
ADMIN_TOKEN=admin-local-token
TOKEN_HASH_PEPPER=local-dev-pepper
SIGNING_KEY_ENCRYPTION_SECRET=local-dev-signing-secret
UPLOAD_BACKEND=local-r2
```

`UPLOAD_BACKEND=local-r2` creates same-origin `PUT` upload URLs and stores
uploaded artifacts through the Worker `AXIS_OBJECTS` R2 binding. Under
`wrangler dev --local`, Wrangler keeps this R2 state in local development state
instead of using production R2.

For deployed or remote R2 uploads, use presigned R2 upload mode:

```text
ADMIN_TOKEN=admin-local-token
TOKEN_HASH_PEPPER=local-dev-pepper
SIGNING_KEY_ENCRYPTION_SECRET=local-dev-signing-secret
UPLOAD_BACKEND=r2
R2_ACCOUNT_ID=<account-id>
R2_BUCKET_NAME=axis-repository
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
UPLOAD_URL_TTL_SECONDS=900
```

When `UPLOAD_BACKEND` is unset, Axis uses `r2`.

For pure local development without Wrangler R2, use memory upload mode:

```text
ADMIN_TOKEN=admin-local-token
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
state. With `UPLOAD_BACKEND=r2`, Axis signs presigned `PUT` URLs for real R2
using the `R2_*` credentials above, so end-to-end verification requires the
Worker `AXIS_OBJECTS` binding to read the same R2 bucket that receives the
upload.

Create a repository with an explicit local admin token:

```bash
curl -X POST http://localhost:8787/admin/repositories \
  -H "Authorization: Bearer admin-local-token" \
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

Cloudflare deploy configuration lives in root `wrangler.jsonc`. Keep local
secrets in root `.dev.vars`.
