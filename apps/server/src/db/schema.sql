PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS replicas (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  is_public INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_variant_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replicas_owner ON replicas(owner_id);

CREATE TABLE IF NOT EXISTS replica_variants (
  id TEXT PRIMARY KEY,
  replica_id TEXT NOT NULL REFERENCES replicas(id) ON DELETE CASCADE,
  ui_kit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 0,
  build_dir TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (replica_id, ui_kit)
);

CREATE TABLE IF NOT EXISTS replica_versions (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES replica_variants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (variant_id, version)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  replica_id TEXT NOT NULL REFERENCES replicas(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES replica_variants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'idle',
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  opencode_session_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_replica ON jobs(replica_id);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  phase TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  base_url TEXT,
  api_key_enc TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
