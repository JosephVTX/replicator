# Replicator

Self-hosted platform that turns any web page — usually a full dashboard — into a
**pixel-perfect React + TailwindCSS** project, published at its own path on your
domain, previewable and downloadable as a ZIP template.

It is an adaptation of the [`replicate-web-ui`](https://github.com/EijunnN/replicate-web-ui)
skill, extended so that a **non-technical admin** can drive it from a web panel, with
**free models only** (OpenRouter free tier, opencode Zen, or any OpenAI-compatible
endpoint) and with **durable context** so a run never loses its place when the model
changes, the session restarts or the container reboots.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                  │
│    /                → admin panel (React SPA)                             │
│    /r/<slug>/<kit>/ → the replicated site, served statically             │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ HTTPS (Traefik / Dokploy)
┌───────────────┴──────────────────────────────────────────────────────────┐
│  Fastify server (single container)                                        │
│   • Argon2id auth + cookie sessions + CSRF + rate limit                   │
│   • SQLite (libSQL) on a volume                                           │
│   • Job queue → agent runner                                              │
│   • Vite build service (shared toolchain, no per-replica install)         │
│   • Spawns and drives `opencode serve` over the SDK                       │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ localhost:4096
┌───────────────┴──────────────────────────────────────────────────────────┐
│  opencode (agent engine)  ·  OpenAI-compatible providers (your keys)      │
│  + Playwright/Chromium for capture, measure and pixel-diff verification   │
└──────────────────────────────────────────────────────────────────────────┘
```

## How a replication works

1. You add a **source URL** and pick a UI kit (**shadcn/ui** or **daisyUI**).
2. A job scaffolds a React + Vite + Tailwind v4 project and writes the agent playbook
   plus two durable memory files (`progress/STATE.json`, `progress/context.md`).
3. The agent runs the skill's phases — **Recon → Map → Extract → Build → Verify → Deliver** —
   using Playwright scripts (`capture`, `css-rules`, `measure`, `verify`, …) and proves the
   result with pixel/element/computed-style diffs until `verify.mjs` returns PASS.
4. The project is built with Vite and served at `/r/<slug>/<kit>/`.
5. Every successful run bumps a **version**; each version is downloadable as a **ZIP template**.
6. If a replica exists in one kit, the panel offers to **port** it to the other kit.

## Why context is never lost

- opencode persists sessions on the volume (`DATA_DIR/opencode`) — a model switch keeps the
  same conversation, and the platform resumes the same session when a job is re-run.
- On top of that, each replica keeps a compact `STATE.json` (phase + per-section status) and a
  short `context.md` (tokens, decisions, gotchas). The agent reads them first and updates them
  after every phase, so even a brand-new session continues exactly where the previous stopped.
- Interrupted jobs are requeued on boot (`recoverInterruptedJobs`).

## Token economy

- Verification loop uses `verify.mjs --changed` (re-checks only failures).
- Captures are cached under `.replica/` and reused across sessions.
- Progress files are intentionally tiny; deep references load on demand.
- opencode's own compaction runs on top of all this.

## Requirements

- Node 20+ and **pnpm 12** for local development.
- Docker for deployment (the image bundles Chromium + the opencode CLI).
- A free model provider key (e.g. OpenRouter).

## Local development

```bash
cp .env.example .env      # then edit SESSION_SECRET / ADMIN_*
pnpm install
pnpm --filter @replicator/web build     # build the panel once
pnpm --filter @replicator/server dev    # http://localhost:3000
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The first boot creates the admin account.

## Configuration

All settings live in environment variables — see [`.env.example`](.env.example). The important
ones: `DATA_DIR` (persistent volume), `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`PUBLIC_BASE_URL`, `MAX_CONCURRENT_JOBS`.

Provider keys and the default model are **not** env vars: an administrator adds them in the
panel (**Settings**). Keys are encrypted at rest with AES-256-GCM (key derived from
`SESSION_SECRET`) and are never returned by the API.

## Deployment (Dokploy)

See [`docs/dokploy.md`](docs/dokploy.md) and `scripts/deploy-dokploy.sh`. In short: point a
Dokploy application at this repository (Dockerfile build), set the environment variables, add a
domain, and deploy. `docker-compose.yml` is provided if you prefer a compose service.

## Security notes

- Passwords: Argon2id. Sessions: opaque random tokens, hashed in the DB, httpOnly + Secure +
  SameSite=Lax cookies. CSRF: per-session token required in `x-csrf-token` on mutations.
  Rate limiting on all routes.
- Provider API keys encrypted at rest; the opencode config that holds them lives on the volume.
- Replicas are private by default and require a session; mark a replica public to expose it.
- The opencode server binds to `127.0.0.1` inside the container only.

## License / ethics

Only replicate pages you have the right to copy. Replicating a commercial template's UI may
infringe its license; the agent is instructed to flag licensing concerns in its final summary.
