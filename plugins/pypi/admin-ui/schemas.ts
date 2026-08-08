import { z } from "zod";

export const pypiClientInfoSchema = z.object({
  repository: z.string(),
  ecosystem: z.literal("pypi"),
  simpleUrl: z.string(),
  pipIndexUrl: z.string(),
});

export type PypiClientInfo = z.infer<typeof pypiClientInfoSchema>;

export const pypiProjectFileSchema = z.object({
  filename: z.string(),
  sha256: z.string(),
  requiresPython: z.string().optional(),
  coreMetadataSha256: z.string().optional(),
  /** Present when yanked; the empty string is a yank with no stated reason. */
  yanked: z.string().optional(),
});

export const pypiProjectsSchema = z.object({
  projects: z.array(z.object({
    name: z.string(),
    fileCount: z.number().optional(),
  })),
  cursor: z.string().optional(),
  truncated: z.boolean(),
});

export const pypiProjectSchema = z.object({
  project: z.object({
    name: z.string(),
    files: z.array(pypiProjectFileSchema),
  }),
});

export const pypiProxyCacheStatsSchema = z.object({
  fileCount: z.number(),
  byteCount: z.number(),
});

export const pypiProxyCacheSchema = z.object({
  cache: pypiProxyCacheStatsSchema,
});

export const backgroundJobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "canceling", "canceled"]),
  subject: z.object({
    type: z.enum(["repository", "publish-session", "upload", "artifact", "system"]),
    id: z.string(),
    repositoryName: z.string().optional(),
  }),
  repositoryName: z.string().optional(),
  priority: z.number(),
  attempts: z.number(),
  maxAttempts: z.number().optional(),
  requestedAt: z.string(),
  scheduledAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  progress: z.object({
    current: z.number().optional(),
    total: z.number().optional(),
    message: z.string().optional(),
  }).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  failure: z.object({
    message: z.string(),
    failedAt: z.string(),
    retryable: z.boolean(),
  }).optional(),
});

export const pypiProxyCachePurgeSchema = z.object({
  job: backgroundJobSchema,
});

export type PypiProjectFile = z.infer<typeof pypiProjectFileSchema>;
export type PypiProjects = z.infer<typeof pypiProjectsSchema>;
export type PypiProject = z.infer<typeof pypiProjectSchema>["project"];
export type PypiProxyCacheStats = z.infer<typeof pypiProxyCacheStatsSchema>;
export type PypiProxyCachePurge = z.infer<typeof pypiProxyCachePurgeSchema>;
