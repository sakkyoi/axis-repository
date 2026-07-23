import { z } from "zod";

export const pypiClientInfoSchema = z.object({
  repository: z.string(),
  ecosystem: z.literal("pypi"),
  simpleUrl: z.string(),
  pipIndexUrl: z.string(),
});

export type PypiClientInfo = z.infer<typeof pypiClientInfoSchema>;
