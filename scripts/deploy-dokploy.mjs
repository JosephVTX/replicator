#!/usr/bin/env node
// One-shot Dokploy deployment for Replicator.
//
//   GIT_URL=git@github.com:you/replicate.git \
//   DOMAIN=replicate.129.146.63.224.sslip.io \
//   ENV_FILE=deploy.env \
//   node scripts/deploy-dokploy.mjs
//
// Credentials are read from $DOKPLOY_URL / $DOKPLOY_API_KEY or from
// ~/.config/opencode/dokploy.env. The script is idempotent: it reuses an existing
// project / application with the same name instead of creating duplicates.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadCreds() {
  let url = process.env.DOKPLOY_URL;
  let key = process.env.DOKPLOY_API_KEY;
  if (!url || !key) {
    const file = path.join(os.homedir(), ".config", "opencode", "dokploy.env");
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        if (m[1] === "DOKPLOY_URL" && !url) url = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "DOKPLOY_API_KEY" && !key) key = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  if (!url || !key) throw new Error("DOKPLOY_URL / DOKPLOY_API_KEY not found");
  return { url: url.replace(/\/$/, ""), key };
}

const { url: BASE, key: API_KEY } = loadCreds();
const PROJECT_NAME = process.env.PROJECT_NAME ?? "replicate";
const APP_NAME = process.env.APP_NAME ?? "replicator";
const ENV_NAME = process.env.ENV_NAME ?? "production";
const GIT_URL = process.env.GIT_URL;
const GIT_BRANCH = process.env.GIT_BRANCH ?? "main";
const DOMAIN = process.env.DOMAIN ?? "replicate.129.146.63.224.sslip.io";
const PORT = Number(process.env.APP_PORT ?? 3000);
const ENV_FILE = process.env.ENV_FILE;

async function api(pathname, { method = "POST", body } = {}) {
  const res = await fetch(`${BASE}/api${pathname}`, {
    method,
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return data;
}

function readEnvFile(file) {
  if (!file || !fs.existsSync(file)) return "";
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .join("\n");
}

async function main() {
  console.log(`→ Dokploy: ${BASE}`);

  if (!GIT_URL) {
    throw new Error("GIT_URL is required (the repository Dokploy should build from)");
  }

  const projects = await api("/project.all", { method: "GET" });
  let project = projects.find((p) => p.name === PROJECT_NAME);
  if (!project) {
    console.log(`· creating project "${PROJECT_NAME}"`);
    project = await api("/project.create", {
      body: { name: PROJECT_NAME, description: "Pixel-perfect web UI replicator" },
    });
  } else {
    console.log(`· reusing project "${PROJECT_NAME}"`);
  }

  const environments = await api(`/environment.byProjectId?projectId=${project.projectId}`, { method: "GET" });
  let environment = environments.find((e) => e.name === ENV_NAME);
  if (!environment) {
    console.log(`· creating environment "${ENV_NAME}"`);
    environment = await api("/environment.create", { body: { projectId: project.projectId, name: ENV_NAME } });
  }

  const apps = await api(`/application.byProjectId?projectId=${project.projectId}`, { method: "GET" }).catch(() => []);
  let app = (apps ?? []).find((a) => a.name === APP_NAME);
  if (!app) {
    console.log(`· creating application "${APP_NAME}"`);
    app = await api("/application.create", {
      body: {
        name: APP_NAME,
        appName: APP_NAME,
        description: "Replicator server + panel",
        environmentId: environment.environmentId,
      },
    });
  } else {
    console.log(`· reusing application "${APP_NAME}"`);
  }
  const applicationId = app.applicationId;

  await api("/application.saveGitProvider", {
    body: {
      applicationId,
      customGitUrl: GIT_URL,
      customGitBranch: GIT_BRANCH,
      customGitBuildPath: "/",
      watchPaths: [],
    },
  });

  await api("/application.saveBuildType", {
    body: {
      applicationId,
      buildType: "dockerfile",
      dockerfile: "Dockerfile",
      dockerContextPath: ".",
      dockerBuildStage: "",
    },
  });

  const env = readEnvFile(ENV_FILE);
  if (env) {
    await api("/application.saveEnvironment", {
      body: { applicationId, env, buildArgs: "", buildSecrets: "", createEnvFile: true },
    });
    console.log(`· applied environment from ${ENV_FILE}`);
  }

  await api("/domain.create", {
    body: {
      host: DOMAIN,
      path: "/",
      port: PORT,
      https: true,
      certificateType: "letsencrypt",
      applicationId,
    },
  }).catch((err) => console.log(`· domain note: ${err.message}`));

  console.log("· triggering deploy…");
  await api("/application.deploy", { body: { applicationId } });

  console.log("\n✔ Deployment started.");
  console.log(`   App id : ${applicationId}`);
  console.log(`   URL    : https://${DOMAIN}`);
  console.log("   Track progress in the Dokploy UI (Deployments tab).");
}

main().catch((err) => {
  console.error("\n✖ Deployment failed:", err.message);
  process.exit(1);
});
