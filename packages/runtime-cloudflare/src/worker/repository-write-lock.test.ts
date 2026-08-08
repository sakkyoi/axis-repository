import { describe, expect, it } from "vitest";
import { D1RepositoryWriteLock, RepositoryWriteLock } from "./repository-write-lock";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("RepositoryWriteLock", () => {
  it("does not start a job while another is running on the same repository", async () => {
    const lock = new RepositoryWriteLock();
    const first = deferred();
    const order: string[] = [];

    const one = lock.run("debian", async () => { order.push("one:start"); await first.promise; order.push("one:end"); });
    const two = lock.run("debian", async () => { order.push("two:start"); });

    // Give the second job every chance to run early if it were going to.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["one:start"]);

    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(["one:start", "one:end", "two:start"]);
  });

  it("lets different repositories run at the same time", async () => {
    const lock = new RepositoryWriteLock();
    const blocked = deferred();
    const order: string[] = [];

    const slow = lock.run("debian", async () => { await blocked.promise; order.push("debian"); });
    await lock.run("ubuntu", async () => { order.push("ubuntu"); });

    // ubuntu finished while debian was still waiting.
    expect(order).toEqual(["ubuntu"]);
    blocked.resolve();
    await slow;
    expect(order).toEqual(["ubuntu", "debian"]);
  });

  it("keeps the queue moving after a job throws", async () => {
    // One failed publish must not wedge every later one behind it.
    const lock = new RepositoryWriteLock();

    await expect(lock.run("debian", () => Promise.reject(new Error("publish failed"))))
      .rejects.toThrow("publish failed");
    await expect(lock.run("debian", async () => "ok")).resolves.toBe("ok");
  });

  it("reports each job's own result and failure", async () => {
    const lock = new RepositoryWriteLock();

    const [first, second] = await Promise.allSettled([
      lock.run("debian", async () => "first"),
      lock.run("debian", () => Promise.reject(new Error("second failed"))),
    ]);

    expect(first).toMatchObject({ status: "fulfilled", value: "first" });
    expect(second).toMatchObject({ status: "rejected" });
    await expect(lock.run("debian", async () => "third")).resolves.toBe("third");
  });

  it("forgets a repository once its queue drains", async () => {
    const lock = new RepositoryWriteLock();

    await lock.run("debian", async () => undefined);

    expect((lock as unknown as { chains: Map<string, unknown> }).chains.size).toBe(0);
  });
});

class FakeLockD1Database {
  readonly locks = new Map<string, { leaseId: string; leaseExpiresAt: string; acquiredAt: string }>();

  prepare(query: string): D1PreparedStatement {
    return new FakeLockD1PreparedStatement(query, this.locks) as unknown as D1PreparedStatement;
  }

  batch(): Promise<D1Result[]> {
    throw new Error("Not implemented");
  }

  exec(): Promise<D1ExecResult> {
    throw new Error("Not implemented");
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error("Not implemented");
  }
}

class FakeLockD1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly locks: Map<string, { leaseId: string; leaseExpiresAt: string; acquiredAt: string }>,
  ) {}

  bind(...values: unknown[]): this {
    this.bindings = values;
    return this;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.startsWith("CREATE TABLE")) {
      return d1Result(0);
    }
    if (this.query.startsWith("INSERT INTO axis_repository_write_locks")) {
      const [repositoryName, leaseId, leaseExpiresAt, acquiredAt, replaceLeaseId, replaceExpiresAt, replaceAcquiredAt, now] = this.bindings;
      const key = String(repositoryName);
      const existing = this.locks.get(key);
      if (!existing) {
        this.locks.set(key, {
          leaseId: String(leaseId),
          leaseExpiresAt: String(leaseExpiresAt),
          acquiredAt: String(acquiredAt),
        });
        return d1Result(1);
      }
      if (existing.leaseExpiresAt > String(now)) {
        return d1Result(0);
      }
      this.locks.set(key, {
        leaseId: String(replaceLeaseId),
        leaseExpiresAt: String(replaceExpiresAt),
        acquiredAt: String(replaceAcquiredAt),
      });
      return d1Result(1);
    }
    if (this.query.startsWith("DELETE FROM axis_repository_write_locks")) {
      const [repositoryName, leaseId] = this.bindings;
      const existing = this.locks.get(String(repositoryName));
      if (existing?.leaseId !== leaseId) {
        return d1Result(0);
      }
      this.locks.delete(String(repositoryName));
      return d1Result(1);
    }
    if (this.query.startsWith("UPDATE axis_repository_write_locks")) {
      const [leaseExpiresAt, repositoryName, leaseId] = this.bindings;
      const existing = this.locks.get(String(repositoryName));
      if (!existing || existing.leaseId !== leaseId) {
        return d1Result(0);
      }
      this.locks.set(String(repositoryName), {
        leaseId: existing.leaseId,
        leaseExpiresAt: String(leaseExpiresAt),
        acquiredAt: existing.acquiredAt,
      });
      return d1Result(1);
    }
    return d1Result(0);
  }

  first<T = unknown>(): Promise<T | null> {
    throw new Error("Not implemented");
  }

  all<T = unknown>(): Promise<D1Result<T>> {
    throw new Error("Not implemented");
  }

  raw<T = unknown>(): Promise<T[]> {
    throw new Error("Not implemented");
  }
}

function d1Result<T = unknown>(changes: number): D1Result<T> {
  return {
    results: [],
    success: true,
    meta: {
      served_by: "fake",
      duration: 0,
      changes,
      last_row_id: 0,
      changed_db: changes > 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
    },
  };
}

describe("D1RepositoryWriteLock", () => {
  it("serializes writes across lock instances sharing the same D1 database", async () => {
    const database = new FakeLockD1Database();
    const firstLock = new D1RepositoryWriteLock(database as unknown as D1Database, {
      retryDelayMs: 1,
      leaseTtlMs: 60_000,
    });
    const secondLock = new D1RepositoryWriteLock(database as unknown as D1Database, {
      retryDelayMs: 1,
      leaseTtlMs: 60_000,
    });
    const first = deferred();
    const order: string[] = [];

    const one = firstLock.run("debian", async () => {
      order.push("one:start");
      await first.promise;
      order.push("one:end");
    });
    const two = secondLock.run("debian", async () => {
      order.push("two:start");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["one:start"]);

    first.resolve();
    await Promise.all([one, two]);

    expect(order).toEqual(["one:start", "one:end", "two:start"]);
  });

  it("renews the D1 lease while work is still running", async () => {
    const database = new FakeLockD1Database();
    let current = new Date("2026-08-09T00:00:00.000Z");
    const lock = new D1RepositoryWriteLock(database as unknown as D1Database, {
      leaseTtlMs: 1000,
      renewIntervalMs: 1,
      retryDelayMs: 1,
      now: () => current,
      createLeaseId: () => "lease-1",
    });
    const releaseWork = deferred();

    const work = lock.run("debian", async () => {
      current = new Date("2026-08-09T00:00:00.500Z");
      await releaseWork.promise;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(database.locks.get("debian")?.leaseExpiresAt).toBe("2026-08-09T00:00:01.500Z");
    releaseWork.resolve();
    await work;
    expect(database.locks.has("debian")).toBe(false);
  });
});
