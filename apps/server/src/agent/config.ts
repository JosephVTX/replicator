import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../paths.ts";
import { getAgentSettings, listProviders, getProviderWithKey } from "../services/settings.ts";
import type { ProviderId } from "@replicator/shared";

export const OPENCODE_CONFIG_FILE = path.join(PATHS.opencodeHome, "opencode.json");

interface OpenCodeProviderConfig {
  npm: string;
  name: string;
  options: Record<string, unknown>;
  models?: Record<string, { name?: string }>;
}

/**
 * Builds the opencode config from the providers the admin stored. We use the
 * OpenAI-compatible adapter for everything (OpenRouter, opencode Zen, custom),
 * which lets a single admin-managed API key drive any provider.
 */
export async function buildOpenCodeConfig(): Promise<Record<string, unknown>> {
  const providers = await listProviders();
  const providerConfig: Record<string, OpenCodeProviderConfig> = {};

  for (const account of providers) {
    if (!account.enabled) continue;
    const withKey = await getProviderWithKey(account.provider as ProviderId);
    const apiKey = withKey?.apiKey;
    const baseUrl = account.baseUrl ?? "";
    if (!apiKey || !baseUrl) continue;
    const models: Record<string, { name?: string }> = {};
    for (const m of account.models) {
      const id = m.includes("/") ? m.split("/").slice(1).join("/") : m;
      models[id] = { name: id };
    }
    providerConfig[account.provider] = {
      npm: "@ai-sdk/openai-compatible",
      name: account.label,
      options: { baseURL: baseUrl, apiKey },
      ...(Object.keys(models).length > 0 ? { models } : {}),
    };
  }

  const agent = await getAgentSettings();

  return {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    provider: providerConfig,
    ...(agent.defaultModel ? { model: agent.defaultModel } : {}),
  };
}

export async function writeOpenCodeConfig(): Promise<void> {
  fs.mkdirSync(PATHS.opencodeHome, { recursive: true });
  const config = await buildOpenCodeConfig();
  fs.writeFileSync(OPENCODE_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

/** Environment for the opencode child process: everything persisted on the volume. */
export function openCodeEnv(): NodeJS.ProcessEnv {
  const home = PATHS.opencodeHome;
  return {
    ...process.env,
    OPENCODE_CONFIG: OPENCODE_CONFIG_FILE,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_STATE_HOME: path.join(home, "state"),
    HOME: home,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_TERMINAL_TITLE: "1",
    CI: "true",
    NO_COLOR: "1",
  };
}
