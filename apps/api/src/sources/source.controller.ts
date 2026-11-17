import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "../workspaces/workspace-membership.decorator.js";
import {
  WorkspaceMembershipGuard,
  type WorkspaceMembershipContext,
} from "../workspaces/workspace-membership.guard.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { replaceCurrentChunks } from "./source-chunk-versioning.js";

const sourceTypes = ["document", "email", "audio", "note", "image", "manual", "web_clip"] as const;
const sourceStatuses = ["pending", "processing", "ready", "failed", "archived"] as const;

const metadataSchema = z.record(z.unknown()).optional();

export const createSourceSchema = z.object({
  type: z.enum(sourceTypes),
  title: z.string().trim().min(1).max(500).optional(),
  originalName: z.string().trim().min(1).max(500).optional(),
  mimeType: z.string().trim().min(1).max(160).optional(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  capturedAt: z.string().datetime().optional(),
  metadata: metadataSchema,
}).strict();

export const listSourcesQuerySchema = z.object({
  type: z.enum(sourceTypes).optional(),
  status: z.enum(sourceStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();

const chunkSchema = z.object({
  ordinal: z.number().int().min(0).max(100000),
  content: z.string().trim().min(1).max(20000),
  tokenCount: z.number().int().min(0).max(2147483647).optional(),
  pageNumber: z.number().int().min(1).max(2147483647).optional(),
  timeStartMs: z.number().int().min(0).max(2147483647).optional(),
  timeEndMs: z.number().int().min(0).max(2147483647).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict().refine(
  (chunk) => chunk.timeStartMs === undefined || chunk.timeEndMs === undefined || chunk.timeEndMs >= chunk.timeStartMs,
  "La fin du segment doit être postérieure à son début.",
);

export const replaceSourceChunksSchema = z.object({
  chunks: z.array(chunkSchema).min(1).max(100),
}).strict().refine(
  ({ chunks }) => new Set(chunks.map((chunk) => chunk.ordinal)).size === chunks.length,
  "Chaque segment doit avoir un ordinal unique.",
);

type SourceRow = {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  type: string;
  status: string;
  title: string | null;
  original_name: string | null;
  mime_type: string | null;
  checksum_sha256: string | null;
  metadata: Record<string, unknown>;
  captured_at: Date | null;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const sourceColumns = `id, workspace_id, created_by_user_id, type, status, title,
  original_name, mime_type, checksum_sha256, metadata, captured_at, processed_at,
  created_at, updated_at`;

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ message, issues: parsed.error.issues });
  return parsed.data;
}

@Controller("workspaces/:workspaceId/sources")
@UseGuards(WorkspaceMembershipGuard)
export class SourceController {
  @Get()
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Query() query: unknown,
  ) {
    const filters = parseOrBadRequest(listSourcesQuerySchema, query, "Filtres de sources invalides.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const values: unknown[] = [workspaceId];
      const clauses = ["workspace_id = $1"];
      if (filters.type) {
        values.push(filters.type);
        clauses.push(`type = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        clauses.push(`status = $${values.length}`);
      }
      values.push(filters.limit);
      const limitParam = values.length;
      values.push(filters.offset);
      const offsetParam = values.length;
      const result = await client.query<SourceRow>(
        `SELECT ${sourceColumns},
                (SELECT jsonb_build_object('status', i.status, 'attempts', i.attempts,
                  'maxAttempts', i.max_attempts, 'updatedAt', i.updated_at,
                  'lastErrorCode', i.last_error_code)
                 FROM source_ingestions i WHERE i.source_id = sources.id
                 ORDER BY i.source_version DESC LIMIT 1) AS ingestion
         FROM sources WHERE ${clauses.join(" AND ")}
         ORDER BY captured_at DESC NULLS LAST, created_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        values,
      );
      return { sources: result.rows, pagination: { limit: filters.limit, offset: filters.offset } };
    });
  }

  @Post()
  @RequireWorkspaceRoles("owner", "admin", "member")
  async create(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(createSourceSchema, body, "Métadonnées de source invalides.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { user }) => {
      const result = await client.query<SourceRow>(
        `INSERT INTO sources
          (workspace_id, created_by_user_id, type, status, title, original_name,
           mime_type, checksum_sha256, metadata, captured_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING ${sourceColumns}`,
        [
          workspaceId,
          user.id,
          input.type,
          input.title ?? null,
          input.originalName ?? null,
          input.mimeType ?? null,
          input.checksumSha256?.toLowerCase() ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.capturedAt ? new Date(input.capturedAt) : new Date(),
        ],
      );
      const source = result.rows[0];
      if (!source) throw new Error("La source n'a pas pu être créée.");
      return { source };
    });
  }

  @Get(":sourceId")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<SourceRow & { chunk_count: number }>(
        `SELECT s.${sourceColumns.split(", ").join(", s.")},
                (SELECT count(*)::int FROM source_chunks c
                 WHERE c.workspace_id = s.workspace_id AND c.source_id = s.id AND c.is_current) AS chunk_count,
                (SELECT jsonb_build_object('status', i.status, 'attempts', i.attempts,
                  'maxAttempts', i.max_attempts, 'updatedAt', i.updated_at,
                  'lastErrorCode', i.last_error_code)
                 FROM source_ingestions i WHERE i.source_id = s.id
                 ORDER BY i.source_version DESC LIMIT 1) AS ingestion
         FROM sources s WHERE s.id = $1 AND s.workspace_id = $2 LIMIT 1`,
        [sourceId, workspaceId],
      );
      const source = result.rows[0];
      if (!source) throw new NotFoundException("Source introuvable.");
      return { source };
    });
  }

  @Get(":sourceId/chunks")
  async listChunks(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const source = await client.query("SELECT id FROM sources WHERE id = $1 AND workspace_id = $2", [sourceId, workspaceId]);
      if (!source.rowCount) throw new NotFoundException("Source introuvable.");
      const chunks = await client.query(
        `SELECT id, ordinal, content, token_count, page_number, time_start_ms,
                time_end_ms, metadata, created_at
         FROM source_chunks WHERE source_id = $1 AND workspace_id = $2 AND is_current
         ORDER BY ordinal ASC`,
        [sourceId, workspaceId],
      );
      return { chunks: chunks.rows };
    });
  }

  @Put(":sourceId/chunks")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async replaceChunks(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(replaceSourceChunksSchema, body, "Segments de source invalides.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const source = await client.query<{ status: string }>(
        "SELECT status FROM sources WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [sourceId, workspaceId],
      );
      const current = source.rows[0];
      if (!current) throw new NotFoundException("Source introuvable.");
      if (current.status === "archived") throw new ConflictException("Une source archivée ne peut pas être réindexée.");

      // Versioned replacement: unchanged chunks keep their IDs, replaced ones are retired, never deleted.
      await replaceCurrentChunks(client, workspaceId, sourceId, input.chunks);
      const updated = await client.query<SourceRow>(
        `UPDATE sources SET status = 'ready', processed_at = now(), updated_at = now()
         WHERE id = $1 AND workspace_id = $2 RETURNING ${sourceColumns}`,
        [sourceId, workspaceId],
      );
      return { source: updated.rows[0], chunkCount: input.chunks.length };
    });
  }

  @Post(":sourceId/archive")
  @RequireWorkspaceRoles("owner", "admin")
  async archive(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<SourceRow>(
        `UPDATE sources SET status = 'archived', updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND status <> 'archived'
         RETURNING ${sourceColumns}`,
        [sourceId, workspaceId],
      );
      const source = result.rows[0];
      if (!source) throw new NotFoundException("Source introuvable ou déjà archivée.");
      return { source };
    });
  }
}
