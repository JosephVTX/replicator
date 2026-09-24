import fs from "node:fs";
import path from "node:path";
import type { AgentPhase, Replica, ReplicaVariant, UiKit } from "@replicator/shared";
import { env } from "../env.ts";
import { PATHS, variantBuildDir, variantProjectDir } from "../paths.ts";
import { buildReplica, dirSize } from "../services/build.ts";
import {
  addJobEvent,
  bumpVariantVersion,
  createVersionRecord,
  getJob,
  getReplica,
  getVariant,
  setVariantStatus,
  touchReplica,
  updateJob,
} from "../services/replicas.ts";
import { getSetting, setSetting } from "../services/settings.ts";
import { zipDirectory } from "../services/zip.ts";
import { agent, type AgentEvent } from "./opencode.ts";
import {
  buildContinuePrompt,
  buildInitialPrompt,
  buildPortPrompt,
  buildRepairPrompt,
  publicPreviewUrl,
  type PromptContext,
} from "./prompt.ts";

const SCRIPT_PHASE: Array<[RegExp, AgentPhase]> = [
  [/capture\.mjs/, "recon"],
  [/dom-dump\.mjs|behaviour-probe\.mjs|measure\.mjs|icons\.mjs|tokens\.mjs|theme-leak\.mjs/, "map"],
  [/css-rules\.mjs|bundle-modules\.mjs|rsc-refs\.mjs|fingerprint-version\.mjs/, "extract"],
  [/verify\.mjs|compare\.mjs|element-diff\.mjs|dom-diff\.mjs|computed-diff\.mjs|states\.mjs/, "verify"],
];

const PHASE_PROGRESS: Record<AgentPhase, number> = {
  idle: 2,
  recon: 10,
  map: 25,
  extract: 45,
  build: 65,
  verify: 80,
  deliver: 92,
  done: 100,
};

