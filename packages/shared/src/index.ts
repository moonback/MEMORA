import { z } from "zod";

export const memoryTypeSchema = z.enum(["fact","preference","event","decision","commitment","note","observation"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export const sourceTypeSchema = z.enum(["document","email","audio","note","image","manual","web_clip"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;
export const sourceStatusSchema = z.enum(["pending","processing","ready","failed","archived"]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export const createSourceContractSchema = z.object({
  type: sourceTypeSchema,
  title: z.string().trim().min(1).max(500).optional(),
  originalName: z.string().trim().min(1).max(500).optional(),
  mimeType: z.string().trim().min(1).max(160).optional(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  capturedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();
export type CreateSourceContract = z.infer<typeof createSourceContractSchema>;
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
