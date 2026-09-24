import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Eye, Play, Plus, RefreshCw, Repeat, Trash2 } from "lucide-react";
import type { UiKit } from "@replicator/shared";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/utils";
import type { ReplicaWithVariants } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Select, Spinner, StatusBadge } from "@/components/ui";

const ACTIVE = new Set(["queued", "running", "verifying"]);

function Preview({ path, ready }: { path: string; ready: boolean }) {
  if (!ready) {
    return (
      <div className="grid h-40 place-items-center rounded-lg border border-border bg-surface-2 text-xs text-muted">
        No preview yet
      </div>
    );
  }
  return (
    <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-white">
      <iframe
        src={path}
        title="preview"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        className="pointer-events-none absolute left-0 top-0 h-[800px] w-[1280px] origin-top-left"
        style={{ transform: "scale(0.32)" }}
      />
    </div>
  );
}

function ReplicaCard({
  replica,
  onChanged,
  isAdmin,
  ownerName,
}: {
  replica: ReplicaWithVariants;
  onChanged: () => void;
  isAdmin: boolean;
  ownerName?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const kits = replica.variants.map((v) => v.uiKit);
  const otherKit: UiKit = kits.includes("shadcn") ? "daisyui" : "shadcn";
  const canPort = !kits.includes(otherKit) || replica.variants.length < 2;

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/replicas/${replica.id}`} className="block truncate text-sm font-semibold hover:text-accent-soft">
            {replica.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">{replica.sourceUrl}</p>
        </div>
        <StatusBadge status={replica.status} />
      </div>

      <Preview path={`/r/${replica.slug}/${replica.variants[0]?.uiKit ?? "shadcn"}/`} ready={replica.variants.some((v) => v.status === "ready")} />

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {replica.variants.map((v) => (
          <Badge key={v.id}>
            {v.uiKit} · v{v.version}
          </Badge>
        ))}
        <span>· updated {relativeTime(replica.updatedAt)}</span>
        {isAdmin && ownerName ? <span>· by {ownerName}</span> : null}
        {replica.isPublic ? <Badge className="text-ok">public</Badge> : <Badge>private</Badge>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => window.open(`/r/${replica.slug}/`, "_blank")} disabled={!replica.variants.some((v) => v.status === "ready")}>
          <Eye className="size-3.5" /> Open
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("run", () => api(`/api/replicas/${replica.id}/run`, { method: "POST", body: {} }))} disabled={busy !== null}>
          {busy === "run" ? <Spinner /> : <Play className="size-3.5" />} Update
        </Button>
        {canPort ? (
          <Button size="sm" variant="outline" onClick={() => act("port", () => api(`/api/replicas/${replica.id}/port`, { method: "POST", body: { uiKit: otherKit } }))} disabled={busy !== null}>
            {busy === "port" ? <Spinner /> : <Repeat className="size-3.5" />} → {otherKit}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => download(`/api/replicas/${replica.id}/download`)} disabled={replica.variants.every((v) => v.version === 0)}>
          <Download className="size-3.5" /> ZIP
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-err hover:text-err"
          onClick={() => {
            if (confirm(`Delete "${replica.name}" and all its builds?`)) {
              void act("delete", () => api(`/api/replicas/${replica.id}`, { method: "DELETE" }));
            }
          }}
          disabled={busy !== null}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <p className="text-[11px] text-muted">created {formatDate(replica.createdAt)}</p>
    </Card>
  );
}

export default function ReplicasPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ReplicaWithVariants[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", sourceUrl: "", uiKit: "shadcn" as UiKit, notes: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: ReplicaWithVariants[] }>("/api/replicas");
      setItems(data.items);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replicas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = useMemo(() => items.some((r) => ACTIVE.has(r.status) || r.variants.some((v) => ACTIVE.has(v.status))), [items]);

  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [hasActive, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      await api("/api/replicas", { method: "POST", body: form });
      setForm({ name: "", sourceUrl: "", uiKit: "shadcn", notes: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create replica");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Replicas</h1>
          <p className="text-xs text-muted">Each replica is published at its own path on this domain.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="size-4" /> New replica
          </Button>
        </div>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {showForm ? (
        <Card>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme analytics dashboard" required />
            </Field>
            <Field label="Source URL" hint="The page to replicate (usually a full dashboard).">
              <Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://example.com/dashboard" required />
            </Field>
            <Field label="UI kit">
              <Select value={form.uiKit} onChange={(e) => setForm({ ...form, uiKit: e.target.value as UiKit })}>
                <option value="shadcn">shadcn/ui</option>
                <option value="daisyui">daisyUI</option>
              </Select>
            </Field>
            <Field label="Notes (optional)">
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the agent should know" />
            </Field>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Spinner /> : null} Start replication
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid place-items-center py-20 text-muted">
          <Spinner className="size-6" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No replicas yet"
          description="Add a URL and the platform will rebuild it pixel-perfect in React + TailwindCSS."
          action={<Button onClick={() => setShowForm(true)}><Plus className="size-4" /> New replica</Button>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((replica) => (
            <ReplicaCard
              key={replica.id}
              replica={replica}
              onChanged={() => void load()}
              isAdmin={user?.role === "admin"}
              ownerName={replica.ownerName}
            />
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <ExternalLink className="size-3" /> Published replicas live at <code>/r/&lt;slug&gt;/&lt;kit&gt;/</code>
      </p>
    </div>
  );
}
