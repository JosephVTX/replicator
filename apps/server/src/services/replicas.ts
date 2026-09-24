import type {
  AgentPhase,
  Job,
  JobStatus,
  JobType,
  Replica,
  ReplicaStatus,
  ReplicaVariant,
  ReplicaVersion,
  UiKit,
} from "@replicator/shared";
import { all, newId, now, one, run } from "../db/index.ts";

/* ─────────────────────────────── Mapping ─────────────────────────────────── */

interface ReplicaRow {
  id: string;
  slug: string;
  name: string;
  source_url: string;
  status: ReplicaStatus;
  is_public: number;
  owner_id: string;
  active_variant_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  owner_name?: string;
}

function toReplica(r: ReplicaRow): Replica {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    sourceUrl: r.source_url,
    status: r.status,
    isPublic: r.is_public === 1,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    activeVariantId: r.active_variant_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface VariantRow {
  id: string;
  replica_id: string;
  ui_kit: UiKit;
  status: ReplicaStatus;
  version: number;
  build_dir: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function toVariant(v: VariantRow): ReplicaVariant {
  return {
    id: v.id,
    replicaId: v.replica_id,
    uiKit: v.ui_kit,
    status: v.status,
    version: v.version,
    buildDir: v.build_dir,
    lastError: v.last_error,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

/* ─────────────────────────────── Replicas ────────────────────────────────── */

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "replica";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const exists = await one<{ n: number }>("SELECT COUNT(*) AS n FROM replicas WHERE slug = ?", [slug]);
    if (!exists || exists.n === 0) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function listReplicas(options: {
  ownerId?: string;
  isAdmin: boolean;
}): Promise<Replica[]> {
  const where = options.isAdmin || !options.ownerId ? "" : "WHERE r.owner_id = ?";
  const args = where ? [options.ownerId!] : [];
  const rows = await all<ReplicaRow>(
    `SELECT r.*, u.name AS owner_name FROM replicas r
     JOIN users u ON u.id = r.owner_id
     ${where} ORDER BY r.updated_at DESC`,
    args,
  );
  return rows.map(toReplica);
}

export async function getReplica(id: string): Promise<Replica | null> {
  const row = await one<ReplicaRow>(
    `SELECT r.*, u.name AS owner_name FROM replicas r
     JOIN users u ON u.id = r.owner_id WHERE r.id = ?`,
    [id],
  );
  return row ? toReplica(row) : null;
}

export async function getReplicaBySlug(slug: string): Promise<Replica | null> {
  const row = await one<ReplicaRow>(
    `SELECT r.*, u.name AS owner_name FROM replicas r
     JOIN users u ON u.id = r.owner_id WHERE r.slug = ?`,
    [slug],
  );
  return row ? toReplica(row) : null;
}

export async function createReplica(input: {
  name: string;
  sourceUrl: string;
  uiKit: UiKit;
  ownerId: string;
  notes?: string;
}): Promise<Replica> {
  const id = newId();
  const slug = await uniqueSlug(slugify(input.name));
  const ts = now();
  await run(
    `INSERT INTO replicas (id, slug, name, source_url, status, is_public, owner_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?)`,
    [id, slug, input.name, input.sourceUrl, input.ownerId, input.notes ?? null, ts, ts],
  );
  const variant = await ensureVariant(id, input.uiKit);
  await run("UPDATE replicas SET active_variant_id = ? WHERE id = ?", [variant.id, id]);
  return (await getReplica(id))!;
}

export async function updateReplica(
  id: string,
  patch: { name?: string; isPublic?: boolean; activeVariantId?: string; status?: ReplicaStatus },
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.isPublic !== undefined) {
    sets.push("is_public = ?");
    args.push(patch.isPublic ? 1 : 0);
  }
  if (patch.activeVariantId !== undefined) {
    sets.push("active_variant_id = ?");
    args.push(patch.activeVariantId);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(now());
  args.push(id);
  await run(`UPDATE replicas SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function touchReplica(id: string): Promise<void> {
  await run("UPDATE replicas SET updated_at = ? WHERE id = ?", [now(), id]);
}

export async function deleteReplica(id: string): Promise<void> {
  await run("DELETE FROM replicas WHERE id = ?", [id]);
}

/* ─────────────────────────────── Variants ────────────────────────────────── */

export async function listVariants(replicaId: string): Promise<ReplicaVariant[]> {
  const rows = await all<VariantRow>("SELECT * FROM replica_variants WHERE replica_id = ? ORDER BY created_at ASC", [
    replicaId,
  ]);
  return rows.map(toVariant);
}

export async function getVariant(id: string): Promise<ReplicaVariant | null> {
  const row = await one<VariantRow>("SELECT * FROM replica_variants WHERE id = ?", [id]);
  return row ? toVariant(row) : null;
}

export async function getVariantByKit(replicaId: string, uiKit: UiKit): Promise<ReplicaVariant | null> {
  const row = await one<VariantRow>("SELECT * FROM replica_variants WHERE replica_id = ? AND ui_kit = ?", [
    replicaId,
    uiKit,
  ]);
  return row ? toVariant(row) : null;
}

export async function ensureVariant(replicaId: string, uiKit: UiKit): Promise<ReplicaVariant> {
  const existing = await getVariantByKit(replicaId, uiKit);
  if (existing) return existing;
  const id = newId();
  const ts = now();
  await run(
    `INSERT INTO replica_variants (id, replica_id, ui_kit, status, version, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', 0, ?, ?)`,
    [id, replicaId, uiKit, ts, ts],
  );
  return (await getVariant(id))!;
}

export async function setVariantStatus(
  id: string,
  status: ReplicaStatus,
  opts: { lastError?: string | null; buildDir?: string | null } = {},
): Promise<void> {
  const sets = ["status = ?", "updated_at = ?"];
  const args: (string | number | null)[] = [status, now()];
  if (opts.lastError !== undefined) {
    sets.push("last_error = ?");
    args.push(opts.lastError);
  }
  if (opts.buildDir !== undefined) {
    sets.push("build_dir = ?");
    args.push(opts.buildDir);
  }
  args.push(id);
  await run(`UPDATE replica_variants SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function bumpVariantVersion(id: string): Promise<number> {
  await run("UPDATE replica_variants SET version = version + 1, updated_at = ? WHERE id = ?", [now(), id]);
  const row = await one<{ version: number }>("SELECT version FROM replica_variants WHERE id = ?", [id]);
  return row?.version ?? 1;
}

/* ─────────────────────────────── Versions ────────────────────────────────── */

export async function createVersionRecord(input: {
  variantId: string;
  version: number;
  note: string;
  sizeBytes: number;
}): Promise<void> {
  await run(
    `INSERT INTO replica_versions (id, variant_id, version, note, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), input.variantId, input.version, input.note, input.sizeBytes, now()],
  );
}

export async function listVersions(variantId: string): Promise<ReplicaVersion[]> {
  const rows = await all<{
    id: string;
    variant_id: string;
    version: number;
    note: string;
    size_bytes: number;
    created_at: string;
  }>("SELECT * FROM replica_versions WHERE variant_id = ? ORDER BY version DESC", [variantId]);
  return rows.map((r) => ({
    id: r.id,
    variantId: r.variant_id,
    version: r.version,
    note: r.note,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }));
}

export async function getLatestVersion(variantId: string): Promise<number> {
  const row = await one<{ v: number | null }>(
    "SELECT MAX(version) AS v FROM replica_versions WHERE variant_id = ?",
    [variantId],
  );
  return row?.v ?? 0;
}

/* ─────────────────────────────── Jobs ────────────────────────────────────── */

interface JobRow {
  id: string;
  replica_id: string;
  variant_id: string;
  type: JobType;
  status: JobStatus;
  phase: AgentPhase;
  progress: number;
  message: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    replicaId: r.replica_id,
    variantId: r.variant_id,
    type: r.type,
    status: r.status,
    phase: r.phase,
    progress: r.progress,
    message: r.message,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
  };
}

export async function createJob(input: {
  replicaId: string;
  variantId: string;
  type: JobType;
}): Promise<Job> {
  const id = newId();
  await run(
    `INSERT INTO jobs (id, replica_id, variant_id, type, status, phase, progress, message, created_at)
     VALUES (?, ?, ?, ?, 'queued', 'idle', 0, '', ?)`,
    [id, input.replicaId, input.variantId, input.type, now()],
  );
  return (await getJob(id))!;
}

export async function getJob(id: string): Promise<Job | null> {
  const row = await one<JobRow>("SELECT * FROM jobs WHERE id = ?", [id]);
  return row ? toJob(row) : null;
}

export async function listJobs(options: { replicaId?: string; limit?: number } = {}): Promise<Job[]> {
  const where = options.replicaId ? "WHERE replica_id = ?" : "";
  const args = options.replicaId ? [options.replicaId] : [];
  const rows = await all<JobRow>(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`,
    [...args, options.limit ?? 100],
  );
  return rows.map(toJob);
}

export async function listPendingJobs(): Promise<Job[]> {
  const rows = await all<JobRow>("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC");
  return rows.map(toJob);
}

export async function updateJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    phase: AgentPhase;
    progress: number;
    message: string;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    /** opencode session id, stored on the variants' job for context continuity. */
    opencodeSessionId: string | null;
  }>,
): Promise<void> {
  const map: Record<string, string> = {
    status: "status",
    phase: "phase",
    progress: "progress",
    message: "message",
    error: "error",
    startedAt: "started_at",
    finishedAt: "finished_at",
    opencodeSessionId: "opencode_session_id",
  };
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      args.push(value as string | number | null);
    }
  }
  if (sets.length === 0) return;
  args.push(id);
  await run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function addJobEvent(input: {
  jobId: string;
  phase?: AgentPhase | null;
  level?: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}): Promise<void> {
  await run(
    "INSERT INTO job_events (job_id, at, phase, level, message, data) VALUES (?, ?, ?, ?, ?, ?)",
    [
      input.jobId,
      now(),
      input.phase ?? null,
      input.level ?? "info",
      input.message,
      input.data === undefined ? null : JSON.stringify(input.data),
    ],
  );
}

export async function listJobEvents(jobId: string, limit = 200) {
  return all<{ id: number; at: string; phase: string | null; level: string; message: string; data: string | null }>(
    "SELECT * FROM job_events WHERE job_id = ? ORDER BY id ASC LIMIT ?",
    [jobId, limit],
  );
}

export async function recoverInterruptedJobs(): Promise<void> {
  await run(
    "UPDATE jobs SET status = 'queued', phase = 'idle', message = 'Recovered after restart', started_at = NULL WHERE status = 'running'",
  );
}
