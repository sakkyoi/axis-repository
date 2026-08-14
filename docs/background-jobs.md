# Queue-based background jobs

This document describes the current background job architecture for Axis
Repository. Long-running work runs outside admin request lifetimes while job
status, retries, and cancellation remain visible through the admin UI.

## Problem

Earlier runtime versions ran background work from the `AxisAdminDO` alarm. That
kept the implementation simple, but it meant admin API requests and background
job execution shared the same Durable Object execution queue. Any job slice that
fetched upstream data, rewrote repository metadata, swept storage, or wrote many
artifact records could make unrelated admin APIs wait.

Small slices reduce the duration of each pause, but they do not remove the
coupling. A production-ready design should treat the admin Durable Object as a
coordination and API surface, not as the worker that performs heavy background
execution.

The current Cloudflare runtime no longer routes admin traffic through
`AxisAdminDO`; production control-plane state is stored in D1 and background
execution is driven by Cloudflare Queues plus a Cron scheduler.

## Architecture

Cloudflare Queues are the default background execution mechanism.

The admin API creates or updates a durable job record, then enqueues a small
wake-up message. Queue consumers load runnable jobs from shared D1 state,
execute one bounded chunk of work, write progress back to job state, and enqueue
the next wake-up when work remains.

The admin API path must not drain jobs, run repository maintenance, finalize
publishes, or rebuild indexes inline. It should only validate the request,
record state, enqueue work, and return.

```text
Admin API
  -> create/update BackgroundJobRecord
  -> enqueue BackgroundJobMessage
  -> return 202

Queue consumer
  -> load next runnable job from D1
  -> acquire job lease
  -> run one chunk
  -> save progress/result
  -> enqueue wake-up when more runnable work remains
  -> release/expire lease
```

## Job Record

`BackgroundJobRecord` remains the durable source of truth for the admin UI and
API. Queue execution uses explicit lease and continuation semantics.

Fields:

```ts
interface BackgroundJobRecord {
  id: string;
  type: BackgroundJobType;
  status: "pending" | "running" | "succeeded" | "failed" | "canceling" | "canceled";
  subject: BackgroundJobSubject;
  repositoryName?: string;
  priority: number;
  requestedAt: string;
  scheduledAt: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  finishedAt?: string;
  attempts: number;
  progress?: BackgroundJobProgress;
  failure?: BackgroundJobFailure;
  result?: Record<string, unknown>;

  leaseId?: string;
  leaseExpiresAt?: string;
  continuation?: Record<string, unknown>;
}
```

Notes:

- `attempts` counts full job attempts, not continuation chunks.
- `continuation` is the next chunk cursor. It should not be hidden inside
  `result`.
- `leaseId` and `leaseExpiresAt` protect against duplicate Queue deliveries and
  overlapping consumers.
- A consumer may resume a job whose lease has expired.
- Cancellation is cooperative: canceling jobs are observed between chunks.

## Queue Message

Queue messages are small and idempotent wake-ups. They do not carry job
payloads, catalogs, artifact lists, upload contents, or parsed metadata.

```ts
interface BackgroundJobMessage {
  enqueuedAt: string;
}
```

The consumer loads runnable jobs from the shared job store. This avoids stale
continuation data when messages are retried or delivered out of order, and makes
duplicate Queue messages harmless.

## Shared State

Queue consumers must not call back into `AxisAdminDO` to read or write job
state. That would move the trigger to Queues but leave execution serialized
behind admin API requests.

Production deployments use `AXIS_SHARED_STATE`, a D1 database, as the shared
`StateStore` backing:

- `axis_state_kv` stores the existing low-volume state records used by
  repositories, sessions, tokens, users, secrets, plugin policies, and activity.
- `axis_background_jobs` stores jobs with indexed status, repository, type, and
  runnable ordering columns.
- `axis_repository_artifacts` stores artifact records with indexed repository,
  identity, listing, and family columns.

The indexed job and artifact tables are the hot path. They are not stored only
as KV JSON records because Admin UI polling and artifact browsing must avoid
full state scans.

The D1 schema is shipped both as a Wrangler migration and as runtime
bootstrap. The migration is the preferred path for controlled deploys; runtime
bootstrap uses idempotent `CREATE TABLE IF NOT EXISTS` statements so automatic
provisioning and GitHub/Dashboard deploys do not start with a missing schema.

## Executor Contract

The execution contract is shared by Queue consumers and local tests.

```ts
interface BackgroundJobExecutor {
  run(input: {
    jobId: string;
    leaseId: string;
    now: Date;
  }): Promise<BackgroundJobExecutionResult>;
}

interface BackgroundJobExecutionResult {
  status: "succeeded" | "pending" | "failed" | "canceled";
  continuation?: Record<string, unknown>;
  progress?: BackgroundJobProgress;
  result?: Record<string, unknown>;
  failure?: BackgroundJobFailure;
}
```

