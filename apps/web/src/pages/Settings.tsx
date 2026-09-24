import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Save, Zap } from "lucide-react";
import type { AgentSettings, ModelInfo, ProviderAccount } from "@replicator/shared";
import { api } from "@/lib/api";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Spinner } from "@/components/ui";
import type { AgentSettingsResponse, ModelsResponse, ProvidersResponse } from "@/lib/types";

const PROVIDER_LABELS: Record<string, { title: string; hint: string; placeholder: string }> = {
  openrouter: {
    title: "OpenRouter",
    hint: "Free models available with your OpenRouter key. Get one at openrouter.ai/keys.",
    placeholder: "sk-or-v1-…",
  },
  opencode: {
    title: "opencode Zen",
    hint: "opencode's own gateway. Some models are free.",
    placeholder: "sk-…",
  },
  custom: {
    title: "Custom (OpenAI-compatible)",
    hint: "Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, a proxy…).",
    placeholder: "optional key",
  },
};

function ProviderCard({
  provider,
  account,
  defaultBaseUrl,
  onSaved,
  onModels,
}: {
  provider: string;
  account?: ProviderAccount;
  defaultBaseUrl?: string;
  onSaved: () => void;
  onModels: (items: ModelInfo[]) => void;
}) {
  const meta = PROVIDER_LABELS[provider]!;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl ?? defaultBaseUrl ?? "");
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setBusy("save");
    setError("");
    setMsg("");
    try {
      const res = await api<{ agentError: string | null }>("/api/settings/providers", {
        method: "POST",
        body: {
          provider,
          label: meta.title,
          baseUrl: baseUrl || null,
          enabled,
          ...(apiKey ? { apiKey } : {}),
        },
      });
      setApiKey("");
      setMsg(res.agentError ? `Saved. Agent warning: ${res.agentError}` : "Saved ✓");
      onSaved();
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  };

  const refreshModels = async () => {
    setBusy("models");
    setError("");
    try {
      const res = await api<ModelsResponse>(`/api/settings/models?provider=${provider}`);
      onModels(res.items);
      setMsg(`Imported ${res.items.length} free model(s)${res.errors.length ? ` · ${res.errors.join("; ")}` : ""}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{meta.title}</h3>
          <p className="text-xs text-muted">{meta.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          {account?.hasKey ? <Badge className="text-ok">key stored</Badge> : <Badge>no key</Badge>}
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled
          </label>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Base URL">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
        </Field>
        <Field label="API key" hint={account?.hasKey ? "Leave blank to keep the stored key." : "Encrypted at rest."}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={meta.placeholder} />
        </Field>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {msg ? <p className="text-xs text-ok">{msg}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy !== null}>
          {busy === "save" ? <Spinner /> : <Save className="size-3.5" />} Save
        </Button>
        <Button size="sm" variant="outline" onClick={refreshModels} disabled={busy !== null || !account?.hasKey}>
          {busy === "models" ? <Spinner /> : <RefreshCw className="size-3.5" />} Import free models
        </Button>
        {account?.models.length ? <span className="self-center text-xs text-muted">{account.models.length} models</span> : null}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderAccount[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [includeAll, setIncludeAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api<ProvidersResponse>("/api/settings/providers"),
        api<AgentSettingsResponse>("/api/settings/agent"),
      ]);
      setProviders(p.items);
      setDefaults(p.defaults);
      setSettings(a.settings);
      setOnline(a.online);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadModels = useCallback(async (all: boolean) => {
    try {
      const res = await api<ModelsResponse>(`/api/settings/models?free=${all ? "false" : "true"}`);
      setModels(res.items);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadModels(includeAll);
  }, [includeAll, loadModels]);

  const allModels = useMemo(() => {
    const seen = new Set(models.map((m) => `${m.provider}/${m.id}`));
    return models;
  }, [models]);

  const saveAgent = async () => {
    if (!settings) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/settings/agent", { method: "PATCH", body: settings });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const testModel = async () => {
    setBusy(true);
    setError("");
    setTestResult("");
    try {
      const res = await api<{ ok: boolean; model: string; reply?: string; error?: string }>(
        "/api/settings/test-model",
        { method: "POST", body: {} },
      );
      setTestResult(
        res.ok
          ? `OK · ${res.model} → "${(res.reply ?? "").trim().slice(0, 80)}"`
          : `FAILED · ${res.model} → ${res.error}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  const providerOf = (id: string) => providers.find((p) => p.provider === id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-xs text-muted">Connect free model providers and tune the agent.</p>
        </div>
        <Badge className={online ? "text-ok" : "text-err"}>
          <Zap className="size-3" /> agent {online ? "online" : "offline"}
        </Badge>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {(["openrouter", "opencode", "custom"] as const).map((id) => (
        <ProviderCard
          key={id}
          provider={id}
          account={providerOf(id)}
          defaultBaseUrl={defaults[id]}
          onSaved={() => void load()}
          onModels={(items) => setModels((prev) => [...prev.filter((m) => m.provider !== id), ...items])}
        />
      ))}

      {settings ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Agent</h3>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} /> include paid models
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Default model" hint="provider/model — used for replication runs.">
              <Select value={settings.defaultModel} onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })}>
                <option value={settings.defaultModel}>{settings.defaultModel}</option>
                {allModels.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.provider}/{m.id} {m.free ? "(free)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Utility model (optional)" hint="Cheaper model for mechanical steps.">
              <Select value={settings.utilityModel} onChange={(e) => setSettings({ ...settings, utilityModel: e.target.value })}>
                <option value="">(use default)</option>
                {allModels.map((m) => (
                  <option key={`u-${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.provider}/{m.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Max steps per run">
              <Input
                type="number"
                value={settings.maxStepsPerRun}
                onChange={(e) => setSettings({ ...settings, maxStepsPerRun: Number(e.target.value) })}
              />
            </Field>
            <Field label="Token budget per run">
              <Input
                type="number"
                value={settings.tokenBudgetPerRun}
                onChange={(e) => setSettings({ ...settings, tokenBudgetPerRun: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveAgent} disabled={busy}>
              {busy ? <Spinner /> : <Save className="size-4" />} Save agent settings
            </Button>
            <Button variant="outline" onClick={testModel} disabled={busy}>
              <Zap className="size-4" /> Test model
            </Button>
            {saved ? (
              <span className="flex items-center gap-1 text-xs text-ok">
                <Check className="size-3.5" /> Saved
              </span>
            ) : null}
          </div>
          {testResult ? (
            <p className={testResult.startsWith("OK") ? "text-xs text-ok" : "text-xs text-err"}>{testResult}</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
