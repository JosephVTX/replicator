import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path where all mutable state lives (volume mount in production). */
export const DATA_DIR = path.resolve(env.DATA_DIR);

export const PATHS = {
  data: DATA_DIR,
  db: path.join(DATA_DIR, "replicator.db"),
  replicas: path.join(DATA_DIR, "replicas"),
  builds: path.join(DATA_DIR, "builds"),
  uploads: path.join(DATA_DIR, "uploads"),
  logs: path.join(DATA_DIR, "logs"),
  skillWorkspace: env.SKILL_WS ? path.resolve(env.SKILL_WS) : path.join(DATA_DIR, "skill-ws"),
  opencodeHome: path.join(DATA_DIR, "opencode"),
  /** Where the bundled templates + skill scripts live inside the app. */
  templates: path.resolve(here, "../../../templates"),
  agentSkill: path.resolve(here, "../../../packages/agent-skill"),
} as const;

export function ensureDirs(): void {
  for (const dir of [
    PATHS.data,
    PATHS.replicas,
    PATHS.builds,
    PATHS.uploads,
    PATHS.logs,
    PATHS.skillWorkspace,
    PATHS.opencodeHome,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function replicaDir(replicaId: string): string {
  return path.join(PATHS.replicas, replicaId);
}

/** Each UI-kit variant is its own React project so they can diverge independently. */
export function variantProjectDir(replicaId: string, uiKit: string): string {
  return path.join(PATHS.replicas, replicaId, uiKit);
}

export function variantBuildDir(replicaId: string, uiKit: string): string {
  // Built inside the project so the agent's own `vite build` lands where the
  // platform serves the preview from.
  return path.join(variantProjectDir(replicaId, uiKit), "dist");
}
