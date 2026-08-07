CREATE TABLE IF NOT EXISTS axis_state_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS axis_background_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_repository_name TEXT,
  repository_name TEXT,
  priority INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER,
  requested_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  last_heartbeat_at TEXT,
  lease_id TEXT,
  lease_expires_at TEXT,
  progress_json TEXT,
  result_json TEXT,
  failure_json TEXT,
  cancel_requested_at TEXT,
  record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS axis_background_jobs_requested_idx
  ON axis_background_jobs (requested_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_background_jobs_repository_idx
  ON axis_background_jobs (repository_name, requested_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_background_jobs_status_idx
  ON axis_background_jobs (status, requested_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_background_jobs_type_idx
  ON axis_background_jobs (type, requested_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_background_jobs_runnable_idx
  ON axis_background_jobs (status, lease_expires_at, priority DESC, scheduled_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS axis_background_jobs_subject_idx
  ON axis_background_jobs (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS axis_repository_artifacts (
  id TEXT PRIMARY KEY,
  repository_name TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  identity TEXT NOT NULL,
  family TEXT,
  family_key TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  summary TEXT NOT NULL,
  primary_object_key TEXT,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_json TEXT NOT NULL,
  UNIQUE(repository_name, identity)
);
CREATE INDEX IF NOT EXISTS axis_repository_artifacts_listing_idx
  ON axis_repository_artifacts (repository_name, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_repository_artifacts_family_idx
  ON axis_repository_artifacts (repository_name, family_key, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS axis_repository_artifacts_family_listing_idx
  ON axis_repository_artifacts (repository_name, family_key);
