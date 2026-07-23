import { z } from "zod";

export const repositoryVisibilitySchema = z.enum(["private", "public"]);

export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  ecosystem: z.string(),
  visibility: repositoryVisibilitySchema,
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const repositoriesResponseSchema = z.object({
  repositories: z.array(repositorySchema),
});

export const repositoryPluginSchema = z.object({
  ecosystem: z.string(),
  name: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  clientHelpers: z.object({
    namespace: z.string(),
    actions: z.array(z.string()),
  }).optional(),
});

export const repositoryPluginsResponseSchema = z.object({
  plugins: z.array(repositoryPluginSchema),
});

export const publishTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  repositories: z.array(z.string()),
  ecosystemScopes: z.record(z.string(), z.unknown()),
  signingKeyIds: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  revokedAt: z.string().optional(),
});

export const publishTokensResponseSchema = z.object({
  publishTokens: z.array(publishTokenSchema),
});

export const publishTokenCreateResponseSchema = z.object({
  token: publishTokenSchema,
  secret: z.string(),
});

export const signingKeySchema = z.object({
  id: z.string(),
  repositoryName: z.string(),
  name: z.string(),
  publicKeyArmored: z.string(),
  fingerprint: z.string(),
  keyId: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

export const signingKeysResponseSchema = z.object({
  signingKeys: z.array(signingKeySchema),
});

export const aptSourceInfoSchema = z.object({
  repository: z.string(),
  ecosystem: z.literal("apt"),
  baseUrl: z.string(),
  codename: z.string(),
  components: z.array(z.string()),
  keyringPath: z.string(),
  sourceLine: z.string(),
});

export const pypiClientInfoSchema = z.object({
  repository: z.string(),
  ecosystem: z.literal("pypi"),
  simpleUrl: z.string(),
  pipIndexUrl: z.string(),
});

export const installInstructionsSchema = z.object({
  repository: z.string(),
  visibility: repositoryVisibilitySchema,
  keyUrl: z.string(),
  keyringPath: z.string(),
  sourceListPath: z.string(),
  sourceLine: z.string(),
  script: z.string(),
  authConfPath: z.string().optional(),
  authConfTemplate: z.string().optional(),
  commands: z.array(z.string()),
});

export const adminSessionSchema = z.object({
  ok: z.literal(true),
});

export type Repository = z.infer<typeof repositorySchema>;
export type RepositoryPlugin = z.infer<typeof repositoryPluginSchema>;
export type RepositoryVisibility = z.infer<typeof repositoryVisibilitySchema>;
export type PublishToken = z.infer<typeof publishTokenSchema>;
export type PublishTokenCreateResponse = z.infer<typeof publishTokenCreateResponseSchema>;
export type SigningKey = z.infer<typeof signingKeySchema>;
export type AptSourceInfo = z.infer<typeof aptSourceInfoSchema>;
export type PypiClientInfo = z.infer<typeof pypiClientInfoSchema>;
export type InstallInstructions = z.infer<typeof installInstructionsSchema>;
