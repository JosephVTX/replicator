# Deploying Replicator on Dokploy

The platform runs as **one container** (Fastify server + built panel + a child
`opencode serve` + Chromium) behind Dokploy's Traefik, with a persistent volume at
`/data`.

## 0. Prerequisites

- The code must be in a Git repository Dokploy can reach (connect GitHub in
  **Dokploy → Settings → Git** and authorise the repo).
- A domain. With sslip.io you get HTTPS for free:
  `replicate.<SERVER_IP>.sslip.io` (here `replicate.129.146.63.224.sslip.io`).

## 1. Generate secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use the output as `SESSION_SECRET`. Pick a strong `ADMIN_PASSWORD`.

## 2. Configure environment

Create a `deploy.env` (not committed) with:

```dotenv
NODE_ENV=production
PORT=3000
DATA_DIR=/data
SKILL_WS=/opt/skill-ws
PUBLIC_BASE_URL=https://replicate.129.146.63.224.sslip.io
SESSION_SECRET=<long random string>
COOKIE_SECURE=true
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<strong password>
MAX_CONCURRENT_JOBS=2
JOB_TIMEOUT_MS=3600000
```

Provider API keys are **not** set here — you add them in the panel after the first
login (**Settings → OpenRouter → paste key → Import free models → Save**).

## 3. Deploy

### Option A — script (uses the Dokploy API)

```bash
set -a; . ~/.config/opencode/dokploy.env; set +a
GIT_URL=git@github.com:<you>/<repo>.git \
GIT_BRANCH=main \
DOMAIN=replicate.129.146.63.224.sslip.io \
ENV_FILE=deploy.env \
node scripts/deploy-dokploy.mjs
```

It creates (or reuses) the project/environment/application, points it at the repo,
sets a **Dockerfile** build, applies the environment, adds the domain and triggers a
deploy.

### Option B — Dokploy UI

1. **Project → Create Application**, name `replicator`.
2. **Provider**: GitHub → repository + branch `main`.
3. **Build Type**: Dockerfile, path `Dockerfile`, context `.`.
4. **Environment**: paste the contents of `deploy.env`.
5. **Domains**: host `replicate.129.146.63.224.sslip.io`, path `/`, port `3000`,
   HTTPS + Let's Encrypt.
6. **Deploy**.

### Option C — compose

Use `docker-compose.yml` as the Dokploy **Compose** source. Set the same variables in
the compose environment, add the domain in the UI.

## 4. First run

The container builds the panel, installs the skill workspace with Chromium, and on boot
creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Open the domain, sign in,
then:

1. **Settings → OpenRouter**: paste your key, *Import free models*, *Save*.
2. **Settings → Agent**: pick the default (free) model, save.
3. **Replicas → New replica**: paste a dashboard URL, choose shadcn or daisyUI, start.

## 5. Volumes and backups

Everything mutable lives in the `replicator-data` volume mounted at `/data`:
SQLite DB, replica projects (source + `dist/`), version ZIPs, opencode sessions, logs.
Back that volume up.

## Notes

- Ports 3000 (server) and 4096 (opencode, loopback only) are not published; only
  Traefik reaches 3000.
- The first image build downloads Chromium and installs system libraries, so it takes a
  few minutes; later builds are cached.
- To update: push to the branch and press **Deploy** (or re-run the script); the volume
  (and therefore all replicas, sessions and keys) is preserved.
