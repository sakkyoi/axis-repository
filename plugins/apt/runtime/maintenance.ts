import type { Repository, RepositoryObjectStore } from "@axis-repository/core";
import { objectBytes, type RepositorySigningKeyCapability } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import {
  distsPrefix,
  readAptSuiteStates,
  writeAptRepositoryIndexes,
  type AptReleaseSigner,
  type AptSuiteState,
} from "./index-store";
import { buildAptIndexMetadata, parseAptRepositoryConfig } from "./metadata";
import { resolveAptRepositoryConfig } from "./packages";

/**
 * Re-signs `Release` before its `Valid-Until` runs out.
 *
 * That field is what stops an attacker holding a client on a package set whose
 * vulnerabilities are already fixed, but it only helps if something keeps it
 * moving: apt refuses a repository whose `Release` has expired outright, so a
 * suite nobody publishes to would take itself offline.
 *
 * Renewal regenerates the indexes from what is already published and signs a
 * `Release` carrying the current time. The index bytes come out identical, so
 * their `by-hash` entries do not churn and no client re-downloads anything —
 * only `Release`, `InRelease` and `Release.gpg` change.
 */
export async function renewAptReleaseSignatures(input: {
  repository: Repository;
  objectStore: RepositoryObjectStore;
  signingKeys: RepositorySigningKeyCapability;
  signer: AptReleaseSigner;
  now: Date;
}): Promise<{ refreshed: string[]; nextDueAt?: Date }> {
  const parsedConfig = parseAptRepositoryConfig(input.repository);
  if (parsedConfig.validityDays === undefined) {
    // Nothing expires, so nothing has to be renewed.
    return { refreshed: [] };
  }

  const suiteNames = parsedConfig.suites ?? [parsedConfig.codename];
  const published = await readAptSuiteStates({
    objectStore: input.objectStore,
    repositoryName: input.repository.name,
    suites: suiteNames,
  });
  const config = resolveAptRepositoryConfig({
    config: parsedConfig,
    existing: [...published.values()].map((state) => state.packages),
  });
  // Renewing at the halfway point leaves a second full window to try again if
  // one renewal fails, rather than discovering the problem once clients break.
  const renewalIntervalMs = (parsedConfig.validityDays * 24 * 60 * 60 * 1000) / 2;

  const refreshed: string[] = [];
  const dueTimes: number[] = [];

  for (const suite of suiteNames) {
    const state = published.get(suite);
    if (!state || state.packages.size === 0) {
      // Nothing published to this suite yet, so there is no Release to renew.
      continue;
    }

    const validUntil = await readValidUntil({
      objectStore: input.objectStore,
      repositoryName: input.repository.name,
      suite,
    });
    const dueAt = validUntil === undefined ? input.now.getTime() : validUntil - renewalIntervalMs;
    if (dueAt > input.now.getTime()) {
      dueTimes.push(dueAt);
      continue;
    }

    await writeAptRepositoryIndexes({
      objectStore: input.objectStore,
      repositoryName: input.repository.name,
      suites: [await buildAptIndexMetadata({
        repositoryName: input.repository.name,
        config,
        suite,
        stanzasByIndex: state.packages,
        existingContents: state.contents,
        existingSources: state.sources,
        publishDate: input.now.toISOString(),
      })],
      signer: input.signer,
      signingKey: await input.signingKeys.getActivePrivateKey(config.signingKeyId, input.repository.name),
      publishedAt: input.now.toISOString(),
    });
    refreshed.push(suite);
    dueTimes.push(input.now.getTime() + renewalIntervalMs);
  }

  const nextDueAt = dueTimes.length > 0 ? new Date(Math.min(...dueTimes)) : undefined;
  return { refreshed, ...(nextDueAt ? { nextDueAt } : {}) };
}

/**
 * Reads the expiry out of the `Release` currently published for a suite.
 *
 * Returns undefined when there is no `Release`, or when it carries no
 * `Valid-Until` — a repository that had none and has since been configured to
 * expire needs one written, so both cases fall through to renewing.
 */
async function readValidUntil(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  suite: string;
}): Promise<number | undefined> {
  const stored = await input.objectStore.getObject(
    `${distsPrefix(input.repositoryName, input.suite)}Release`,
  );
  if (!stored) {
    return undefined;
  }

  const found = /^Valid-Until: (.+)$/m.exec(new TextDecoder().decode(await objectBytes(stored)));
  const parsed = found?.[1] ? Date.parse(found[1]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type { AptSuiteState };
