import type {
  AdminRefreshSessionRecord,
  AdminRefreshSessionStore,
  AdminUserRecord,
  AdminUserStore,
  BackgroundJobListQuery,
  BackgroundJobRecord,
  BackgroundJobStore,
  PublishTokenRecord,
  PublishTokenStore,
  Repository,
  RepositoryArtifactFamilyRecord,
  RepositoryArtifactRecord,
  RepositoryArtifactStore,
  RepositoryPluginPolicyRecord,
  RepositoryPluginPolicyStore,
  RepositoryStore,
  RuntimeSettingsRecord,
  RuntimeSettingsStore,
  StateStore,
} from "@axis-repository/core";
import { DurableStateStore, type DurableStorage } from "./durable-state";

const D1_ARTIFACT_BATCH_SIZE = 100;

export const D1_SHARED_INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS axis_state_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS axis_repositories (
  name TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  kind TEXT NOT NULL,
  visibility TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS axis_repositories_name_idx
  ON axis_repositories (name ASC);

CREATE TABLE IF NOT EXISTS axis_publish_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS axis_publish_tokens_name_idx
  ON axis_publish_tokens (name ASC);

CREATE TABLE IF NOT EXISTS axis_admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS axis_admin_users_username_idx
  ON axis_admin_users (username ASC);

CREATE TABLE IF NOT EXISTS axis_admin_refresh_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS axis_admin_refresh_sessions_created_idx
  ON axis_admin_refresh_sessions (created_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS axis_repository_plugin_policies (
  ecosystem TEXT PRIMARY KEY,
  record_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS axis_runtime_settings (
  id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS axis_repository_write_locks (
  repository_name TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`;

class D1SharedStateSchema {
  private initialized?: Promise<void>;

  constructor(private readonly database: D1Database) {}

  ensure(): Promise<void> {
    this.initialized ??= this.initialize();
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    for (const statement of splitSqlStatements(D1_SHARED_INDEX_SCHEMA)) {
      await this.database.prepare(statement).run();
    }
  }
}

export class D1KeyValueStorage implements DurableStorage {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT value_json FROM axis_state_kv WHERE key = ?")
      .bind(key)
      .first<{ value_json: string }>();
    return row === null ? undefined : parseRecord<T>(row.value_json);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_state_kv (key, value_json) VALUES (?, ?)"
        + " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      )
      .bind(key, JSON.stringify(value))
      .run();
  }

  async delete(key: string): Promise<boolean> {
    await this.schema.ensure();
    const exists = await this.get(key);
    await this.database
      .prepare("DELETE FROM axis_state_kv WHERE key = ?")
      .bind(key)
      .run();
    return exists !== undefined;
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    await this.schema.ensure();
    const rows = options?.prefix === undefined
      ? await this.database
        .prepare("SELECT key, value_json FROM axis_state_kv ORDER BY key ASC")
        .all<{ key: string; value_json: string }>()
      : await this.database
        .prepare("SELECT key, value_json FROM axis_state_kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key ASC")
        .bind(`${escapeSqlLike(options.prefix)}%`)
        .all<{ key: string; value_json: string }>();
    const result = new Map<string, T>();
    for (const row of rows.results) {
      result.set(row.key, parseRecord<T>(row.value_json));
    }
    return result;
  }
}

export class D1RepositoryStore implements RepositoryStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async getByName(name: string): Promise<Repository | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_repositories WHERE name = ?")
      .bind(name)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<Repository>(row.record_json);
  }

  async list(): Promise<Repository[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare("SELECT record_json FROM axis_repositories ORDER BY name ASC")
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<Repository>(row.record_json));
  }

  async save(repository: Repository): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_repositories (name, id, ecosystem, kind, visibility, updated_at, record_json)"
        + " VALUES (?, ?, ?, ?, ?, ?, ?)"
        + " ON CONFLICT(name) DO UPDATE SET"
        + " id = excluded.id, ecosystem = excluded.ecosystem, kind = excluded.kind,"
        + " visibility = excluded.visibility, updated_at = excluded.updated_at,"
        + " record_json = excluded.record_json",
      )
      .bind(
        repository.name,
        repository.id,
        repository.ecosystem,
        repository.kind,
        repository.visibility,
        repository.updatedAt,
        JSON.stringify(repository),
      )
      .run();
  }

  async deleteByName(name: string): Promise<boolean> {
    await this.schema.ensure();
    const existing = await this.getByName(name);
    await this.database
      .prepare("DELETE FROM axis_repositories WHERE name = ?")
      .bind(name)
      .run();
    return existing !== null;
  }
}

export class D1PublishTokenStore implements PublishTokenStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async getById(id: string): Promise<PublishTokenRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_publish_tokens WHERE id = ?")
      .bind(id)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<PublishTokenRecord>(row.record_json);
  }

  async getByName(name: string): Promise<PublishTokenRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_publish_tokens WHERE name = ?")
      .bind(name)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<PublishTokenRecord>(row.record_json);
  }

  async list(): Promise<PublishTokenRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare("SELECT record_json FROM axis_publish_tokens ORDER BY name ASC")
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<PublishTokenRecord>(row.record_json));
  }

  async save(token: PublishTokenRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare("DELETE FROM axis_publish_tokens WHERE name = ? AND id <> ?")
      .bind(token.name, token.id)
      .run();
    await this.database
      .prepare(
        "INSERT INTO axis_publish_tokens (id, name, created_at, record_json)"
        + " VALUES (?, ?, ?, ?)"
        + " ON CONFLICT(id) DO UPDATE SET"
        + " name = excluded.name, created_at = excluded.created_at, record_json = excluded.record_json",
      )
      .bind(token.id, token.name, token.createdAt, JSON.stringify(token))
      .run();
  }

  async deleteByName(name: string): Promise<boolean> {
    await this.schema.ensure();
    const existing = await this.getByName(name);
    await this.database
      .prepare("DELETE FROM axis_publish_tokens WHERE name = ?")
      .bind(name)
      .run();
    return existing !== null;
  }
}

export class D1AdminUserStore implements AdminUserStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async getById(id: string): Promise<AdminUserRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_admin_users WHERE id = ?")
      .bind(id)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<AdminUserRecord>(row.record_json);
  }

  async getByUsername(username: string): Promise<AdminUserRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_admin_users WHERE username = ?")
      .bind(username)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<AdminUserRecord>(row.record_json);
  }

  async list(): Promise<AdminUserRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare("SELECT record_json FROM axis_admin_users ORDER BY username ASC")
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<AdminUserRecord>(row.record_json));
  }

  async save(user: AdminUserRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare("DELETE FROM axis_admin_users WHERE username = ? AND id <> ?")
      .bind(user.username, user.id)
      .run();
    await this.database
      .prepare(
        "INSERT INTO axis_admin_users (id, username, record_json)"
        + " VALUES (?, ?, ?)"
        + " ON CONFLICT(id) DO UPDATE SET username = excluded.username, record_json = excluded.record_json",
      )
      .bind(user.id, user.username, JSON.stringify(user))
      .run();
  }
}

export class D1AdminRefreshSessionStore implements AdminRefreshSessionStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async get(id: string): Promise<AdminRefreshSessionRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_admin_refresh_sessions WHERE id = ?")
      .bind(id)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<AdminRefreshSessionRecord>(row.record_json);
  }

  async list(): Promise<AdminRefreshSessionRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare("SELECT record_json FROM axis_admin_refresh_sessions ORDER BY created_at DESC, id ASC")
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<AdminRefreshSessionRecord>(row.record_json));
  }

  async save(session: AdminRefreshSessionRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_admin_refresh_sessions (id, created_at, record_json)"
        + " VALUES (?, ?, ?)"
        + " ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, record_json = excluded.record_json",
      )
      .bind(session.id, session.createdAt, JSON.stringify(session))
      .run();
  }

  async delete(id: string): Promise<boolean> {
    await this.schema.ensure();
    const existing = await this.get(id);
    await this.database
      .prepare("DELETE FROM axis_admin_refresh_sessions WHERE id = ?")
      .bind(id)
      .run();
    return existing !== null;
  }
}

export class D1RepositoryPluginPolicyStore implements RepositoryPluginPolicyStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async getByEcosystem(ecosystem: string): Promise<RepositoryPluginPolicyRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_repository_plugin_policies WHERE ecosystem = ?")
      .bind(ecosystem)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<RepositoryPluginPolicyRecord>(row.record_json);
  }

  async list(): Promise<RepositoryPluginPolicyRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare("SELECT record_json FROM axis_repository_plugin_policies ORDER BY ecosystem ASC")
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<RepositoryPluginPolicyRecord>(row.record_json));
  }

  async save(record: RepositoryPluginPolicyRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_repository_plugin_policies (ecosystem, record_json) VALUES (?, ?)"
        + " ON CONFLICT(ecosystem) DO UPDATE SET record_json = excluded.record_json",
      )
      .bind(record.ecosystem, JSON.stringify(record))
      .run();
  }
}

export class D1RuntimeSettingsStore implements RuntimeSettingsStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async get(): Promise<RuntimeSettingsRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_runtime_settings WHERE id = ?")
      .bind("default")
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<RuntimeSettingsRecord>(row.record_json);
  }

  async save(record: RuntimeSettingsRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_runtime_settings (id, record_json) VALUES (?, ?)"
        + " ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json",
      )
      .bind("default", JSON.stringify(record))
      .run();
  }
}

export class D1BackgroundJobStore implements BackgroundJobStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async get(id: string): Promise<BackgroundJobRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare("SELECT record_json FROM axis_background_jobs WHERE id = ?")
      .bind(id)
      .first<{ record_json: string }>();
    return row === null ? null : parseRecord<BackgroundJobRecord>(row.record_json);
  }

  async list(query: BackgroundJobListQuery = {}): Promise<{ jobs: BackgroundJobRecord[]; total: number }> {
    await this.schema.ensure();
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.repositoryName !== undefined) {
      where.push("repository_name = ?");
      values.push(query.repositoryName);
    }
    if (query.status !== undefined) {
      where.push("status = ?");
      values.push(query.status);
    }
    if (query.type !== undefined) {
      where.push("type = ?");
      values.push(query.type);
    }
    const whereSql = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
    const total = await this.count(`SELECT COUNT(*) AS total FROM axis_background_jobs${whereSql}`, values);
    const limit = query.limit ?? total;
    const offset = query.offset ?? 0;
    const rows = await this.database
      .prepare(
        `SELECT record_json FROM axis_background_jobs${whereSql}`
        + " ORDER BY requested_at DESC, id ASC LIMIT ? OFFSET ?",
      )
      .bind(...values, limit, offset)
      .all<{ record_json: string }>();
    return {
      jobs: rows.results.map((row) => parseRecord<BackgroundJobRecord>(row.record_json)),
      total,
    };
  }

  async listRunnable(input: { limit: number }): Promise<BackgroundJobRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare(
        "SELECT record_json FROM axis_background_jobs"
        + " WHERE status = 'pending' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)"
        + " ORDER BY priority DESC, scheduled_at ASC, id ASC LIMIT ?",
      )
      .bind(new Date().toISOString(), input.limit)
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<BackgroundJobRecord>(row.record_json));
  }

  async acquireRunnable(input: {
    leaseId: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<BackgroundJobRecord | null> {
    await this.schema.ensure();
    const row = await this.database
      .prepare(
        "SELECT record_json FROM axis_background_jobs"
        + " WHERE status = 'pending' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)"
        + " ORDER BY priority DESC, scheduled_at ASC, id ASC LIMIT 1",
      )
      .bind(input.now)
      .first<{ record_json: string }>();
    if (row === null) return null;
    const candidate = parseRecord<BackgroundJobRecord>(row.record_json);
    const leased: BackgroundJobRecord = {
      ...candidate,
      status: "running",
      startedAt: candidate.startedAt ?? input.now,
      lastHeartbeatAt: input.now,
      leaseId: input.leaseId,
      leaseExpiresAt: input.leaseExpiresAt,
    };
    const updated = await this.database
      .prepare(
        "UPDATE axis_background_jobs SET"
        + " status = ?, started_at = ?, last_heartbeat_at = ?, lease_id = ?, lease_expires_at = ?, record_json = ?"
        + " WHERE id = ? AND (status = 'pending' OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?))",
      )
      .bind(
        leased.status,
        leased.startedAt,
        leased.lastHeartbeatAt,
        leased.leaseId,
        leased.leaseExpiresAt,
        JSON.stringify(leased),
        leased.id,
        input.now,
      )
      .run();
    return d1ChangedRows(updated) === 0 ? null : leased;
  }

  async save(record: BackgroundJobRecord): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare(
        "INSERT INTO axis_background_jobs ("
        + "id, type, status, subject_type, subject_id, subject_repository_name, repository_name,"
        + " priority, attempts, max_attempts, requested_at, scheduled_at, started_at, finished_at,"
        + " last_heartbeat_at, lease_id, lease_expires_at, progress_json, result_json, failure_json,"
        + " cancel_requested_at, record_json"
        + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        + " ON CONFLICT(id) DO UPDATE SET"
        + " type = excluded.type, status = excluded.status, subject_type = excluded.subject_type,"
        + " subject_id = excluded.subject_id, subject_repository_name = excluded.subject_repository_name,"
        + " repository_name = excluded.repository_name, priority = excluded.priority, attempts = excluded.attempts,"
        + " max_attempts = excluded.max_attempts, requested_at = excluded.requested_at,"
        + " scheduled_at = excluded.scheduled_at, started_at = excluded.started_at,"
        + " finished_at = excluded.finished_at, last_heartbeat_at = excluded.last_heartbeat_at,"
        + " lease_id = excluded.lease_id, lease_expires_at = excluded.lease_expires_at,"
        + " progress_json = excluded.progress_json, result_json = excluded.result_json,"
        + " failure_json = excluded.failure_json, cancel_requested_at = excluded.cancel_requested_at,"
        + " record_json = excluded.record_json",
      )
      .bind(
        record.id,
        record.type,
        record.status,
        record.subject.type,
        record.subject.id,
        record.subject.repositoryName ?? null,
        record.repositoryName ?? null,
        record.priority,
        record.attempts,
        record.maxAttempts ?? null,
        record.requestedAt,
        record.scheduledAt,
        record.startedAt ?? null,
        record.finishedAt ?? null,
        record.lastHeartbeatAt ?? null,
        record.leaseId ?? null,
        record.leaseExpiresAt ?? null,
        optionalJson(record.progress),
        optionalJson(record.result),
        optionalJson(record.failure),
        record.cancelRequestedAt ?? null,
        JSON.stringify(record),
      )
      .run();
  }

  async cancel(id: string, requestedAt: string): Promise<BackgroundJobRecord | null> {
    await this.schema.ensure();
    const existing = await this.get(id);
    if (existing === null) return null;
    const canceled: BackgroundJobRecord = existing.status === "pending"
      ? { ...existing, status: "canceled", cancelRequestedAt: requestedAt, finishedAt: requestedAt }
      : existing.status === "running"
        ? { ...existing, status: "canceling", cancelRequestedAt: requestedAt }
        : existing;
    await this.save(canceled);
    return canceled;
  }

  async deleteBySubject(subject: { type: string; id: string }): Promise<number> {
    await this.schema.ensure();
    const total = await this.count(
      "SELECT COUNT(*) AS total FROM axis_background_jobs WHERE subject_type = ? AND subject_id = ?",
      [subject.type, subject.id],
    );
    await this.database
      .prepare("DELETE FROM axis_background_jobs WHERE subject_type = ? AND subject_id = ?")
      .bind(subject.type, subject.id)
      .run();
    return total;
  }

  async deleteByRepository(repositoryName: string): Promise<number> {
    await this.schema.ensure();
    const total = await this.count(
      "SELECT COUNT(*) AS total FROM axis_background_jobs WHERE repository_name = ?",
      [repositoryName],
    );
    await this.database
      .prepare("DELETE FROM axis_background_jobs WHERE repository_name = ?")
      .bind(repositoryName)
      .run();
    return total;
  }

  private async count(query: string, values: unknown[]): Promise<number> {
    const row = await this.database.prepare(query).bind(...values).first<{ total: number }>();
    return row?.total ?? 0;
  }
}

export class D1RepositoryArtifactStore implements RepositoryArtifactStore {
  constructor(
    private readonly database: D1Database,
    private readonly schema = new D1SharedStateSchema(database),
  ) {}

  async listByRepository(repositoryName: string): Promise<RepositoryArtifactRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare(
        "SELECT record_json FROM axis_repository_artifacts WHERE repository_name = ?"
        + " ORDER BY updated_at DESC, id ASC",
      )
      .bind(repositoryName)
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<RepositoryArtifactRecord>(row.record_json));
  }

  async listFamiliesByRepositoryPage(
    repositoryName: string,
    page: { limit: number; offset: number },
  ): Promise<{ records: RepositoryArtifactFamilyRecord[]; totalFamilies: number; totalArtifacts: number }> {
    await this.schema.ensure();
    const totals = await this.database
      .prepare(
        "SELECT COUNT(*) AS total_artifacts, COUNT(DISTINCT family_key) AS total_families"
        + " FROM axis_repository_artifacts WHERE repository_name = ?",
      )
      .bind(repositoryName)
      .first<{ total_artifacts: number; total_families: number }>();
    const rows = await this.database
      .prepare(
        "WITH family_stats AS ("
        + " SELECT family_key, MAX(updated_at) AS family_updated_at, COUNT(*) AS artifact_count,"
        + " COUNT(DISTINCT version) AS version_count"
        + " FROM axis_repository_artifacts WHERE repository_name = ? GROUP BY family_key"
        + "), ranked AS ("
        + " SELECT a.*, ROW_NUMBER() OVER ("
        + " PARTITION BY a.family_key ORDER BY CASE WHEN a.version IS NULL THEN 1 ELSE 0 END,"
        + " a.updated_at DESC, a.id ASC) AS rank"
        + " FROM axis_repository_artifacts a WHERE a.repository_name = ?"
        + ")"
        + " SELECT ranked.record_json, family_stats.artifact_count, family_stats.version_count,"
        + " family_stats.family_updated_at"
        + " FROM family_stats JOIN ranked ON ranked.family_key = family_stats.family_key AND ranked.rank = 1"
        + " ORDER BY family_stats.family_updated_at DESC, family_stats.family_key ASC LIMIT ? OFFSET ?",
      )
      .bind(repositoryName, repositoryName, page.limit, page.offset)
      .all<{
        record_json: string;
        artifact_count: number;
        version_count: number;
        family_updated_at: string;
      }>();
    return {
      records: rows.results.map((row) => {
        const latestArtifact = parseRecord<RepositoryArtifactRecord>(row.record_json);
        return {
          key: latestArtifact.family ?? latestArtifact.id,
          repositoryName: latestArtifact.repositoryName,
          ecosystem: latestArtifact.ecosystem,
          name: latestArtifact.name,
          ...(latestArtifact.version === undefined ? {} : { latestVersion: latestArtifact.version }),
          latestSummary: latestArtifact.summary,
          latestPublishedAt: latestArtifact.publishedAt,
          updatedAt: row.family_updated_at,
          artifactCount: row.artifact_count,
          versionCount: row.version_count,
          latestArtifact,
        };
      }),
      totalFamilies: totals?.total_families ?? 0,
      totalArtifacts: totals?.total_artifacts ?? 0,
    };
  }

  async listByRepositoryPage(
    repositoryName: string,
    page: { limit: number; offset: number },
  ): Promise<{ records: RepositoryArtifactRecord[]; total: number }> {
    await this.schema.ensure();
    const total = await this.count(
      "SELECT COUNT(*) AS total FROM axis_repository_artifacts WHERE repository_name = ?",
      [repositoryName],
    );
    const rows = await this.database
      .prepare(
        "SELECT record_json FROM axis_repository_artifacts WHERE repository_name = ?"
        + " ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?",
      )
      .bind(repositoryName, page.limit, page.offset)
      .all<{ record_json: string }>();
    return {
      records: rows.results.map((row) => parseRecord<RepositoryArtifactRecord>(row.record_json)),
      total,
    };
  }

  async listByRepositoryFamily(repositoryName: string, family: string): Promise<RepositoryArtifactRecord[]> {
    await this.schema.ensure();
    const rows = await this.database
      .prepare(
        "SELECT record_json FROM axis_repository_artifacts WHERE repository_name = ? AND family_key = ?"
        + " ORDER BY updated_at DESC, id ASC",
      )
      .bind(repositoryName, family)
      .all<{ record_json: string }>();
    return rows.results.map((row) => parseRecord<RepositoryArtifactRecord>(row.record_json));
  }

  async upsert(record: RepositoryArtifactRecord): Promise<void> {
    await this.schema.ensure();
    await this.upsertStatement(record).run();
  }

  async upsertMany(records: RepositoryArtifactRecord[]): Promise<void> {
    await this.schema.ensure();
    for (let index = 0; index < records.length; index += D1_ARTIFACT_BATCH_SIZE) {
      const chunk = records.slice(index, index + D1_ARTIFACT_BATCH_SIZE);
      if (chunk.length === 0) continue;
      await this.database.batch(chunk.map((record) => this.upsertStatement(record)));
    }
  }

  async replaceByRepository(repositoryName: string, records: RepositoryArtifactRecord[]): Promise<void> {
    await this.schema.ensure();
    await this.database
      .prepare("DELETE FROM axis_repository_artifacts WHERE repository_name = ?")
      .bind(repositoryName)
      .run();
    await this.database.batch(records.map((record) => this.upsertStatement(record)));
  }

  private upsertStatement(record: RepositoryArtifactRecord): D1PreparedStatement {
    return this.database
      .prepare(
        "INSERT INTO axis_repository_artifacts ("
        + "id, repository_name, ecosystem, identity, family, family_key, name, version, summary,"
        + " primary_object_key, published_at, updated_at, record_json"
        + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        + " ON CONFLICT(repository_name, identity) DO UPDATE SET"
        + " id = excluded.id, ecosystem = excluded.ecosystem, family = excluded.family,"
        + " family_key = excluded.family_key, name = excluded.name, version = excluded.version,"
        + " summary = excluded.summary, primary_object_key = excluded.primary_object_key,"
        + " published_at = excluded.published_at, updated_at = excluded.updated_at,"
        + " record_json = excluded.record_json",
      )
      .bind(
        record.id,
        record.repositoryName,
        record.ecosystem,
        record.identity,
        record.family ?? null,
        record.family ?? record.id,
        record.name,
        record.version ?? null,
        record.summary,
        record.primaryObjectKey ?? null,
        record.publishedAt,
        record.updatedAt,
        JSON.stringify(record),
      );
  }

  private async count(query: string, values: unknown[]): Promise<number> {
    const row = await this.database.prepare(query).bind(...values).first<{ total: number }>();
    return row?.total ?? 0;
  }
}

export function withD1SharedIndexes(base: StateStore, database: D1Database): StateStore {
  const schema = new D1SharedStateSchema(database);
  return {
    ...base,
    repositories: new D1RepositoryStore(database, schema),
    publishTokens: new D1PublishTokenStore(database, schema),
    adminUsers: new D1AdminUserStore(database, schema),
    adminRefreshSessions: new D1AdminRefreshSessionStore(database, schema),
    repositoryPluginPolicies: new D1RepositoryPluginPolicyStore(database, schema),
    runtimeSettings: new D1RuntimeSettingsStore(database, schema),
    backgroundJobs: new D1BackgroundJobStore(database, schema),
    repositoryArtifacts: new D1RepositoryArtifactStore(database, schema),
  };
}

export function createD1StateStore(database: D1Database): StateStore {
  const schema = new D1SharedStateSchema(database);
  return {
    ...new DurableStateStore(new D1KeyValueStorage(database, schema)),
    repositories: new D1RepositoryStore(database, schema),
    publishTokens: new D1PublishTokenStore(database, schema),
    adminUsers: new D1AdminUserStore(database, schema),
    adminRefreshSessions: new D1AdminRefreshSessionStore(database, schema),
    repositoryPluginPolicies: new D1RepositoryPluginPolicyStore(database, schema),
    runtimeSettings: new D1RuntimeSettingsStore(database, schema),
    backgroundJobs: new D1BackgroundJobStore(database, schema),
    repositoryArtifacts: new D1RepositoryArtifactStore(database, schema),
  };
}

function escapeSqlLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseRecord<T>(json: string): T {
  return JSON.parse(json) as T;
}

function d1ChangedRows(result: D1Result): number {
  const changes = result.meta.changes;
  return typeof changes === "number" ? changes : 0;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (inString) {
      current += char;
      if (char === quote) {
        if (sql[index + 1] === quote) {
          current += sql[index + 1];
          index += 1;
        } else {
          inString = false;
          quote = "";
        }
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = true;
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += char;
  }
  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}
