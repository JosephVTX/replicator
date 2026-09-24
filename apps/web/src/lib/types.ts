import type { Job, ModelInfo, ProviderAccount, Replica, ReplicaVariant, ReplicaVersion, User, AgentSettings } from "@replicator/shared";

export type ReplicaWithVariants = Replica & { variants: ReplicaVariant[] };
export type VariantWithVersions = ReplicaVariant & { versions: ReplicaVersion[] };

export interface ReplicaDetailResponse {
  replica: Replica;
  variants: VariantWithVersions[];
  jobs: Job[];
}

export interface JobEvent {
  id: number;
  at: string;
  phase: string | null;
  level: string;
  message: string;
  data: string | null;
}

export interface JobResponse {
  job: Job;
  events: JobEvent[];
}

export interface UsersResponse {
  items: User[];
}

export interface ProvidersResponse {
  items: ProviderAccount[];
  defaults: Record<string, string>;
}

export interface ModelsResponse {
  items: ModelInfo[];
  errors: string[];
}

export interface AgentSettingsResponse {
  settings: AgentSettings;
  online: boolean;
}

export type { Job, ModelInfo, ProviderAccount, Replica, ReplicaVariant, ReplicaVersion, User, AgentSettings };
