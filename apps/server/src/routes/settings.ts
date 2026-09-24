import type { FastifyInstance } from "fastify";
import { updateAgentSettingsSchema, upsertProviderSchema, type ModelInfo, type ProviderId } from "@replicator/shared";
import { audit } from "../audit.ts";
import { agent } from "../agent/opencode.ts";
import { writeOpenCodeConfig } from "../agent/config.ts";
import {
  deleteProvider,
  getAgentSettings,
  getProviderWithKey,
  listProviders,
  setAgentSettings,
  setProviderModels,
  upsertProvider,
  DEFAULT_BASE_URLS,
} from "../services/settings.ts";

async function fetchModels(provider: ProviderId, baseUrl: string, apiKey: string | null): Promise<ModelInfo[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${provider}: models endpoint returned ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };
  const items = json.data ?? [];
  return items.map((m) => {
    const free =
      provider === "openrouter"
        ? m.pricing
          ? Number(m.pricing.prompt ?? "0") === 0 && Number(m.pricing.completion ?? "0") === 0
          : m.id.endsWith(":free")
        : // opencode Zen / custom endpoints expose no pricing, so only names that
          // are explicitly marked free are treated as free.
          /free/i.test(m.id);
    return {
      provider,
      id: m.id,
      name: m.name ?? m.id,
      free,
      contextLength: m.context_length ?? null,
    } satisfies ModelInfo;
  });
}

async function reloadAgent(): Promise<void> {
  await writeOpenCodeConfig();
  if (agent.isReady) await agent.restart();
  else await agent.ensureStarted();
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/api/settings/providers", async (_req, reply) => {
    return reply.send({ items: await listProviders(), defaults: DEFAULT_BASE_URLS });
  });

  app.post("/api/settings/providers", { preHandler: app.requireCsrf }, async (req, reply) => {
    const parsed = upsertProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid provider payload", details: parsed.error.flatten() });
    }
    const account = await upsertProvider(parsed.data);
    await audit({ userId: req.auth!.user.id, action: "provider.upserted", target: parsed.data.provider, ip: req.ip });
    let agentError: string | null = null;
    try {
      await reloadAgent();
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    }
    return reply.send({ provider: account, agentError });
  });

  app.delete("/api/settings/providers/:id", { preHandler: app.requireCsrf }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteProvider(id);
    await reloadAgent().catch(() => undefined);
    await audit({ userId: req.auth!.user.id, action: "provider.deleted", target: id, ip: req.ip });
    return reply.send({ ok: true });
  });

  app.get("/api/settings/models", async (req, reply) => {
    const query = req.query as { free?: string; provider?: string };
    const onlyFree = query.free !== "false";
    const accounts = (await listProviders()).filter((p) => p.enabled);
    const results: ModelInfo[] = [];
    const errors: string[] = [];
    for (const account of accounts) {
      if (query.provider && account.provider !== query.provider) continue;
      const withKey = await getProviderWithKey(account.provider as ProviderId);
      const baseUrl = account.baseUrl ?? DEFAULT_BASE_URLS[account.provider as ProviderId];
      if (!baseUrl) continue;
      try {
        const models = await fetchModels(account.provider as ProviderId, baseUrl, withKey?.apiKey ?? null);
        const filtered = onlyFree ? models.filter((m) => m.free) : models;
        results.push(...filtered);
        await setProviderModels(account.provider as ProviderId, filtered.map((m) => m.id));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return reply.send({ items: results, errors });
  });

  app.get("/api/settings/agent", async (_req, reply) => {
    return reply.send({ settings: await getAgentSettings(), online: await agent.health() });
  });

  app.patch("/api/settings/agent", { preHandler: app.requireCsrf }, async (req, reply) => {
    const parsed = updateAgentSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid agent settings", details: parsed.error.flatten() });
    }
    await setAgentSettings(parsed.data);
    await reloadAgent().catch(() => undefined);
    await audit({ userId: req.auth!.user.id, action: "agent.settings_updated", ip: req.ip });
    return reply.send({ ok: true });
  });

  app.post("/api/settings/test-model", { preHandler: app.requireCsrf }, async (_req, reply) => {
    const settings = await getAgentSettings();
    try {
      await writeOpenCodeConfig();
      if (!agent.isReady) await agent.ensureStarted();
      const sessionId = await agent.createSession("Model connectivity test");
      try {
        const result = await agent.prompt(sessionId, "Reply with exactly: OK");
        return reply.send({ ok: true, model: settings.defaultModel, reply: result.text.slice(0, 300) });
      } finally {
        await agent.deleteSession(sessionId);
      }
    } catch (err) {
      return reply.send({
        ok: false,
        model: settings.defaultModel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/settings/status", async (_req, reply) => {
    return reply.send({
      opencodeOnline: await agent.health(),
      knownModels: await agent.listKnownModels(),
    });
  });
}
