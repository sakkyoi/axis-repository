import { describe, expect, it } from "vitest";
import { describeStateStoreContract } from "@axis-repository/core/test-support";
import type { StateStore } from "@axis-repository/core";
import { D1_SHARED_INDEX_SCHEMA, createD1StateStore } from "./d1-state";

class FakeD1Database {
  private readonly repositories = new Map<string, Record<string, unknown>>();
  private readonly publishTokens = new Map<string, Record<string, unknown>>();
  private readonly adminUsers = new Map<string, Record<string, unknown>>();
  private readonly adminRefreshSessions = new Map<string, Record<string, unknown>>();
  private readonly repositoryPluginPolicies = new Map<string, Record<string, unknown>>();
  private readonly runtimeSettings = new Map<string, Record<string, unknown>>();
  private readonly backgroundJobs = new Map<string, Record<string, unknown>>();
  private readonly repositoryArtifacts = new Map<string, Record<string, unknown>>();
  private readonly stateKv = new Map<string, string>();
  readonly preparedQueries: string[] = [];
  readonly batchSizes: number[] = [];
  execCount = 0;

  stateKvSize(): number {
    return this.stateKv.size;
  }

  prepare(query: string): D1PreparedStatement {
    this.preparedQueries.push(query);
    return new FakeD1PreparedStatement(query, {
      repositories: this.repositories,
      publishTokens: this.publishTokens,
      adminUsers: this.adminUsers,
      adminRefreshSessions: this.adminRefreshSessions,
      repositoryPluginPolicies: this.repositoryPluginPolicies,
      runtimeSettings: this.runtimeSettings,
      backgroundJobs: this.backgroundJobs,
      repositoryArtifacts: this.repositoryArtifacts,
      stateKv: this.stateKv,
    }) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.batchSizes.push(statements.length);
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.execCount += 1;
    for (const statement of query.split(";").map((part) => part.trim()).filter(Boolean)) {
      this.prepare(statement).run();
    }
    return { count: 0, duration: 0 };
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error("Not implemented");
  }
}

interface FakeD1Tables {
  repositories: Map<string, Record<string, unknown>>;
  publishTokens: Map<string, Record<string, unknown>>;
  adminUsers: Map<string, Record<string, unknown>>;
  adminRefreshSessions: Map<string, Record<string, unknown>>;
  repositoryPluginPolicies: Map<string, Record<string, unknown>>;
  runtimeSettings: Map<string, Record<string, unknown>>;
  backgroundJobs: Map<string, Record<string, unknown>>;
  repositoryArtifacts: Map<string, Record<string, unknown>>;
  stateKv: Map<string, string>;
}

function fakeD1Meta(changes = 0): D1Meta & Record<string, unknown> {
  return {
    served_by: "fake",
    duration: 0,
    changes,
    last_row_id: 0,
    changed_db: false,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
  };
}

class FakeD1PreparedStatement {
  private bindings: unknown[] = [];
  private changes = 0;

  constructor(private readonly query: string, private readonly tables: FakeD1Tables) {}

  bind(...values: unknown[]): this {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return (await this.all<T>()).results[0] ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.selectRows();
    return { results: rows as T[], success: true, meta: fakeD1Meta() };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    this.changes = 0;
    this.applyMutation();
    return { results: [], success: true, meta: fakeD1Meta(this.changes) };
  }

  raw<T = unknown>(): Promise<T[]> {
    throw new Error("Not implemented");
  }

  private selectRows(): Record<string, unknown>[] {
    if (this.query.includes("FROM axis_repositories")) {
      return selectRows(this.tables.repositories, this.query, this.bindings, {
        idColumn: "name",
        orderColumn: "name",
      });
    }
    if (this.query.includes("FROM axis_publish_tokens")) {
      return selectRows(this.tables.publishTokens, this.query, this.bindings, {
        idColumn: "id",
        nameColumn: "name",
        orderColumn: "name",
      });
    }
    if (this.query.includes("FROM axis_admin_users")) {
      return selectRows(this.tables.adminUsers, this.query, this.bindings, {
        idColumn: "id",
        nameColumn: "username",
        orderColumn: "username",
      });
    }
    if (this.query.includes("FROM axis_admin_refresh_sessions")) {
      return selectRows(this.tables.adminRefreshSessions, this.query, this.bindings, {
        idColumn: "id",
        orderColumn: "created_at",
        descending: true,
      });
    }
    if (this.query.includes("FROM axis_repository_plugin_policies")) {
      return selectRows(this.tables.repositoryPluginPolicies, this.query, this.bindings, {
        idColumn: "ecosystem",
        orderColumn: "ecosystem",
      });
    }
    if (this.query.includes("FROM axis_runtime_settings")) {
      return selectRows(this.tables.runtimeSettings, this.query, this.bindings, {
        idColumn: "id",
      });
    }
    if (this.query.includes("FROM axis_background_jobs")) {
      return selectBackgroundJobs(this.tables.backgroundJobs, this.query, this.bindings);
    }
    if (this.query.includes("FROM axis_repository_artifacts")) {
      return selectRepositoryArtifacts(this.tables.repositoryArtifacts, this.query, this.bindings);
    }
    if (this.query.includes("FROM axis_state_kv")) {
      return selectStateKv(this.tables.stateKv, this.query, this.bindings);
    }
    return [];
  }

