import { describe, expect, it } from "vitest";
import { RepositoryWriteLock } from "./repository-write-lock";

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
