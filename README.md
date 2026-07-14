# Axis Repository

Axis Repository is a multi-format artifact repository. The current implementation includes a Cloudflare Worker API spine and Durable Object-backed state.

## Local Checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Local Worker

Copy the example Wrangler configuration:

```bash
cp packages/runtime-cloudflare/wrangler.example.toml packages/runtime-cloudflare/wrangler.toml
```

For the Durable Object-backed local worker, local Wrangler variables belong in
`packages/runtime-cloudflare/.dev.vars`. This file contains local secrets and
must not be committed.

For pure local development without R2, use memory upload mode:

```text
ADMIN_TOKEN=admin-local-token
TOKEN_HASH_PEPPER=local-dev-pepper
UPLOAD_BACKEND=memory
```

Warning: `UPLOAD_BACKEND=memory` is only for local development. It does not
store uploaded bytes, and upload verification only echoes/uses the publish
session's expected artifact metadata. Do not use it as a deployed artifact
storage backend.

For real R2 uploads in local development, use R2 upload mode:

```text
ADMIN_TOKEN=admin-local-token
TOKEN_HASH_PEPPER=local-dev-pepper
UPLOAD_BACKEND=r2
R2_ACCOUNT_ID=<account-id>
R2_BUCKET_NAME=axis-repository
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
UPLOAD_URL_TTL_SECONDS=900
```

When `UPLOAD_BACKEND` is unset, Axis uses `r2`.

After creating a publish session, upload each artifact with the returned
`PUT` URL and headers:

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

Start the local worker:

```bash
pnpm dlx wrangler@latest dev --config packages/runtime-cloudflare/wrangler.toml --local
```

Create a repository with an explicit local admin token:

```bash
curl -X POST http://localhost:8787/admin/repositories \
  -H "Authorization: Bearer admin-local-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"debian-internal","ecosystem":"apt"}'
```

`packages/runtime-cloudflare/wrangler.toml` is local-only and should not be committed.
