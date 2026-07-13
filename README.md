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
