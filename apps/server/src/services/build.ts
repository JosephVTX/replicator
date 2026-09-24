import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The server package's own node_modules, used as the shared build toolchain. */
const SHARED_NODE_MODULES = path.resolve(here, "../../node_modules");

/**
 * Replica projects are built against the server's installed dependencies so we do
 * not need a per-replica install. Node/Vite resolve bare imports upwards from the
 * project dir, so a single `node_modules` link makes the whole toolchain reachable.
 */
export function ensureNodeModules(projectDir: string): void {
  const link = path.join(projectDir, "node_modules");
  if (fs.existsSync(link)) return;
  if (!fs.existsSync(SHARED_NODE_MODULES)) return;
  try {
    fs.symlinkSync(SHARED_NODE_MODULES, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    /* If linking fails the build reports a clearer error later. */
  }
}

export interface BuildResult {
  outDir: string;
  fileCount: number;
}

export async function buildReplica(input: {
  projectDir: string;
  outDir: string;
  base?: string;
}): Promise<BuildResult> {
  ensureNodeModules(input.projectDir);
  fs.mkdirSync(input.outDir, { recursive: true });

  const hasOwnConfig =
    fs.existsSync(path.join(input.projectDir, "vite.config.ts")) ||
    fs.existsSync(path.join(input.projectDir, "vite.config.js")) ||
    fs.existsSync(path.join(input.projectDir, "vite.config.mjs"));

  const shared = {
    root: input.projectDir,
    logLevel: "warn" as const,
    mode: "production",
    build: {
      outDir: input.outDir,
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
  };

  // Prefer the project's own vite config (the template ships one, and the agent
  // may edit it). Fall back to an inline config for bare projects.
  if (hasOwnConfig) {
    await build(shared);
  } else {
    await build({
      ...shared,
      configFile: false,
      base: input.base ?? "./",
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": path.join(input.projectDir, "src") } },
    });
  }

  return { outDir: input.outDir, fileCount: countFiles(input.outDir) };
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

export function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
