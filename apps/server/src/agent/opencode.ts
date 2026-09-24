import { spawn, type ChildProcess } from "node:child_process";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { env } from "../env.ts";
import { PATHS } from "../paths.ts";
import { openCodeEnv, writeOpenCodeConfig } from "./config.ts";

export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export interface AgentEvent {
  type: string;
  properties?: Record<string, unknown>;
}

/**
 * Owns the `opencode serve` child process and exposes a thin, defensive wrapper
 * around the SDK. Everything (sessions, messages, tool runs) is persisted by
 * opencode on the volume, which is what gives us continuity across model
 * switches and restarts.
 */
class AgentEngine {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;
  private readonly client: OpenCodeClient;
  public readonly baseUrl: string;

  constructor() {
    this.baseUrl = `http://${env.OPENCODE_HOSTNAME}:${env.OPENCODE_PORT}`;
    this.client = createOpencodeClient({ baseUrl: this.baseUrl });
  }

  get api(): OpenCodeClient {
    return this.client;
  }

  get isReady(): boolean {
    return this.ready;
  }

  private log(line: string): void {
    const text = line.trim();
    if (!text) return;
    // eslint-disable-next-line no-console
    console.log(`[opencode] ${text.slice(0, 500)}`);
  }

  async ensureStarted(): Promise<void> {
    if (this.ready && this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async start(): Promise<void> {
    await writeOpenCodeConfig();
    const bin = process.platform === "win32" ? "opencode.cmd" : "opencode";
    this.child = spawn(
      bin,
      ["serve", "--port", String(env.OPENCODE_PORT), "--hostname", env.OPENCODE_HOSTNAME],
      {
        cwd: PATHS.replicas,
        env: openCodeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // Windows resolves the `opencode.cmd` shim only through a shell.
        shell: process.platform === "win32",
      },
    );
    this.child.stdout?.on("data", (d: Buffer) => this.log(d.toString()));
    this.child.stderr?.on("data", (d: Buffer) => this.log(d.toString()));
    this.child.on("exit", (code) => {
      this.log(`process exited with code ${code}`);
      this.ready = false;
      this.child = null;
    });
    await this.waitForHealth();
    this.ready = true;
    this.log("server is healthy");
  }

  private async waitForHealth(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrl}/global/health`);
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("opencode server did not become healthy in time");
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    this.ready = false;
    await this.ensureStarted();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (!child) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 4000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /* ───────────────────────────── Sessions ──────────────────────────────── */

  async createSession(title: string): Promise<string> {
    await this.ensureStarted();
    const res = (await this.client.session.create({ body: { title } })) as {
      data?: { id: string };
      error?: unknown;
    };
    const id = res.data?.id;
    if (!id) throw new Error(`Failed to create opencode session: ${JSON.stringify(res.error)}`);
    return id;
  }

  async getSessionMessages(sessionId: string): Promise<unknown[]> {
    const res = (await this.client.session.messages({ path: { id: sessionId } })) as {
      data?: unknown[];
    };
    return res.data ?? [];
  }

  /** Pulls the most recent assistant error out of a session, if any. */
  async lastError(sessionId: string): Promise<string | null> {
    try {
      const messages = (await this.getSessionMessages(sessionId)) as Array<{
        info?: { role?: string; error?: unknown };
        parts?: Array<{ type?: string; text?: string }>;
      }>;
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i]?.info;
        if (info?.role === "assistant" && info.error) {
          const err = info.error as { name?: string; data?: { message?: string } };
          return err.data?.message ?? err.name ?? JSON.stringify(info.error);
        }
      }
      for (let i = messages.length - 1; i >= 0; i--) {
        const part = messages[i]?.parts?.find((p) => p.type === "text" && p.text?.trim());
        if (part?.text) return part.text.slice(0, 600);
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.client.session.delete({ path: { id: sessionId } });
    } catch {
      /* best effort */
    }
  }

  /**
   * Sends a prompt and resolves when the assistant finishes the turn. `onEvent`
   * receives every opencode event so callers can surface live progress.
   */
  async prompt(
    sessionId: string,
    text: string,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<{ text: string; tokens: { input: number; output: number } }> {
    await this.ensureStarted();
    const unsubscribe = onEvent ? await this.subscribeEvents(onEvent) : null;
    try {
      const res = (await this.client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text }] },
      })) as {
        data?: { parts?: Array<{ type: string; text?: string }>; info?: { tokens?: unknown } };
        error?: unknown;
      };
      if (res.error) {
        const detail = await this.lastError(sessionId);
        throw new Error(
          `opencode prompt failed: ${detail ?? JSON.stringify(res.error)}`,
        );
      }
      const parts = res.data?.parts ?? [];
      const out = parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
      const info = res.data?.info as { tokens?: { input?: number; output?: number } } | undefined;
      return {
        text: out,
        tokens: { input: info?.tokens?.input ?? 0, output: info?.tokens?.output ?? 0 },
      };
    } finally {
      unsubscribe?.();
    }
  }

  /* ───────────────────────────── Events ────────────────────────────────── */

  async subscribeEvents(handler: (event: AgentEvent) => void): Promise<() => void> {
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = (await this.client.event.subscribe()) as unknown;
        const stream =
          res && typeof res === "object" && "stream" in res
            ? (res as { stream: AsyncIterable<AgentEvent> }).stream
            : (res as AsyncIterable<AgentEvent>);
        for await (const event of stream) {
          if (stopped) break;
          handler(event);
        }
      } catch {
        /* stream closed */
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }

  /* ───────────────────────────── Providers ─────────────────────────────── */

  async listKnownModels(): Promise<string[]> {
    try {
      const res = (await this.client.config.providers()) as {
        data?: { providers?: Array<{ id: string; models?: Record<string, unknown> }> };
      };
      const providers = res.data?.providers ?? [];
      const out: string[] = [];
      for (const p of providers) {
        for (const id of Object.keys(p.models ?? {})) out.push(`${p.id}/${id}`);
      }
      return out;
    } catch {
      return [];
    }
  }
}

export const agent = new AgentEngine();
