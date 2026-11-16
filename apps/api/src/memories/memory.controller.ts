import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "../workspaces/workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "../workspaces/workspace-membership.guard.js";

const memoryTypes = ["fact", "preference", "event", "decision", "commitment", "note", "observation"] as const;
const memoryStatuses = ["active", "superseded", "archived"] as const;
const evidenceTypes = ["supports", "contradicts", "context"] as const;
const attributesSchema = z.record(z.unknown()).optional();

export const createMemoryRequestSchema = z.object({
  type: z.enum(memoryTypes),
  content: z.string().trim().min(1).max(20000),
  summary: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  occurredAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  attributes: attributesSchema,
  evidence: z.array(z.object({
    sourceChunkId: z.string().uuid(),
    evidenceType: z.enum(evidenceTypes).default("supports"),
    quote: z.string().trim().min(1).max(4000).optional(),
    confidence: z.number().int().min(0).max(100).optional(),
  }).strict()).max(50).optional(),
}).strict().refine(
  (value) => !value.validFrom || !value.validUntil || Date.parse(value.validUntil) >= Date.parse(value.validFrom),
  "La fin de validité doit être postérieure au début.",
).refine(
  (value) => !value.evidence || new Set(value.evidence.map((item) => item.sourceChunkId + ":" + item.evidenceType)).size === value.evidence.length,
  "Les preuves ne doivent pas être dupliquées.",
);

