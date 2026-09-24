import type { AgentSettings, ProviderAccount, ProviderId } from "@replicator/shared";
import { all, newId, now, one, run } from "../db/index.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  opencode: "https://opencode.ai/zen/v1",
  custom: "",
};

interface ProviderRow {
  id: string;
  provider: ProviderId;
  label: string;
  base_url: string | null;
  api_key_enc: string | null;
  models: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function parseModels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

function toAccount(r: ProviderRow): ProviderAccount {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    baseUrl: r.base_url,
    hasKey: Boolean(r.api_key_enc),
    models: parseModels(r.models),
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listProviders(): Promise<ProviderAccount[]> {
  const rows = await all<ProviderRow>("SELECT * FROM providers ORDER BY created_at ASC");
  return rows.map(toAccount);
}

export async function getProviderRow(provider: ProviderId): Promise<ProviderRow | null> {
  return one<ProviderRow>("SELECT * FROM providers WHERE provider = ?", [provider]);
}

export async function getProviderWithKey(
  provider: ProviderId,
): Promise<{ account: ProviderAccount; apiKey: string | null } | null> {
  const row = await getProviderRow(provider);
  if (!row) return null;
  return { account: toAccount(row), apiKey: decryptSecret(row.api_key_enc) };
}

export async function upsertProvider(input: {
  provider: ProviderId;
  label: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  models?: string[];
  enabled: boolean;
}): Promise<ProviderAccount> {
  const existing = await getProviderRow(input.provider);
  const ts = now();
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URLS[input.provider] ?? null;
  const modelsJson = input.models === undefined ? undefined : JSON.stringify(input.models);
  if (existing) {
    const sets = ["label = ?", "base_url = ?", "enabled = ?", "updated_at = ?"];
    const args: (string | number | null)[] = [input.label, baseUrl, input.enabled ? 1 : 0, ts];
    if (input.apiKey !== undefined) {
      sets.push("api_key_enc = ?");
      args.push(input.apiKey === null ? null : encryptSecret(input.apiKey));
    }
    if (modelsJson !== undefined) {
      sets.push("models = ?");
      args.push(modelsJson);
    }
    args.push(existing.id);
    await run(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`, args);
    return toAccount((await getProviderRow(input.provider))!);
  }
  const id = newId();
  await run(
    `INSERT INTO providers (id, provider, label, base_url, api_key_enc, models, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.provider,
      input.label,
      baseUrl,
      input.apiKey ? encryptSecret(input.apiKey) : null,
      modelsJson ?? "[]",
      input.enabled ? 1 : 0,
      ts,
      ts,
    ],
  );
  return toAccount((await getProviderRow(input.provider))!);
}

export async function setProviderModels(provider: ProviderId, models: string[]): Promise<void> {
  await run("UPDATE providers SET models = ?, updated_at = ? WHERE provider = ?", [
    JSON.stringify(models),
    now(),
    provider,
  ]);
}

export async function deleteProvider(id: string): Promise<void> {
  await run("DELETE FROM providers WHERE id = ?", [id]);
}

/* ───────────────────────────── Agent settings ────────────────────────────── */

export function defaultAgentSettings(): AgentSettings {
  return {
    defaultModel: "openrouter/deepseek/deepseek-chat-v3.1:free",
    utilityModel: "",
    maxStepsPerRun: 120,
    tokenBudgetPerRun: 2_000_000,
  };
}

export async function getAgentSettings(): Promise<AgentSettings> {
  const row = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'agent'");
  if (!row) return defaultAgentSettings();
  try {
    return { ...defaultAgentSettings(), ...(JSON.parse(row.value) as Partial<AgentSettings>) };
  } catch {
    return defaultAgentSettings();
  }
}

export async function setAgentSettings(settings: AgentSettings): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES ('agent', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(settings), now()],
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await one<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now()],
  );
}
