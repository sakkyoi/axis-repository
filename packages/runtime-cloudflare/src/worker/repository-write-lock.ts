/**
 * Runs work touching one repository's published state one job at a time.
 *
 * Publishing, reconciling and renewing all read the current indexes, fold
 * their change into them and write the result back. Two of those overlapping
 * on the same repository both read the same starting point, so whichever
 * writes second erases what the first added: the `.deb` files survive in the
 * pool while disappearing from `Packages`, and both callers report success.
 *
 * The Durable Object is a singleton, so a promise chain held here is enough to
 * order them. It does not survive the object being evicted mid-job, which is
 * why reconciling against the pool stays the repair path rather than this
 * being the only thing standing between the repository and a corrupt index.
 *
 * Work on different repositories still runs concurrently.
 */
export class RepositoryWriteLock {
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
