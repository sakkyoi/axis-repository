/**
 * Runs work touching one repository's published state one job at a time.
 *
 * Publishing, reconciling and renewing all read the current indexes, fold
 * their change into them and write the result back. Two of those overlapping
 * on the same repository both read the same starting point, so whichever
 * writes second erases what the first added: the `.deb` files survive in the
 * pool while disappearing from `Packages`, and both callers report success.
 *
 * The in-memory implementation below only orders work inside one JavaScript
 * isolate. Production Cloudflare runtime uses the D1-backed implementation so
 * separate Worker isolates and Queue consumers share the same repository
 * lease.
 *
 * Work on different repositories still runs concurrently.
 */
export interface RepositoryWriteLocker {
  run<T>(repositoryName: string, work: () => Promise<T>): Promise<T>;
}

export class RepositoryWriteLock implements RepositoryWriteLocker {
  private readonly chains = new Map<string, Promise<unknown>>();

  async run<T>(repositoryName: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(repositoryName);
    // Chain off the previous job's settlement, not its result: one job failing
    // must not cancel the queue behind it.
    const started = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(work);
    this.chains.set(repositoryName, started);

    try {
      return await started;
    } finally {
      // Only the last job in the queue clears the entry, or a job that arrived
      // while this one ran would lose its place.
      if (this.chains.get(repositoryName) === started) {
        this.chains.delete(repositoryName);
      }
    }
  }
}

export const D1_REPOSITORY_WRITE_LOCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS axis_repository_write_locks (
  repository_name TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`;

export class D1RepositoryWriteLock implements RepositoryWriteLocker {
  private initialized?: Promise<void>;

  constructor(
    private readonly database: D1Database,
    private readonly options: {
      leaseTtlMs?: number;
      retryDelayMs?: number;
      renewIntervalMs?: number;
      now?: () => Date;
      createLeaseId?: () => string;
    } = {},
  ) {}

  async run<T>(repositoryName: string, work: () => Promise<T>): Promise<T> {
    const leaseId = this.createLeaseId();
    await this.acquire(repositoryName, leaseId);
    let stopped = false;
    let stopRenew!: () => void;
    const stopSignal = new Promise<void>((resolve) => {
      stopRenew = resolve;
    });
    const renew = this.renewUntilStopped(repositoryName, leaseId, () => stopped, stopSignal);
    try {
      return await Promise.race([
        work(),
        renew.then(() => new Promise<never>(() => undefined)),
      ]);
    } finally {
      stopped = true;
      stopRenew();
      await renew;
      await this.release(repositoryName, leaseId);
    }
  }

  private async acquire(repositoryName: string, leaseId: string): Promise<void> {
    await this.ensure();
    for (;;) {
      const now = this.now();
      const leaseExpiresAt = new Date(now.getTime() + this.leaseTtlMs()).toISOString();
      const result = await this.database
        .prepare(
          "INSERT INTO axis_repository_write_locks (repository_name, lease_id, lease_expires_at, acquired_at)"
          + " VALUES (?, ?, ?, ?)"
          + " ON CONFLICT(repository_name) DO UPDATE SET"
          + " lease_id = ?, lease_expires_at = ?, acquired_at = ?"
          + " WHERE axis_repository_write_locks.lease_expires_at <= ?",
        )
        .bind(
          repositoryName,
          leaseId,
          leaseExpiresAt,
          now.toISOString(),
          leaseId,
          leaseExpiresAt,
          now.toISOString(),
          now.toISOString(),
        )
        .run();
      if (changedRows(result) > 0) {
        return;
      }
      await sleep(this.retryDelayMs());
    }
  }

  private async release(repositoryName: string, leaseId: string): Promise<void> {
    await this.ensure();
    await this.database
      .prepare("DELETE FROM axis_repository_write_locks WHERE repository_name = ? AND lease_id = ?")
      .bind(repositoryName, leaseId)
      .run();
  }

  private async renewUntilStopped(
    repositoryName: string,
    leaseId: string,
    stopped: () => boolean,
    stopSignal: Promise<void>,
  ): Promise<void> {
    while (!stopped()) {
      await Promise.race([sleep(this.renewIntervalMs()), stopSignal]);
      if (stopped()) {
        return;
      }
      const now = this.now();
      const leaseExpiresAt = new Date(now.getTime() + this.leaseTtlMs()).toISOString();
      const result = await this.database
        .prepare(
          "UPDATE axis_repository_write_locks SET lease_expires_at = ?"
          + " WHERE repository_name = ? AND lease_id = ?",
        )
        .bind(leaseExpiresAt, repositoryName, leaseId)
        .run();
      if (changedRows(result) === 0) {
        throw new Error(`Repository write lock was lost for ${repositoryName}`);
      }
    }
  }

  private ensure(): Promise<void> {
    this.initialized ??= this.database.prepare(D1_REPOSITORY_WRITE_LOCK_SCHEMA.trim()).run().then(() => undefined);
    return this.initialized;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private leaseTtlMs(): number {
    return this.options.leaseTtlMs ?? 10 * 60 * 1000;
  }

  private retryDelayMs(): number {
    return this.options.retryDelayMs ?? 100;
  }

  private renewIntervalMs(): number {
    return this.options.renewIntervalMs ?? Math.max(1000, Math.floor(this.leaseTtlMs() / 3));
  }

  private createLeaseId(): string {
    return this.options.createLeaseId?.() ?? crypto.randomUUID();
  }
}

function changedRows(result: D1Result): number {
  const changes = result.meta.changes;
  return typeof changes === "number" ? changes : 0;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));
}
