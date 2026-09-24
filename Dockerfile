# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git bash tini \
    && rm -rf /var/lib/apt/lists/*

# pnpm (project package manager) + opencode CLI (agent engine)
RUN npm install -g pnpm@12.3.4 opencode-ai@1.18.32 \
    && command -v opencode && opencode --version || echo "opencode will fetch its binary on first run"

# ── Skill workspace: Playwright scripts + deps + Chromium, baked into the image ──
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
COPY packages/agent-skill/scripts /opt/skill-ws
RUN cd /opt/skill-ws \
    && pnpm install --reporter=silent \
    && pnpm exec playwright install --with-deps chromium

WORKDIR /app

# ── Application dependencies ─────────────────────────────────────────────────────
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY templates ./templates
RUN pnpm install --reporter=silent

# ── Build the admin panel (served statically by the server) ──────────────────────
RUN pnpm --filter @replicator/web build

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    SKILL_WS=/opt/skill-ws

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "--filter", "@replicator/server", "start"]
