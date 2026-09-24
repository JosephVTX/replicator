import { z } from "zod";

/* ─────────────────────────────── Core domain ─────────────────────────────── */

export const Roles = ["admin", "user"] as const;
export type Role = (typeof Roles)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** A UI kit a replica can be generated/exported in. */
export const UiKits = ["shadcn", "daisyui"] as const;
export type UiKit = (typeof UiKits)[number];

export const ReplicaStatuses = [
  "draft",
  "queued",
  "running",
  "verifying",
  "ready",
  "failed",
  "canceled",
] as const;
export type ReplicaStatus = (typeof ReplicaStatuses)[number];

export const JobTypes = ["replicate", "reverify", "port"] as const;
export type JobType = (typeof JobTypes)[number];

export const JobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JobStatuses)[number];

/** High level phase the agent is in, surfaced to the UI. */
export const AgentPhases = [
  "idle",
  "recon",
  "map",
  "extract",
  "build",
  "verify",
  "deliver",
  "done",
] as const;
export type AgentPhase = (typeof AgentPhases)[number];

export interface Replica {
  id: string;
  slug: string;
  name: string;
  sourceUrl: string;
  status: ReplicaStatus;
  isPublic: boolean;
  ownerId: string;
  ownerName?: string;
  /** Variant currently shown as the canonical preview. */
  activeVariantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReplicaVariant {
  id: string;
  replicaId: string;
  uiKit: UiKit;
  status: ReplicaStatus;
  /** Latest successful version number (0 = none yet). */
  version: number;
  /** Relative path of the built static site, when available. */
  buildDir: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReplicaVersion {
  id: string;
  variantId: string;
  version: number;
  note: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Job {
  id: string;
  replicaId: string;
  variantId: string;
  type: JobType;
  status: JobStatus;
  phase: AgentPhase;
  progress: number;
  message: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/* ─────────────────────────────── Settings ────────────────────────────────── */

export const ProviderIds = ["openrouter", "opencode", "custom"] as const;
export type ProviderId = (typeof ProviderIds)[number];

export interface ProviderAccount {
  id: string;
  provider: ProviderId;
  label: string;
  baseUrl: string | null;
  /** Whether an API key is stored. The key itself is never returned by the API. */
  hasKey: boolean;
  /** Model ids discovered/imported for this provider. */
  models: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  name: string;
  free: boolean;
  contextLength: number | null;
}

export interface AgentSettings {
  /** Default model in `providerID/modelID` form used for replication. */
  defaultModel: string;
  /** Optional cheaper model for mechanical steps (extraction, porting). */
  utilityModel: string;
  maxStepsPerRun: number;
  tokenBudgetPerRun: number;
}

/* ─────────────────────────────── API payloads ────────────────────────────── */

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(400),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(400),
  role: z.enum(Roles).default("user"),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(Roles).optional(),
  disabled: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(400).optional(),
  newPassword: z.string().min(8).max(400),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs are supported");

export const createReplicaSchema = z.object({
  name: z.string().min(1).max(120),
  sourceUrl: httpUrlSchema,
  uiKit: z.enum(UiKits).default("shadcn"),
  /** Optional best-effort instructions for the agent. */
  notes: z.string().max(4000).optional(),
});
export type CreateReplicaInput = z.infer<typeof createReplicaSchema>;

export const portVariantSchema = z.object({
  uiKit: z.enum(UiKits),
});
export type PortVariantInput = z.infer<typeof portVariantSchema>;

export const updateReplicaSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isPublic: z.boolean().optional(),
  activeVariantId: z.string().optional(),
});
export type UpdateReplicaInput = z.infer<typeof updateReplicaSchema>;

export const upsertProviderSchema = z.object({
  provider: z.enum(ProviderIds),
  label: z.string().min(1).max(120),
  baseUrl: z.string().url().max(400).nullable().optional(),
  apiKey: z.string().max(400).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type UpsertProviderInput = z.infer<typeof upsertProviderSchema>;

export const updateAgentSettingsSchema = z.object({
  defaultModel: z.string().min(1).max(200),
  utilityModel: z.string().max(200).default(""),
  maxStepsPerRun: z.number().int().min(1).max(500),
  tokenBudgetPerRun: z.number().int().min(1000).max(100_000_000),
});
export type UpdateAgentSettingsInput = z.infer<typeof updateAgentSettingsSchema>;

/* ─────────────────────────────── Helpers ─────────────────────────────────── */

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}
