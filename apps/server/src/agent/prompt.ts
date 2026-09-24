import fs from "node:fs";
import path from "node:path";
import type { Replica, ReplicaVariant } from "@replicator/shared";
import { env } from "../env.ts";
import { PATHS } from "../paths.ts";

let cachedPlaybook: string | null = null;
function playbook(): string {
  if (cachedPlaybook) return cachedPlaybook;
  cachedPlaybook = fs.readFileSync(path.join(PATHS.agentSkill, "prompts", "playbook.md"), "utf8");
  return cachedPlaybook;
}

export interface PromptContext {
  replica: Replica;
  variant: ReplicaVariant;
  projectDir: string;
  previewUrl: string;
}

const UI_KIT_NOTES: Record<string, string> = {
  shadcn:
    "Build primitives with shadcn/ui conventions: `class-variance-authority` + `clsx` + `tailwind-merge` (`cn()` helper in `src/lib/utils.ts`), Radix primitives only when the original's behaviour needs them. radix, cva, clsx, tailwind-merge and lucide-react are already installed.",
  daisyui:
    'Build primitives with daisyui classes (`btn`, `card`, `badge`, `table`, `drawer`, `tabs`, …). `daisyui` is already installed; include it from CSS with `@plugin "daisyui";` after `@import "tailwindcss";`.',
};

function taskBlock(ctx: PromptContext): string {
  const { replica, variant, projectDir, previewUrl } = ctx;
  return [
    "## Task block",
    "",
    `- **Replica name**: ${replica.name}`,
    `- **Replica id / slug**: ${replica.id} / ${replica.slug}`,
    `- **Original page to replicate**: ${replica.sourceUrl}`,
    `- **UI kit for this version**: ${variant.uiKit}`,
    `- **Workspace (your project root)**: \`${projectDir}\``,
    `- **Scripts directory**: \`${PATHS.skillWorkspace}\` — run scripts as \`node ${PATHS.skillWorkspace}/<name>.mjs …\``,
    `- **Progress files**: \`${projectDir}/progress/STATE.json\` and \`${projectDir}/progress/context.md\``,
    `- **Evidence dir**: \`${projectDir}/.replica/\``,
    `- **Deep references** (read only when stuck): \`${PATHS.agentSkill}/references/*.md\``,
    `- **Preview URL of your build** (for \`verify.mjs\` \`replica\`): \`${previewUrl}\``,
    `- **Build the preview**: \`cd ${projectDir} && node node_modules/vite/bin/vite.js build\`. The preview URL always serves the latest \`dist/\` build, so rebuild whenever you want to check your work.`,
    "",
    "### UI kit rules",
    "",
    UI_KIT_NOTES[variant.uiKit] ?? UI_KIT_NOTES.shadcn!,
    "Regardless of the kit, the rendered result must match the original exactly.",
    "",
    `### Important`,
    `- Work only inside \`${projectDir}\`. Never touch other replicas.`,
    `- Your changes are built and served automatically after you finish; you do not need to build`,
    `  manually, but you MUST make sure \`src/index.css\` and the React entry are valid.`,
    `- Start by reading \`progress/STATE.json\` and \`progress/context.md\` if they exist.`,
  ].join("\n");
}

export function buildInitialPrompt(ctx: PromptContext, extra?: string): string {
  return [
    playbook(),
    "",
    "---",
    "",
    taskBlock(ctx),
    "",
    extra ?? "",
    "Begin now. Rehydrate (read progress files), then execute the phases in order, updating",
    "`progress/STATE.json` and `progress/context.md` after each phase. Run `verify.mjs` until it",
    "returns PASS (`--final` at the end). Report a concise final summary when done.",
  ].join("\n");
}

export function buildPortPrompt(ctx: PromptContext, fromKit: string): string {
  return buildInitialPrompt(
    ctx,
    [
      "### This task is a UI-kit port (not a fresh replication)",
      "",
      `The same page was already replicated faithfully in **${fromKit}**. The project in your`,
      `workspace already contains that working implementation. Your job is to produce the`,
      `**${ctx.variant.uiKit}** version of it:`,
      "",
      `- Keep the design tokens, layout, spacing and measurements identical.`,
      `- Replace the ${fromKit}-specific primitives with ${ctx.variant.uiKit} primitives`,
      `  (${ctx.variant.uiKit === "daisyui" ? "daisyui classes" : "shadcn/ui components"}),`,
      `  reimplementing anything that has no direct equivalent so the result still renders the same.`,
      "- You do NOT need to re-capture the original page: the existing implementation plus the",
      "  saved evidence in `.replica/` is your source of truth. Only capture again if something is",
      "  genuinely missing.",
      "- Verify the result with `verify.mjs` against the original URL until it passes.",
    ].join("\n"),
  );
}

export function buildContinuePrompt(ctx: PromptContext, extra?: string): string {
  return [
    "## Continuation",
    "",
    "A previous run of this task was interrupted. Your durable memory is on disk.",
    "",
    taskBlock(ctx),
    "",
    "Continue exactly where you left off:",
    "1. Read `progress/STATE.json` and `progress/context.md`.",
    "2. Re-read only the evidence you still need from `.replica/`.",
    "3. Resume at the recorded phase and finish the remaining work.",
    "4. Keep the progress files up to date as you go.",
    extra ? `\n### Note from the platform\n${extra}` : "",
  ].join("\n");
}

export function buildRepairPrompt(ctx: PromptContext, error: string): string {
  return [
    "## Build failed — please fix",
    "",
    `Building the replica project with Vite failed. Here is the error output:`,
    "",
    "```",
    error.slice(0, 8000),
    "```",
    "",
    `Project root: \`${ctx.projectDir}\`.`,
    "Fix the source so the production build succeeds. Do not remove working sections.",
    "After fixing, re-run `verify.mjs` and update the progress files.",
  ].join("\n");
}

export function publicPreviewUrl(slug: string, uiKit: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/r/${slug}/${uiKit}/`;
}
