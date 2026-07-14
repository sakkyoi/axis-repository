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

For the Durable Object-backed local worker, `ADMIN_TOKEN` and `TOKEN_HASH_PEPPER` must be non-empty. Use Wrangler secrets for deploys, or local dev vars according to your Wrangler workflow. Do not commit secrets or a committed secrets file.

For presigned R2 uploads, the Durable Object-backed worker also needs:

```text
AXIS_OBJECTS
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

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