export const updateMemoryRequestSchema = z.object({
  content: z.string().trim().min(1).max(20000).optional(),
  summary: z.string().trim().min(1).max(1000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Au moins un champ doit être modifié.");

export const listMemoriesQuerySchema = z.object({
  type: z.enum(memoryTypes).optional(),
  status: z.enum(memoryStatuses).default("active"),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();

export const createMemoryEvidenceSchema = z.object({
  sourceChunkId: z.string().uuid(),
  evidenceType: z.enum(evidenceTypes).default("supports"),
  quote: z.string().trim().min(1).max(4000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
}).strict();

export const supersedeMemorySchema = z.object({
  type: z.enum(memoryTypes),
  content: z.string().trim().min(1).max(20000),
  summary: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  occurredAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  attributes: attributesSchema,
}).strict().refine(
  (value) => !value.validFrom || !value.validUntil || Date.parse(value.validUntil) >= Date.parse(value.validFrom),
  "La fin de validité doit être postérieure au début.",
);

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ message, issues: parsed.error.issues });
  return parsed.data;
}

type MemoryDbRow = { id: string; status?: string; [key: string]: unknown };
const memoryColumns = `id, workspace_id, created_by_user_id, type, status, content, summary,
  confidence, occurred_at, valid_from, valid_until, supersedes_memory_id, attributes,
  created_at, updated_at`;

@Controller("workspaces/:workspaceId/memories")
@UseGuards(WorkspaceMembershipGuard)
export class MemoryController {
  @Get()
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Query() query: unknown,
  ) {
    const filters = parseOrBadRequest(listMemoriesQuerySchema, query, "Filtres de mémoires invalides.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const values: unknown[] = [workspaceId, filters.status];
      const clauses = ["workspace_id = $1", "status = $2"];
      if (filters.type) {
        values.push(filters.type);
        clauses.push(`type = $${values.length}`);
      }
      if (filters.q) {
        values.push(`%${filters.q}%`);
        clauses.push(`(content ILIKE $${values.length} OR summary ILIKE $${values.length})`);
      }
      values.push(filters.limit);
      const limitIndex = values.length;
      values.push(filters.offset);
      const offsetIndex = values.length;
      const result = await client.query(
        `SELECT ${memoryColumns} FROM memories WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC, created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return { memories: result.rows, pagination: { limit: filters.limit, offset: filters.offset, status: filters.status } };
    });
  }

  @Post()
  @RequireWorkspaceRoles("owner", "admin", "member")
  async create(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(createMemoryRequestSchema, body, "Mémoire invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { user }) => {
      const evidenceIds = input.evidence?.map((item) => item.sourceChunkId) ?? [];
      if (evidenceIds.length) {
        const chunks = await client.query(
          "SELECT id FROM source_chunks WHERE workspace_id = $1 AND id = ANY($2::uuid[])",
          [workspaceId, evidenceIds],
        );
        if (chunks.rowCount !== new Set(evidenceIds).size) throw new BadRequestException("Une ou plusieurs preuves ne correspondent pas à une source de cet espace.");
      }
      const result = await client.query<MemoryDbRow>(
        `INSERT INTO memories
          (workspace_id, created_by_user_id, type, status, content, summary, confidence,
           occurred_at, valid_from, valid_until, attributes)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING ${memoryColumns}`,
        [workspaceId, user.id, input.type, input.content, input.summary ?? null,
          input.confidence ?? null, input.occurredAt ? new Date(input.occurredAt) : null,
          input.validFrom ? new Date(input.validFrom) : null, input.validUntil ? new Date(input.validUntil) : null,
          JSON.stringify(input.attributes ?? {})],
      );
      const memory = result.rows[0];
      if (!memory) throw new InternalServerErrorException("La mémoire créée n'a pas été retournée par la base de données.");
      for (const item of input.evidence ?? []) {
        await client.query(
          `INSERT INTO memory_evidence
            (workspace_id, memory_id, source_chunk_id, evidence_type, quote, confidence)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspaceId, memory.id, item.sourceChunkId, item.evidenceType, item.quote ?? null, item.confidence ?? null],
        );
      }
      return { memory, evidenceCount: evidenceIds.length };
    });
  }

  @Get(":memoryId")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<MemoryDbRow>(`SELECT ${memoryColumns} FROM memories WHERE id = $1 AND workspace_id = $2`, [memoryId, workspaceId]);
      const memory = result.rows[0];
      if (!memory) throw new NotFoundException("Mémoire introuvable.");
      const evidence = await client.query(
        `SELECT e.id, e.source_chunk_id, e.evidence_type, e.quote, e.confidence, e.created_at,
                c.source_id, c.ordinal, c.page_number, c.time_start_ms, c.time_end_ms,
                s.title AS source_title, s.type AS source_type
         FROM memory_evidence e
         JOIN source_chunks c ON c.id = e.source_chunk_id AND c.workspace_id = e.workspace_id
         JOIN sources s ON s.id = c.source_id AND s.workspace_id = c.workspace_id
         WHERE e.memory_id = $1 AND e.workspace_id = $2 ORDER BY e.created_at ASC`,
        [memoryId, workspaceId],
      );
      return { memory, evidence: evidence.rows };
    });
  }

  @Patch(":memoryId")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async update(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(updateMemoryRequestSchema, body, "Modification de mémoire invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const current = await client.query<{ status: string; valid_from: Date | null; valid_until: Date | null }>("SELECT status, valid_from, valid_until FROM memories WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [memoryId, workspaceId]);
      if (!current.rows[0]) throw new NotFoundException("Mémoire introuvable.");
      if (current.rows[0].status !== "active") throw new ConflictException("Seule une mémoire active peut être modifiée.");
      const nextValidFrom = input.validFrom === undefined ? current.rows[0].valid_from : input.validFrom ? new Date(input.validFrom) : null;
      const nextValidUntil = input.validUntil === undefined ? current.rows[0].valid_until : input.validUntil ? new Date(input.validUntil) : null;
      if (nextValidFrom && nextValidUntil && nextValidUntil < nextValidFrom) throw new BadRequestException("La fin de validité doit être postérieure au début.");
      const fields: string[] = [];
      const values: unknown[] = [memoryId, workspaceId];
      const add = (column: string, value: unknown) => { values.push(value); fields.push(`${column} = $${values.length}`); };
      if (input.content !== undefined) add("content", input.content);
      if (input.summary !== undefined) add("summary", input.summary);
      if (input.confidence !== undefined) add("confidence", input.confidence);
      if (input.occurredAt !== undefined) add("occurred_at", input.occurredAt ? new Date(input.occurredAt) : null);
      if (input.validFrom !== undefined) add("valid_from", input.validFrom ? new Date(input.validFrom) : null);
      if (input.validUntil !== undefined) add("valid_until", input.validUntil ? new Date(input.validUntil) : null);
      if (input.attributes !== undefined) add("attributes", JSON.stringify(input.attributes));
      fields.push("updated_at = now()");
      const result = await client.query<MemoryDbRow>(`UPDATE memories SET ${fields.join(", ")} WHERE id = $1 AND workspace_id = $2 RETURNING ${memoryColumns}`, values);
      return { memory: result.rows[0] };
    });
  }

  @Post(":memoryId/evidence")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async addEvidence(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(createMemoryEvidenceSchema, body, "Preuve invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const memory = await client.query<{ id: string; status: string }>("SELECT id, status FROM memories WHERE id = $1 AND workspace_id = $2", [memoryId, workspaceId]);
      if (!memory.rows[0]) throw new NotFoundException("Mémoire introuvable.");
      if (memory.rows[0].status !== "active") throw new ConflictException("Une preuve ne peut être ajoutée qu'à une mémoire active.");
      const chunk = await client.query("SELECT id FROM source_chunks WHERE id = $1 AND workspace_id = $2", [input.sourceChunkId, workspaceId]);
      if (!chunk.rows[0]) throw new BadRequestException("Le segment source n'appartient pas à cet espace.");
      const result = await client.query(
        `INSERT INTO memory_evidence (workspace_id, memory_id, source_chunk_id, evidence_type, quote, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (memory_id, source_chunk_id, evidence_type) DO UPDATE
           SET quote = EXCLUDED.quote, confidence = EXCLUDED.confidence
         RETURNING id, memory_id, source_chunk_id, evidence_type, quote, confidence, created_at`,
        [workspaceId, memoryId, input.sourceChunkId, input.evidenceType, input.quote ?? null, input.confidence ?? null],
      );
      return { evidence: result.rows[0] };
    });
  }

  @Delete(":memoryId/evidence/:evidenceId")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async removeEvidence(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @Param("evidenceId", new ParseUUIDPipe()) evidenceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query(
        "DELETE FROM memory_evidence WHERE id = $1 AND memory_id = $2 AND workspace_id = $3 RETURNING id",
        [evidenceId, memoryId, workspaceId],
      );
      if (!result.rows[0]) throw new NotFoundException("Preuve introuvable.");
      return { deleted: true, evidenceId };
    });
  }

  @Post(":memoryId/supersede")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async supersede(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(supersedeMemorySchema, body, "Nouvelle version de mémoire invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { user }) => {
      const previous = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM memories WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [memoryId, workspaceId],
      );
      if (!previous.rows[0]) throw new NotFoundException("Mémoire à remplacer introuvable.");
      if (previous.rows[0].status !== "active") throw new ConflictException("Seule une mémoire active peut être remplacée.");
      const inserted = await client.query<MemoryDbRow>(
        `INSERT INTO memories
          (workspace_id, created_by_user_id, type, status, content, summary, confidence,
           occurred_at, valid_from, valid_until, supersedes_memory_id, attributes)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         RETURNING ${memoryColumns}`,
        [workspaceId, user.id, input.type, input.content, input.summary ?? null, input.confidence ?? null,
          input.occurredAt ? new Date(input.occurredAt) : null, input.validFrom ? new Date(input.validFrom) : null,
          input.validUntil ? new Date(input.validUntil) : null, memoryId, JSON.stringify(input.attributes ?? {})],
      );
      await client.query(
        "UPDATE memories SET status = 'superseded', valid_until = COALESCE(valid_until, now()), updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [memoryId, workspaceId],
      );
      return { memory: inserted.rows[0], supersededMemoryId: memoryId };
    });
  }

  @Post(":memoryId/archive")
  @RequireWorkspaceRoles("owner", "admin")
  async archive(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<MemoryDbRow>(
        `UPDATE memories SET status = 'archived', updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND status = 'active'
         RETURNING ${memoryColumns}`,
        [memoryId, workspaceId],
      );
      if (!result.rows[0]) throw new NotFoundException("Mémoire introuvable ou déjà inactive.");
      return { memory: result.rows[0] };
    });
  }
}