  private applyMutation(): void {
    if (this.query.startsWith("CREATE TABLE") || this.query.startsWith("CREATE INDEX")) return;
    if (this.query.startsWith("INSERT INTO axis_repositories")) {
      const [name, id, ecosystem, kind, visibility, updatedAt, recordJson] = this.bindings;
      this.tables.repositories.set(String(name), {
        name,
        id,
        ecosystem,
        kind,
        visibility,
        updated_at: updatedAt,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_repositories")) {
      const [name] = this.bindings;
      this.changes = this.tables.repositories.delete(String(name)) ? 1 : 0;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_publish_tokens")) {
      const [id, name, createdAt, recordJson] = this.bindings;
      for (const [existingId, row] of [...this.tables.publishTokens.entries()]) {
        if (existingId !== id && row.name === name) this.tables.publishTokens.delete(existingId);
      }
      this.tables.publishTokens.set(String(id), {
        id,
        name,
        created_at: createdAt,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_publish_tokens")) {
      const [value, id] = this.bindings;
      for (const [existingId, row] of [...this.tables.publishTokens.entries()]) {
        if (this.query.includes("name = ? AND id <> ?")) {
          if (row.name === value && existingId !== id) this.tables.publishTokens.delete(existingId);
        } else if (row.name === value) {
          this.tables.publishTokens.delete(existingId);
        }
      }
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_admin_users")) {
      const [id, username, recordJson] = this.bindings;
      for (const [existingId, row] of [...this.tables.adminUsers.entries()]) {
        if (existingId !== id && row.username === username) this.tables.adminUsers.delete(existingId);
      }
      this.tables.adminUsers.set(String(id), {
        id,
        username,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_admin_users")) {
      const [username, id] = this.bindings;
      for (const [existingId, row] of [...this.tables.adminUsers.entries()]) {
        if (row.username === username && existingId !== id) this.tables.adminUsers.delete(existingId);
      }
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_admin_refresh_sessions")) {
      const [id, createdAt, recordJson] = this.bindings;
      this.tables.adminRefreshSessions.set(String(id), {
        id,
        created_at: createdAt,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_admin_refresh_sessions")) {
      const [id] = this.bindings;
      this.changes = this.tables.adminRefreshSessions.delete(String(id)) ? 1 : 0;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_repository_plugin_policies")) {
      const [ecosystem, recordJson] = this.bindings;
      this.tables.repositoryPluginPolicies.set(String(ecosystem), {
        ecosystem,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_runtime_settings")) {
      const [id, recordJson] = this.bindings;
      this.tables.runtimeSettings.set(String(id), {
        id,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_state_kv")) {
      const [key, valueJson] = this.bindings;
      this.tables.stateKv.set(String(key), String(valueJson));
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_state_kv")) {
      const [key] = this.bindings;
      this.tables.stateKv.delete(String(key));
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_background_jobs")) {
      const [id, type, status, subjectType, subjectId, subjectRepositoryName, repositoryName, priority, attempts, maxAttempts, requestedAt, scheduledAt, startedAt, finishedAt, lastHeartbeatAt, leaseId, leaseExpiresAt, progressJson, resultJson, failureJson, cancelRequestedAt, recordJson] = this.bindings;
      this.tables.backgroundJobs.set(String(id), {
        id,
        type,
        status,
        subject_type: subjectType,
        subject_id: subjectId,
        subject_repository_name: subjectRepositoryName,
        repository_name: repositoryName,
        priority,
        attempts,
        max_attempts: maxAttempts,
        requested_at: requestedAt,
        scheduled_at: scheduledAt,
        started_at: startedAt,
        finished_at: finishedAt,
        last_heartbeat_at: lastHeartbeatAt,
        lease_id: leaseId,
        lease_expires_at: leaseExpiresAt,
        progress_json: progressJson,
        result_json: resultJson,
        failure_json: failureJson,
        cancel_requested_at: cancelRequestedAt,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("UPDATE axis_background_jobs")) {
      if (this.query.includes("lease_id = ?")) {
        const [status, startedAt, lastHeartbeatAt, leaseId, leaseExpiresAt, recordJson, id, now] = this.bindings;
        const existing = this.tables.backgroundJobs.get(String(id));
        if (!existing) return;
        if (existing.status !== "pending" && !(existing.status === "running" && existing.lease_expires_at != null && String(existing.lease_expires_at) < String(now))) return;
        this.tables.backgroundJobs.set(String(id), {
          ...existing,
          status,
          started_at: startedAt,
          last_heartbeat_at: lastHeartbeatAt,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          record_json: recordJson,
        });
        this.changes = 1;
        return;
      }
      const [status, cancelRequestedAt, finishedAt, id] = this.bindings;
      const existing = this.tables.backgroundJobs.get(String(id));
      if (!existing) return;
      const record = JSON.parse(String(existing.record_json)) as Record<string, unknown>;
      const updated = { ...record, status, cancelRequestedAt, finishedAt };
      this.tables.backgroundJobs.set(String(id), {
        ...existing,
        status,
        cancel_requested_at: cancelRequestedAt,
        finished_at: finishedAt,
        record_json: JSON.stringify(updated),
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_background_jobs")) {
      const [value] = this.bindings;
      for (const [id, row] of [...this.tables.backgroundJobs.entries()]) {
        if (this.query.includes("repository_name = ?") && row.repository_name === value) this.tables.backgroundJobs.delete(id);
        if (this.query.includes("subject_type = ?") && row.subject_type === value && row.subject_id === this.bindings[1]) this.tables.backgroundJobs.delete(id);
      }
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("INSERT INTO axis_repository_artifacts")) {
      const [id, repositoryName, ecosystem, identity, family, familyKey, name, version, summary, primaryObjectKey, publishedAt, updatedAt, recordJson] = this.bindings;
      for (const [existingId, row] of [...this.tables.repositoryArtifacts.entries()]) {
        if (existingId !== id && row.repository_name === repositoryName && row.identity === identity) {
          this.tables.repositoryArtifacts.delete(existingId);
        }
      }
      this.tables.repositoryArtifacts.set(String(id), {
        id,
        repository_name: repositoryName,
        ecosystem,
        identity,
        family,
        family_key: familyKey,
        name,
        version,
        summary,
        primary_object_key: primaryObjectKey,
        published_at: publishedAt,
        updated_at: updatedAt,
        record_json: recordJson,
      });
      this.changes = 1;
      return;
    }
    if (this.query.startsWith("DELETE FROM axis_repository_artifacts")) {
      const [repositoryName] = this.bindings;
      for (const [id, row] of [...this.tables.repositoryArtifacts.entries()]) {
        if (row.repository_name === repositoryName) this.tables.repositoryArtifacts.delete(id);
      }
      this.changes = 1;
    }
  }
}

function selectBackgroundJobs(
  table: Map<string, Record<string, unknown>>,
  query: string,
  bindings: unknown[],
): Record<string, unknown>[] {
  if (query.includes("COUNT(*) AS total")) {
    return [{ total: selectBackgroundJobs(table, query.replace("SELECT COUNT(*) AS total", "SELECT record_json"), bindings).length }];
  }
  let rows = [...table.values()];
  let bindingIndex = 0;
  if (query.includes("id = ?")) rows = rows.filter((row) => row.id === bindings[bindingIndex++]);
  if (query.includes("repository_name = ?")) {
    const repositoryName = bindings[bindingIndex++];
    rows = rows.filter((row) => row.repository_name === repositoryName || row.subject_repository_name === repositoryName);
  }
  if (query.includes("status = ?")) rows = rows.filter((row) => row.status === bindings[bindingIndex++]);
  if (query.includes("type = ?")) rows = rows.filter((row) => row.type === bindings[bindingIndex++]);
  if (query.includes("status = 'pending'")) {
    const now = query.includes("lease_expires_at < ?") ? String(bindings[0]) : undefined;
    rows = rows.filter((row) =>
      row.status === "pending"
      || (now !== undefined && row.status === "running" && row.lease_expires_at != null && String(row.lease_expires_at) < now));
  }
  rows = rows.sort((left, right) => {
    if (query.includes("priority DESC")) {
      const priority = Number(right.priority) - Number(left.priority);
      if (priority !== 0) return priority;
      const scheduled = String(left.scheduled_at).localeCompare(String(right.scheduled_at));
      return scheduled === 0 ? String(left.id).localeCompare(String(right.id)) : scheduled;
    }
    const requested = String(right.requested_at).localeCompare(String(left.requested_at));
    return requested === 0 ? String(left.id).localeCompare(String(right.id)) : requested;
  });
  return applyLimitOffset(rows, query, bindings);
}

function selectRows(
  table: Map<string, Record<string, unknown>>,
  query: string,
  bindings: unknown[],
  options: {
    idColumn: string;
    nameColumn?: string;
    orderColumn?: string;
    descending?: boolean;
  },
): Record<string, unknown>[] {
  let rows = [...table.values()];
  if (query.includes(`${options.idColumn} = ?`)) {
    rows = rows.filter((row) => row[options.idColumn] === bindings[0]);
  } else if (options.nameColumn && query.includes(`${options.nameColumn} = ?`)) {
    rows = rows.filter((row) => row[options.nameColumn!] === bindings[0]);
  }
  if (options.orderColumn) {
    rows = rows.sort((left, right) => {
      const order = String(left[options.orderColumn!]).localeCompare(String(right[options.orderColumn!]));
      if (order !== 0) return options.descending ? -order : order;
      return String(left[options.idColumn]).localeCompare(String(right[options.idColumn]));
    });
  }
  return rows;
}

function selectRepositoryArtifacts(
  table: Map<string, Record<string, unknown>>,
  query: string,
  bindings: unknown[],
): Record<string, unknown>[] {
  if (query.includes("COUNT(*) AS total_artifacts")) {
    const rows = selectRepositoryArtifacts(
      table,
      "SELECT record_json FROM axis_repository_artifacts WHERE repository_name = ?",
      bindings,
    );
    return [{
      total_artifacts: rows.length,
      total_families: new Set(rows.map((row) => row.family_key)).size,
    }];
  }
  if (query.includes("COUNT(*) AS total")) {
    return [{ total: selectRepositoryArtifacts(table, query.replace("SELECT COUNT(*) AS total", "SELECT record_json"), bindings).length }];
  }
  let rows = [...table.values()];
  if (query.includes("repository_name = ?")) rows = rows.filter((row) => row.repository_name === bindings[0]);
  if (query.includes("family_key = ?")) rows = rows.filter((row) => row.family_key === bindings[1]);
  if (query.includes("WITH family_stats")) {
    const byFamily = new Map<unknown, Record<string, unknown>[]>();
    for (const row of rows) {
      byFamily.set(row.family_key, [...(byFamily.get(row.family_key) ?? []), row]);
    }
    const families = [...byFamily.entries()].map(([familyKey, members]) => {
      const ordered = [...members].sort((left, right) => {
        const leftUnversioned = left.version == null ? 1 : 0;
        const rightUnversioned = right.version == null ? 1 : 0;
        const versioned = leftUnversioned - rightUnversioned;
        if (versioned !== 0) return versioned;
        const updated = String(right.updated_at).localeCompare(String(left.updated_at));
        return updated === 0 ? String(left.id).localeCompare(String(right.id)) : updated;
      });
      const newestUpdatedAt = [...members].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0]!.updated_at;
      return {
        ...ordered[0]!,
        artifact_count: members.length,
        version_count: new Set(members.flatMap((member) => member.version == null ? [] : [member.version])).size,
        family_updated_at: newestUpdatedAt,
        family_key: familyKey,
      };
    }).sort((left, right) => {
      const updated = String(right.family_updated_at).localeCompare(String(left.family_updated_at));
      return updated === 0 ? String(left.family_key).localeCompare(String(right.family_key)) : updated;
    });
    return applyLimitOffset(families, query, bindings);
  }
  rows = rows.sort((left, right) => {
    const updated = String(right.updated_at).localeCompare(String(left.updated_at));
    return updated === 0 ? String(left.id).localeCompare(String(right.id)) : updated;
  });
  return applyLimitOffset(rows, query, bindings);
}

function applyLimitOffset(rows: Record<string, unknown>[], query: string, bindings: unknown[]): Record<string, unknown>[] {
  if (!query.includes("LIMIT ?")) return rows;
  const hasOffset = query.includes("OFFSET ?");
  const limit = Number(bindings.at(hasOffset ? -2 : -1));
  const offset = hasOffset ? Number(bindings.at(-1)) : 0;
  return rows.slice(offset, offset + limit);
}

function selectStateKv(
  table: Map<string, string>,
  query: string,
  bindings: unknown[],
): Record<string, unknown>[] {
  let rows = [...table.entries()].map(([key, valueJson]) => ({ key, value_json: valueJson }));
  if (query.includes("key = ?")) {
    rows = rows.filter((row) => row.key === bindings[0]);
  }
  if (query.includes("key LIKE ?")) {
    const prefix = String(bindings[0]).replace(/%$/, "").replaceAll("\\%", "%").replaceAll("\\_", "_").replaceAll("\\\\", "\\");
    rows = rows.filter((row) => row.key.startsWith(prefix));
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

describeStateStoreContract("D1 shared index stores", async () => {
  const database = new FakeD1Database();
  await database.exec(D1_SHARED_INDEX_SCHEMA);
  return createD1StateStore(database as unknown as D1Database) as StateStore;
});

describe("D1 repository artifact store", () => {
  it("chunks artifact batch upserts to keep single D1 calls bounded", async () => {
    const database = new FakeD1Database();
    const state = createD1StateStore(database as unknown as D1Database);
    const records = Array.from({ length: 205 }, (_, index) => ({
      id: `artifact_${index}`,
      repositoryName: "python-proxy",
      ecosystem: "pypi",
      identity: `pypi:demo:${index}`,
      name: "demo",
      version: String(index),
      summary: `demo ${index}`,
      objectKeys: [`https://files.example/demo-${index}.tar.gz`],
      metadata: {},
      publishedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }));

    await state.repositoryArtifacts.upsertMany(records);

    expect(database.batchSizes).toEqual([100, 100, 5]);
    await expect(state.repositoryArtifacts.listByRepository("python-proxy")).resolves.toHaveLength(205);
  });
});

describe("D1 control-plane stores", () => {
  it("stores control-plane records in typed D1 tables instead of the generic state kv", async () => {
    const database = new FakeD1Database();
    const state = createD1StateStore(database as unknown as D1Database);

    await state.repositories.save({
      id: "repo_1",
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      visibility: "public",
      config: {},
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    await state.adminUsers.save({
      id: "admin_user_1",
      username: "admin",
      displayName: "admin",
      passwordHash: "pbkdf2-sha256$hash",
      role: "owner",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    await state.adminRefreshSessions.save({
      id: "admin_session_1",
      subject: "admin_user_1",
      username: "admin",
      role: "owner",
      tokenHash: "sha256:hash",
      scopes: ["admin:*"],
      createdAt: "2026-08-05T00:00:00.000Z",
      expiresAt: "2026-09-05T00:00:00.000Z",
    });
    await state.publishTokens.save({
      id: "ptok_1",
      name: "ci",
      tokenHash: "sha256:hash",
      permissions: ["publish"],
      repositories: ["python-proxy"],
      ecosystemScopes: {},
      signingKeyIds: [],
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    await state.repositoryPluginPolicies.save({ ecosystem: "pypi", enabledOverride: true });
    await state.runtimeSettings.save({
      operationalPolicy: { proxy: { upstreamFetchTimeoutMs: 1000 } },
    });

    expect(database.stateKvSize()).toBe(0);
    expect(database.preparedQueries).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO axis_repositories"),
      expect.stringContaining("INSERT INTO axis_admin_users"),
      expect.stringContaining("INSERT INTO axis_admin_refresh_sessions"),
      expect.stringContaining("INSERT INTO axis_publish_tokens"),
      expect.stringContaining("INSERT INTO axis_repository_plugin_policies"),
      expect.stringContaining("INSERT INTO axis_runtime_settings"),
    ]));
  });
});

describe("D1 shared state schema bootstrap", () => {
  it("initializes the schema with complete prepared statements and reuses it for the store instance", async () => {
    const database = new FakeD1Database();
    const state = createD1StateStore(database as unknown as D1Database);

    await state.repositories.save({
      id: "repo_1",
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      visibility: "public",
      config: {},
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    await state.backgroundJobs.save({
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      attempts: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
    });

    expect(database.execCount).toBe(0);
    expect(database.preparedQueries).toContain("CREATE TABLE IF NOT EXISTS axis_state_kv (\n  key TEXT PRIMARY KEY,\n  value_json TEXT NOT NULL\n)");
    expect(database.preparedQueries.filter((query) => query.startsWith("CREATE TABLE") || query.startsWith("CREATE INDEX")))
      .toHaveLength(23);
  });
});
