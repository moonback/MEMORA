import { z } from "zod";

export const memoryTypeSchema = z.enum(["fact","preference","event","decision","commitment","note","observation"]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export const memoryStatusSchema = z.enum(["active","superseded","archived"]);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export const memoryEvidenceTypeSchema = z.enum(["supports","contradicts","context"]);
export const memoryEvidenceContractSchema = z.object({
  sourceChunkId: z.string().uuid(),
  evidenceType: memoryEvidenceTypeSchema.default("supports"),
  quote: z.string().trim().min(1).max(4000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
}).strict();
export const createMemoryContractSchema = z.object({
  type: memoryTypeSchema,
  content: z.string().trim().min(1).max(20000),
  summary: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  occurredAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  attributes: z.record(z.unknown()).optional(),
  evidence: z.array(memoryEvidenceContractSchema).max(50).optional(),
}).strict().refine(
  (value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom,
  "La fin de validité doit être postérieure au début.",
).refine(
  (value) => !value.evidence || new Set(value.evidence.map((item) => item.sourceChunkId + ":" + item.evidenceType)).size === value.evidence.length,
  "Les preuves ne doivent pas être dupliquées.",
);
export type CreateMemoryContract = z.infer<typeof createMemoryContractSchema>;
export const updateMemoryContractSchema = z.object({
  content: z.string().trim().min(1).max(20000).optional(),
  summary: z.string().trim().min(1).max(1000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Au moins un champ doit être modifié.");

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

// Backwards-compatible input retained for early consumers; workspace identity is never accepted by the API route.
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
