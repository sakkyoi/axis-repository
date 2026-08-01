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

Axis provides a unified, multi-format platform without requiring a separate registry deployment for each package ecosystem. Its serverless architecture simplifies deployment and reduces the infrastructure that needs to be maintained.

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

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sakkyoi/axis-repository)

The button creates the Worker and its R2 bucket, and asks for the first owner's
credentials and the secrets that sign sessions and encrypt repository signing
keys.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

`pnpm dev` starts a single Vite dev server with the Worker running in the
Cloudflare Workers runtime behind the same origin. The console reloads as you
edit it, and `/admin`, `/api`, `/repositories`, and `/health` are handled by the
Worker.

To expose the dev server on your LAN, pass Vite arguments directly:

```bash
pnpm dev --host 0.0.0.0
```

`pnpm dev:worker` and `pnpm dev:ui` remain available for lower-level debugging.

## License

[AGPL-3.0-only](LICENSE).
