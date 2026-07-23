import { z } from "zod";
import { repositoryVisibilitySchema } from "../../api/schemas";

export const aptSourceInfoSchema = z.object({
  repository: z.string(),
  ecosystem: z.literal("apt"),
  baseUrl: z.string(),
  codename: z.string(),
  components: z.array(z.string()),
  keyringPath: z.string(),
  sourceLine: z.string(),
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

export type AptSourceInfo = z.infer<typeof aptSourceInfoSchema>;
export type InstallInstructions = z.infer<typeof installInstructionsSchema>;