async function log(jobId: string, phase: AgentPhase | null, message: string, level: "info" | "warn" | "error" = "info") {
  await addJobEvent({ jobId, phase, level, message });
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function emptyDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function scaffoldProject(projectDir: string, uiKit: UiKit, seedFrom?: string): void {
  const marker = path.join(projectDir, "src", "App.tsx");
  if (fs.existsSync(marker)) return; // already scaffolded (continuation)
  fs.mkdirSync(projectDir, { recursive: true });
  if (seedFrom && fs.existsSync(path.join(seedFrom, "src"))) {
    copyDir(seedFrom, projectDir);
    return;
  }
  const templateDir = path.join(PATHS.templates, `replica-${uiKit}`);
  copyDir(templateDir, projectDir);
}

function ensureProgressFiles(projectDir: string, replica: Replica, variant: ReplicaVariant): void {
  const progressDir = path.join(projectDir, "progress");
  fs.mkdirSync(progressDir, { recursive: true });
  const stateFile = path.join(progressDir, "STATE.json");
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(
      stateFile,
      JSON.stringify(
        {
          phase: "recon",
          sourceUrl: replica.sourceUrl,
          uiKit: variant.uiKit,
          sections: [],
          notes: [],
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  const ctxFile = path.join(progressDir, "context.md");
  if (!fs.existsSync(ctxFile)) {
    fs.writeFileSync(
      ctxFile,
      [
        `# Replica context — ${replica.name}`,
        "",
        `- Original: ${replica.sourceUrl}`,
        `- UI kit: ${variant.uiKit}`,
        `- Created: ${new Date().toISOString()}`,
        "",
        "## Design tokens",
        "",
        "(fill in as extracted)",
        "",
        "## Sections",
        "",
        "(one line per section: name, status, notable values)",
        "",
        "## Decisions & gotchas",
        "",
        "(keep short — this file is read at the start of every session)",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  fs.mkdirSync(path.join(projectDir, ".replica"), { recursive: true });
}

async function sessionKey(variantId: string): Promise<string> {
  return `session:${variantId}`;
}

async function getOrCreateSession(variant: ReplicaVariant, replica: Replica): Promise<{ id: string; isNew: boolean }> {
  const key = await sessionKey(variant.id);
  const existing = await getSetting(key);
  if (existing) {
    try {
      const messages = await agent.getSessionMessages(existing);
      if (Array.isArray(messages)) return { id: existing, isNew: false };
    } catch {
      /* session vanished; create a new one */
    }
  }
  const id = await agent.createSession(`Replica ${replica.slug} · ${variant.uiKit}`);
  await setSetting(key, id);
  return { id, isNew: true };
}

function makeEventHandler(jobId: string, current: { phase: AgentPhase }) {
  let textBuffer = "";
  return (event: AgentEvent): void => {
    const type = event.type;
    const props = (event.properties ?? {}) as Record<string, any>;
    try {
      const part = props.part;
      if (type.startsWith("message.part") && part) {
        if (part.type === "tool" && part.tool === "bash") {
          const command: string = part.state?.input?.command ?? "";
          for (const [re, phase] of SCRIPT_PHASE) {
            if (re.test(command) && phase !== current.phase) {
              current.phase = phase;
              void updateJob(jobId, { phase, progress: PHASE_PROGRESS[phase], message: `Phase: ${phase}` });
              void log(jobId, phase, `Running ${command.slice(0, 180)}`);
              break;
            }
          }
        } else if (part.type === "text" && typeof part.text === "string") {
          textBuffer += part.text;
          const firstLine = textBuffer.split("\n").find((l: string) => l.trim());
          if (firstLine && firstLine.length > 0) {
            textBuffer = textBuffer.slice(-500);
            void updateJob(jobId, { message: firstLine.trim().slice(0, 200) });
          }
        }
      }
    } catch {
      /* never let event handling break a job */
    }
  };
}

export async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const replica = await getReplica(job.replicaId);
  const variant = await getVariant(job.variantId);
  if (!replica || !variant) {
    await updateJob(jobId, { status: "failed", error: "Replica or variant no longer exists", finishedAt: new Date().toISOString() });
    return;
  }

  const projectDir = variantProjectDir(replica.id, variant.uiKit);
  const outDir = variantBuildDir(replica.id, variant.uiKit);
  const previewUrl = publicPreviewUrl(replica.slug, variant.uiKit);
  const ctx: PromptContext = { replica, variant, projectDir, previewUrl };

  const current = { phase: "recon" as AgentPhase };
  const startedAt = new Date().toISOString();
  await updateJob(jobId, { status: "running", phase: "recon", progress: PHASE_PROGRESS.recon, startedAt, message: "Preparing workspace" });
  await setVariantStatus(variant.id, "running", { lastError: null });
  await log(jobId, "recon", `Job started (${job.type}) for ${replica.slug}/${variant.uiKit}`);

  try {
    // 1. Scaffold the workspace and durable memory.
    const sibling = job.type === "port" ? siblingProjectDir(replica.id, variant.uiKit) : null;
    scaffoldProject(projectDir, variant.uiKit, sibling ?? undefined);
    ensureProgressFiles(projectDir, replica, variant);
    await log(jobId, "recon", "Workspace ready");

    // 2. Make sure the agent engine is up.
    await agent.ensureStarted();
    await log(jobId, "recon", "Agent engine healthy");

    // 3. Get or create the persistent session and send the task.
    const { id: sessionId, isNew } = await getOrCreateSession(variant, replica);
    await updateJob(jobId, { opencodeSessionId: sessionId });

    const prompt =
      job.type === "port"
        ? isNew
          ? buildPortPrompt(ctx, variant.uiKit === "shadcn" ? "daisyui" : "shadcn")
          : buildContinuePrompt(ctx, "This is a UI-kit port. Resume the port and verify it.")
        : isNew
          ? buildInitialPrompt(ctx)
          : buildContinuePrompt(ctx);

    await log(jobId, "recon", isNew ? "Starting new agent session" : "Resuming agent session");

    const onEvent = makeEventHandler(jobId, current);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Job timed out")), env.JOB_TIMEOUT_MS),
    );
    const result = await Promise.race([agent.prompt(sessionId, prompt, onEvent), timeout]);
    await log(jobId, current.phase, `Agent turn finished (in ${result.tokens.input} / out ${result.tokens.output} tokens)`);

    // 4. Build (with a repair loop).
    await updateJob(jobId, { phase: "build", progress: PHASE_PROGRESS.build, message: "Building replica" });
    let buildOk = false;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !buildOk; attempt++) {
      try {
        emptyDir(outDir);
        await buildReplica({ projectDir, outDir });
        buildOk = true;
      } catch (err) {
        lastError = err instanceof Error ? (err.stack ?? err.message) : String(err);
        await log(jobId, "build", `Build attempt ${attempt + 1} failed`, "warn");
        if (attempt < 2) {
          const repair = buildRepairPrompt(ctx, lastError);
          await agent.prompt(sessionId, repair, onEvent);
        }
      }
    }
    if (!buildOk) throw new Error(`Build failed after retries:\n${lastError}`);

    // 5. Finalize: version, zip, status.
    await updateJob(jobId, { phase: "deliver", progress: PHASE_PROGRESS.deliver, message: "Packaging template" });
    const version = await bumpVariantVersion(variant.id);
    const zipPath = path.join(PATHS.builds, replica.id, `${variant.uiKit}-v${version}.zip`);
    const size = await zipDirectory(projectDir, zipPath);
    await createVersionRecord({
      variantId: variant.id,
      version,
      note: job.type === "port" ? `Ported to ${variant.uiKit}` : `Replication run`,
      sizeBytes: size,
    });
    await setVariantStatus(variant.id, "ready", { lastError: null, buildDir: path.relative(PATHS.data, outDir) });
    await updateJob(jobId, {
      status: "succeeded",
      phase: "done",
      progress: 100,
      message: `Ready as v${version}`,
      finishedAt: new Date().toISOString(),
    });
    await touchReplica(replica.id);
    await log(jobId, "done", `Delivered v${version} (${(dirSize(outDir) / 1024).toFixed(0)} KB build)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setVariantStatus(variant.id, "failed", { lastError: message.slice(0, 2000) });
    await updateJob(jobId, {
      status: "failed",
      error: message.slice(0, 4000),
      message: "Failed",
      finishedAt: new Date().toISOString(),
    });
    await log(jobId, current.phase, message.slice(0, 500), "error");
  }
}

function siblingProjectDir(replicaId: string, uiKit: UiKit): string | null {
  const other: UiKit = uiKit === "shadcn" ? "daisyui" : "shadcn";
  const dir = variantProjectDir(replicaId, other);
  return fs.existsSync(path.join(dir, "src")) ? dir : null;
}
