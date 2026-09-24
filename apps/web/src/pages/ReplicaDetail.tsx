import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Play, Repeat, Save } from "lucide-react";
import type { JobEvent } from "@/lib/types";
import type { UiKit } from "@replicator/shared";
import { api, download } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/utils";
import type { JobResponse, ReplicaDetailResponse } from "@/lib/types";
import { Badge, Button, Card, ErrorText, Field, Input, Spinner, StatusBadge } from "@/components/ui";

const ACTIVE = new Set(["queued", "running", "verifying"]);

export default function ReplicaDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<ReplicaDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api<ReplicaDetailResponse>(`/api/replicas/${id}`);
      setDetail(data);
      setName((prev) => (prev ? prev : data.replica.name));
      const active = data.jobs.find((j) => ACTIVE.has(j.status));
      setJobId(active?.id ?? data.jobs[0]?.id ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replica");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const jobStatus = detail?.jobs.find((j) => j.id === jobId)?.status;
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const data = await api<JobResponse>(`/api/jobs/${jobId}`);
        setEvents(data.events);
        if (ACTIVE.has(data.job.status) || ACTIVE.has(detail?.replica.status ?? "")) void load();
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [jobId, load, detail?.replica.status]);

  if (!detail && !error) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!detail) return <ErrorText>{error}</ErrorText>;

  const { replica, variants, jobs } = detail;
  const currentJob = jobs.find((j) => j.id === jobId);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  };

  const kits = variants.map((v) => v.uiKit);
  const otherKit: UiKit = kits.includes("shadcn") ? "daisyui" : "shadcn";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted hover:text-text">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{replica.name}</h1>
            <StatusBadge status={replica.status} />
          </div>
          <a href={replica.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-accent-soft">
            {replica.sourceUrl}
          </a>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.open(`/r/${replica.slug}/`, "_blank")}>
          Open preview
        </Button>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Card className="flex flex-wrap items-end gap-4">
        <Field label="Rename">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button size="sm" variant="outline" onClick={() => act("save", () => api(`/api/replicas/${replica.id}`, { method: "PATCH", body: { name } }))} disabled={busy !== null}>
          {busy === "save" ? <Spinner /> : <Save className="size-3.5" />} Save
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={replica.isPublic}
            onChange={(e) => void act("public", () => api(`/api/replicas/${replica.id}`, { method: "PATCH", body: { isPublic: e.target.checked } }))}
          />
          Publicly accessible
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => act("run", () => api(`/api/replicas/${replica.id}/run`, { method: "POST", body: {} }))} disabled={busy !== null || (currentJob ? ACTIVE.has(currentJob.status) : false)}>
            {busy === "run" ? <Spinner /> : <Play className="size-3.5" />} Re-run replication
          </Button>
          <Button size="sm" variant="outline" onClick={() => act("port", () => api(`/api/replicas/${replica.id}/port`, { method: "POST", body: { uiKit: otherKit } }))} disabled={busy !== null}>
            {busy === "port" ? <Spinner /> : <Repeat className="size-3.5" />} Port to {otherKit}
          </Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">Variants</h2>
          {variants.map((v) => (
            <div key={v.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge>{v.uiKit}</Badge>
                  <StatusBadge status={v.status} />
                  <span className="text-xs text-muted">latest v{v.version}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => window.open(`/r/${replica.slug}/${v.uiKit}/`, "_blank")}>
                    preview
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => download(`/api/replicas/${replica.id}/download?variantId=${v.id}`)} disabled={v.version === 0}>
                    <Download className="size-3.5" /> ZIP
                  </Button>
                </div>
              </div>
              {v.lastError ? <p className="mt-2 rounded bg-err/10 px-2 py-1 text-xs text-err">{v.lastError}</p> : null}
              <div className="mt-2 space-y-1">
                {v.versions.map((ver) => (
                  <div key={ver.id} className="flex items-center justify-between text-xs text-muted">
                    <span>
                      v{ver.version} · {formatDate(ver.createdAt)} · {(ver.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                    <button className="hover:text-accent-soft" onClick={() => download(`/api/replicas/${replica.id}/download?variantId=${v.id}&version=${ver.version}`)}>
                      download
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Runs</h2>
            {jobs.length > 0 ? (
              <select className="rounded border border-border bg-surface-2 px-2 py-1 text-xs" value={jobId ?? ""} onChange={(e) => setJobId(e.target.value)}>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.type} · {j.status} · {relativeTime(j.createdAt)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {currentJob ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <StatusBadge status={currentJob.status} />
                <Badge>{currentJob.phase}</Badge>
                <span className="text-muted">{currentJob.message}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-accent transition-all" style={{ width: `${currentJob.progress}%` }} />
              </div>
              {currentJob.error ? <p className="rounded bg-err/10 px-2 py-1 text-xs text-err">{currentJob.error}</p> : null}
            </div>
          ) : (
            <p className="text-xs text-muted">No runs yet.</p>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2/50 p-3 font-mono text-[11px] leading-relaxed">
            {events.length === 0 ? (
              <p className="text-muted">Waiting for events…</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className={e.level === "error" ? "text-err" : e.level === "warn" ? "text-warn" : "text-muted"}>
                  <span className="text-muted/60">{new Date(e.at).toLocaleTimeString()} </span>
                  {e.phase ? <span className="text-accent-soft">[{e.phase}] </span> : null}
                  {e.message}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
