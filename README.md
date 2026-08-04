<p align="center">
  <picture>
    <!-- The mark takes its deer from `currentColor`, and an <img> has nothing
         to inherit it from -- so each file states the colour it is for, and
         GitHub picks by the reader's own theme. -->
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-mark-dark.svg">
    <img src="assets/logo-mark-light.svg" alt="" width="140" height="140">
  </picture>
</p>

<h1 align="center">Axis Repository</h1>

<p align="center">
  <b>A lightweight, multi-format artifact repository built on the edge.</b>
</p>

<p align="center">
  <a href="#"><img alt="Status: experimental" src="https://img.shields.io/badge/status-experimental-orange"></a>
  <a href="#"><img alt="Development: active" src="https://img.shields.io/badge/development-active-blue"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue"></a>
</p>

<p align="center">
  <a href="docs/plugin-authoring.md">Plugin authoring</a> ·
  <a href="docs/release.md">Release process</a> ·
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/sakkyoi/axis-repository">
    <img alt="Deploy to Cloudflare" src="https://deploy.workers.cloudflare.com/button" height="32">
  </a>
</p>

---

Bring packages and build artifacts from multiple ecosystems into one place.

Axis Repository is a lightweight, multi-format artifact repository designed to run at the edge — one deployment you own, instead of a separate registry for each package ecosystem.

> [!WARNING]
> Axis Repository is under active development. Do not rely on it as a production artifact source yet.

## Formats

- **apt** — publish `.deb` packages and install them with `apt`, from signed
  indexes it verifies.
- **PyPI** — publish wheels and source distributions and install them with
  `pip`.

A format is a plugin. Writing another one is documented in
[docs/plugin-authoring.md](docs/plugin-authoring.md).

## Deploy

Axis supports two Cloudflare deployment paths. The Deploy Button is the
recommended path because it creates the Cloudflare resources and prompts for the
required deployment values in one flow. A local checkout can deploy the same
Worker with Wrangler when you want to control the Cloudflare project setup
yourself.

### Deploy Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sakkyoi/axis-repository)

The button creates the Worker, Durable Object, and R2 bucket, then asks for the
values the deployment cannot safely invent.

Prepare these before deploying:

- First owner credentials: `AXIS_ADMIN_USERNAME` and `AXIS_ADMIN_PASSWORD`.
- Long random secrets for `AXIS_SESSION_SECRET`, `TOKEN_HASH_PEPPER`, and
  `SIGNING_KEY_ENCRYPTION_SECRET`.
- R2 upload settings when using the default `UPLOAD_BACKEND=r2`:
  `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and
  `R2_SECRET_ACCESS_KEY`.

Generate secrets with a command such as:

```bash
openssl rand -hex 32
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
same secrets:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is for local development only. The Deploy Button uses
`.dev.vars.example` to know which secret prompts to show, but a local
`wrangler deploy` does not upload `.dev.vars` as Worker secrets. For local
Wrangler deploys, set the target Worker's secrets with Wrangler and keep
non-secret values in `wrangler.jsonc`.

Set secrets one at a time:

```bash
pnpm wrangler secret put AXIS_ADMIN_PASSWORD
pnpm wrangler secret put AXIS_SESSION_SECRET
pnpm wrangler secret put TOKEN_HASH_PEPPER
pnpm wrangler secret put SIGNING_KEY_ENCRYPTION_SECRET
pnpm wrangler secret put R2_ACCESS_KEY_ID
pnpm wrangler secret put R2_SECRET_ACCESS_KEY
```

Or upload them from a file:

```bash
pnpm wrangler secret bulk .dev.vars
```

Wrangler also accepts a secrets file during deploy:

```bash
pnpm wrangler deploy --secrets-file .dev.vars
```

Use a separate deployment secrets file if your local `.dev.vars` contains
development-only values. Non-secret values such as `AXIS_ADMIN_USERNAME`,
`UPLOAD_BACKEND`, `R2_BUCKET_NAME`, and `R2_ACCOUNT_ID` belong in
`wrangler.jsonc` or the target Worker's variables.

`R2_BUCKET_NAME` must match the bucket bound to `AXIS_OBJECTS`. The R2 access
key should have object read and write access to that bucket; it is used only to
sign direct upload and download URLs.

After the first successful sign-in, remove the bootstrap password from the
deployment. The seeded admin account no longer reads it, and leaving it in the
deployment keeps the original password visible to anyone who can inspect the
configuration.

### Local Wrangler Deploy

Use a local checkout when you want to review or customize the Cloudflare setup
before deploying:

```bash
pnpm install
pnpm deploy
```

Wrangler reads `wrangler.jsonc`, builds the admin UI, bundles the Worker, and
deploys using your local Cloudflare authentication. The same deployment values
listed above are still required; provide them as Wrangler vars or secrets for
the target Worker.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts a single Vite dev server with the Worker running in the
Cloudflare Workers runtime behind the same origin. The console reloads as you
edit it, and `/admin`, `/api`, `/repositories`, and `/health` are handled by the
Worker.

To expose the dev server on your LAN, pass Vite arguments directly:

```bash
pnpm dev --host 0.0.0.0
```

Use the verification commands before opening a pull request:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The root dev server is the maintained local development entry point. For
low-level Worker debugging, run Wrangler directly with the root
`wrangler.jsonc`.

## License

[AGPL-3.0-only](LICENSE).