Each executor run must be bounded. It processes one chunk, then returns. If
more work remains, it returns `pending` with a continuation and the queue adapter
enqueues another message.

## Lease Contract

Before running, the consumer must atomically acquire a lease:

```text
acquire(jobId, leaseId, ttl)
  allowed when:
    status is pending
    or status is running and leaseExpiresAt < now
  writes:
    status = running
    leaseId = leaseId
    leaseExpiresAt = now + ttl
    startedAt if absent
    lastHeartbeatAt = now
```

After running:

- `succeeded`: clear lease, set `finishedAt`, record result.
- `pending`: clear lease, set `scheduledAt`, persist continuation and progress.
- `failed`: clear lease, set `finishedAt`, record retryable failure.
- `canceled`: clear lease, set `finishedAt`.

Long chunks should either be avoided or heartbeat by renewing the lease. The
preferred design is small chunks that do not need heartbeat renewal.

## Idempotency

Queue delivery is at least once. Every runner must be safe to execute more than
once.

Repository index jobs:

- Artifact marker upserts are idempotent by identity.
- Catalog rebuild cache is keyed by repository and current job.
- Continuation chunks should be based on persisted state, not message payload.

Publish finalize jobs:

- Finalizing an already finalized session succeeds.
- Object writes must use deterministic keys.
- Activity records should be deduped by job/session identifier or be written
  only after the final state transition succeeds.

Storage cleanup jobs:

- Deleting a missing staging object is success.
- The job result records counts, not a requirement that every object existed.

Repository maintenance jobs:

- Refreshing metadata is idempotent for the same repository state.
- Failures are per repository and should not fail unrelated repositories.

## Job Types

### `repository.index.*`

Runs repository artifact indexing and proxy refresh work in chunks. For PyPI
proxy repositories, the root catalog fetch should write a rebuild cache, and
subsequent chunks should materialize bounded project marker batches from that
cache.

Future improvement: artifact families should be materialized so list APIs do not
scan all artifacts on each request.

### `publish.finalize`

Finalization can parse artifacts, write objects, rebuild metadata, and update
activity. It should run as a Queue job after upload verification. The API should
return once the finalize job is accepted, not after finalization completes.

### `storage.staging-upload-gc`

This job sweeps expired staging uploads. It can run periodically through a Queue
message emitted by Cron. It does not run in the admin API request path.

### `repository.maintenance`

Maintenance runs as explicit jobs, one per repository where possible, rather
than one scheduler pass that performs repository work inline.

## Scheduling

Queue scheduling rules:

- Creating a pending job enqueues one message immediately.
- A pending continuation enqueues the next message after the current chunk
  commits.
- Retry creates a fresh message for the same job id.
- Cancel does not remove in-flight Queue messages; it updates job status. The
  consumer observes cancellation after acquiring the lease and exits.

Periodic work:

- Cron enqueues maintenance and cleanup jobs.
- The scheduler must not execute the jobs itself.

## Local Development

Local development should keep the same job contract with a pluggable queue
adapter.

```ts
interface BackgroundJobQueue {
  enqueue(message: BackgroundJobMessage): Promise<void>;
}
```

Adapters:

- Production: Cloudflare Queue binding.
- Tests: in-memory queue with explicit `drain()`.
- Local dev: in-memory queue or a polling helper that calls the same executor.

The local adapter may run in process, but it should still use the same executor
and lease code so behavior matches production.

## Implemented Scope

- Production state is backed by shared D1 when `AXIS_SHARED_STATE` is bound,
  with indexed job and artifact tables.
- Wrangler declares D1, Queue, and Cron bindings. The D1 schema is available as
  a migration and through runtime bootstrap.
- Admin request paths enqueue background work instead of draining it inline.
- Queue consumers drain one runnable job slice and re-enqueue when runnable work
  remains.
- Lease-aware execution prevents duplicate Queue deliveries from overlapping the
  same job.
- Publish finalization, repository indexing, repository deletion, artifact
  deletion, proxy cache purge, staging upload cleanup, and repository
  maintenance use the shared background job contract.
- The production Worker entrypoint no longer depends on `AxisAdminDO` for admin
  API routing or heavy background execution.

## Open Design Decisions

- How to dedupe activity records across retried Queue messages.
- Whether to materialize artifact family summaries as their own table after the
  current indexed artifact table is in production.

The chosen architecture is shared D1 state plus Queue consumers. Queue execution
removes API blocking only when consumers use shared storage services directly;
calling back into a Durable Object for heavy work is not an accepted production
path.
