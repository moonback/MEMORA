import { z } from "zod";

export const memoryTypeSchema = z.enum(["fact","preference","event","decision","commitment","note","observation"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export const sourceTypeSchema = z.enum(["document","email","audio","note","image","manual"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;
export const createMemorySchema = z.object({
  workspaceId: z.string().uuid(),
  type: memoryTypeSchema,
  content: z.string().trim().min(1).max(20000),
  occurredAt: z.string().datetime().optional()
});
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export const healthResponseSchema = z.object({
  status: z.enum(["ok","degraded"]), service: z.string(), timestamp: z.string().datetime()
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
