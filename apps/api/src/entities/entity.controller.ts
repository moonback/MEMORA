import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
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

const entityTypes = ["person", "organization", "place", "project", "product", "topic", "other"] as const;
const relationTypes = ["related_to", "works_with", "member_of", "located_in", "part_of", "owns", "replaces", "depends_on", "custom"] as const;
const jsonObject = z.record(z.unknown());

export const createEntitySchema = z.object({
  type: z.enum(entityTypes),
  canonicalName: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  attributes: jsonObject.optional(),
}).strict().refine((value) => new Set(value.aliases.map((alias) => alias.toLocaleLowerCase())).size === value.aliases.length,
  "Les alias ne doivent pas être dupliqués.");

export const updateEntitySchema = z.object({
  canonicalName: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  attributes: jsonObject.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Au moins un champ doit être modifié.")
  .refine((value) => !value.aliases || new Set(value.aliases.map((alias) => alias.toLocaleLowerCase())).size === value.aliases.length,
    "Les alias ne doivent pas être dupliqués.");

export const listEntitiesQuerySchema = z.object({
  type: z.enum(entityTypes).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();

export const linkMemorySchema = z.object({
  memoryId: z.string().uuid(),
  mention: z.string().trim().min(1).max(300).optional(),
}).strict();

export const createEntityRelationSchema = z.object({
  toEntityId: z.string().uuid(),
  type: z.enum(relationTypes),
  label: z.string().trim().min(1).max(160).optional(),
  properties: jsonObject.optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  evidence: z.array(z.object({
    sourceChunkId: z.string().uuid(),
    quote: z.string().trim().min(1).max(4000).optional(),
    confidence: z.number().int().min(0).max(100).optional(),
  }).strict()).max(30).default([]),
}).strict().refine(
  (value) => value.toEntityId.length > 0,
  "Une entité cible est requise.",
).refine(
  (value) => !value.validFrom || !value.validUntil || Date.parse(value.validUntil) >= Date.parse(value.validFrom),
  "La fin de validité doit être postérieure au début.",
).refine(
  (value) => new Set(value.evidence.map((item) => item.sourceChunkId)).size === value.evidence.length,
  "Les preuves ne doivent pas être dupliquées.",
);

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ message, issues: parsed.error.issues });
  return parsed.data;
}

const entityColumns = `id, workspace_id, type, canonical_name, description, aliases, attributes, created_at, updated_at`;

@Controller("workspaces/:workspaceId/entities")
@UseGuards(WorkspaceMembershipGuard)
export class EntityController {
  @Get()
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Query() query: unknown,
  ) {
    const filters = parseOrBadRequest(listEntitiesQuerySchema, query, "Filtres d'entités invalides.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const values: unknown[] = [workspaceId];
      const clauses = ["workspace_id = $1"];
      if (filters.type) {
        values.push(filters.type);
        clauses.push(`type = $${values.length}`);
      }
      if (filters.q) {
        values.push(`%${filters.q}%`);
        clauses.push(`(canonical_name ILIKE $${values.length} OR description ILIKE $${values.length} OR aliases::text ILIKE $${values.length})`);
      }
      values.push(filters.limit);
      const limitIndex = values.length;
      values.push(filters.offset);
      const offsetIndex = values.length;
      const result = await client.query(
        `SELECT ${entityColumns},
          (SELECT count(*)::int FROM memory_entities me WHERE me.entity_id = entities.id AND me.workspace_id = entities.workspace_id) AS memory_count,
          (SELECT count(*)::int FROM entity_relations er WHERE er.workspace_id = entities.workspace_id AND (er.from_entity_id = entities.id OR er.to_entity_id = entities.id)) AS relation_count
         FROM entities WHERE ${clauses.join(" AND ")}
         ORDER BY lower(canonical_name), created_at LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return { entities: result.rows, pagination: { limit: filters.limit, offset: filters.offset } };
    });
  }

  @Post()
  @RequireWorkspaceRoles("owner", "admin", "member")
  async create(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(createEntitySchema, body, "Entité invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      try {
        const result = await client.query(
          `INSERT INTO entities (workspace_id, type, canonical_name, description, aliases, attributes)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING ${entityColumns}`,
          [workspaceId, input.type, input.canonicalName, input.description ?? null,
            JSON.stringify(input.aliases), JSON.stringify(input.attributes ?? {})],
        );
        return { entity: result.rows[0] };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("Une entité de même type et de même nom existe déjà dans cet espace.");
        throw error;
      }
    });
  }

  @Get(":entityId")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const entity = await client.query(`SELECT ${entityColumns} FROM entities WHERE id = $1 AND workspace_id = $2`, [entityId, workspaceId]);
      if (!entity.rows[0]) throw new NotFoundException("Entité introuvable.");
      const [memories, relations] = await Promise.all([
        client.query(
          `SELECT m.id, m.type, m.status, m.content, m.summary, m.confidence, m.occurred_at, me.mention, me.created_at AS linked_at
           FROM memory_entities me JOIN memories m ON m.id = me.memory_id AND m.workspace_id = me.workspace_id
           WHERE me.entity_id = $1 AND me.workspace_id = $2 ORDER BY m.updated_at DESC LIMIT 100`,
          [entityId, workspaceId],
        ),
        client.query(
          `SELECT er.id, er.from_entity_id, er.to_entity_id, er.type, er.label, er.properties, er.valid_from, er.valid_until,
                  er.confidence, er.created_at,
                  f.canonical_name AS from_name, t.canonical_name AS to_name
           FROM entity_relations er
           JOIN entities f ON f.id = er.from_entity_id AND f.workspace_id = er.workspace_id
           JOIN entities t ON t.id = er.to_entity_id AND t.workspace_id = er.workspace_id
           WHERE er.workspace_id = $1 AND (er.from_entity_id = $2 OR er.to_entity_id = $2)
           ORDER BY er.created_at DESC LIMIT 100`,
          [workspaceId, entityId],
        ),
      ]);
      return { entity: entity.rows[0], memories: memories.rows, relations: relations.rows };
    });
  }

  @Patch(":entityId")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async update(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(updateEntitySchema, body, "Modification d'entité invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const current = await client.query("SELECT id, type FROM entities WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [entityId, workspaceId]);
      if (!current.rows[0]) throw new NotFoundException("Entité introuvable.");
      const fields: string[] = [];
      const values: unknown[] = [entityId, workspaceId];
      const add = (column: string, value: unknown, json = false) => {
        values.push(json ? JSON.stringify(value) : value);
        fields.push(`${column} = $${values.length}${json ? "::jsonb" : ""}`);
      };
      if (input.canonicalName !== undefined) add("canonical_name", input.canonicalName);
      if (input.description !== undefined) add("description", input.description);
      if (input.aliases !== undefined) add("aliases", input.aliases, true);
      if (input.attributes !== undefined) add("attributes", input.attributes, true);
      fields.push("updated_at = now()");
      try {
        const result = await client.query(
          `UPDATE entities SET ${fields.join(", ")} WHERE id = $1 AND workspace_id = $2 RETURNING ${entityColumns}`,
          values,
        );
        return { entity: result.rows[0] };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("Une entité de même type et de même nom existe déjà dans cet espace.");
        throw error;
      }
    });
  }

  @Post(":entityId/memories")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async linkMemory(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(linkMemorySchema, body, "Lien mémoire-entité invalide.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const [entity, memory] = await Promise.all([
        client.query("SELECT id FROM entities WHERE id = $1 AND workspace_id = $2", [entityId, workspaceId]),
        client.query("SELECT id FROM memories WHERE id = $1 AND workspace_id = $2", [input.memoryId, workspaceId]),
      ]);
      if (!entity.rows[0] || !memory.rows[0]) throw new NotFoundException("Mémoire ou entité introuvable dans cet espace.");
      const result = await client.query(
        `INSERT INTO memory_entities (workspace_id, memory_id, entity_id, mention)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (memory_id, entity_id) DO UPDATE SET mention = EXCLUDED.mention
         RETURNING workspace_id, memory_id, entity_id, mention, created_at`,
        [workspaceId, input.memoryId, entityId, input.mention ?? null],
      );
      return { link: result.rows[0] };
    });
  }

  @Delete(":entityId/memories/:memoryId")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async unlinkMemory(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @Param("memoryId", new ParseUUIDPipe()) memoryId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query(
        "DELETE FROM memory_entities WHERE workspace_id = $1 AND entity_id = $2 AND memory_id = $3 RETURNING memory_id",
        [workspaceId, entityId, memoryId],
      );
      if (!result.rows[0]) throw new NotFoundException("Lien mémoire-entité introuvable.");
      return { deleted: true, memoryId, entityId };
    });
  }

  @Post(":entityId/relations")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async createRelation(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const input = parseOrBadRequest(createEntityRelationSchema, body, "Relation invalide.");
    // Keep the output safe for callers even when Zod's inferred type marks a defaulted array optional.
    const evidence = input.evidence ?? [];
    if (input.toEntityId === entityId) throw new BadRequestException("Une entité ne peut pas être reliée à elle-même.");
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const ids = [entityId, input.toEntityId];
      const entities = await client.query("SELECT id FROM entities WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, ids]);
      if (entities.rowCount !== 2) throw new NotFoundException("Entité source ou cible introuvable dans cet espace.");
      if (evidence.length) {
        const chunkIds = evidence.map((item) => item.sourceChunkId);
        const chunks = await client.query("SELECT id FROM source_chunks WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, chunkIds]);
        if (chunks.rowCount !== new Set(chunkIds).size) throw new BadRequestException("Une ou plusieurs preuves ne correspondent pas à une source de cet espace.");
      }
      const inserted = await client.query(
        `INSERT INTO entity_relations
          (workspace_id, from_entity_id, to_entity_id, type, label, properties, confidence, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         RETURNING id, workspace_id, from_entity_id, to_entity_id, type, label, properties, confidence, valid_from, valid_until, created_at, updated_at`,
        [workspaceId, entityId, input.toEntityId, input.type, input.label ?? null,
          JSON.stringify(input.properties ?? {}), input.confidence ?? null,
          input.validFrom ? new Date(input.validFrom) : null, input.validUntil ? new Date(input.validUntil) : null],
      );
      const relation = inserted.rows[0];
      for (const item of evidence) {
        await client.query(
          `INSERT INTO entity_relation_evidence (workspace_id, relation_id, source_chunk_id, quote, confidence)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, relation.id, item.sourceChunkId, item.quote ?? null, item.confidence ?? null],
        );
      }
      return { relation, evidenceCount: evidence.length };
    });
  }

  @Get(":entityId/relations")
  async listRelations(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("entityId", new ParseUUIDPipe()) entityId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const exists = await client.query("SELECT id FROM entities WHERE id = $1 AND workspace_id = $2", [entityId, workspaceId]);
      if (!exists.rows[0]) throw new NotFoundException("Entité introuvable.");
      const result = await client.query(
        `SELECT er.id, er.from_entity_id, er.to_entity_id, er.type, er.label, er.properties, er.confidence,
                er.valid_from, er.valid_until, er.created_at,
                f.canonical_name AS from_name, t.canonical_name AS to_name,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id', ev.id, 'sourceChunkId', ev.source_chunk_id, 'quote', ev.quote, 'confidence', ev.confidence
                )) FILTER (WHERE ev.id IS NOT NULL), '[]'::jsonb) AS evidence
         FROM entity_relations er
         JOIN entities f ON f.id = er.from_entity_id AND f.workspace_id = er.workspace_id
         JOIN entities t ON t.id = er.to_entity_id AND t.workspace_id = er.workspace_id
         LEFT JOIN entity_relation_evidence ev ON ev.relation_id = er.id AND ev.workspace_id = er.workspace_id
         WHERE er.workspace_id = $1 AND (er.from_entity_id = $2 OR er.to_entity_id = $2)
         GROUP BY er.id, f.canonical_name, t.canonical_name
         ORDER BY er.created_at DESC LIMIT 200`,
        [workspaceId, entityId],
      );
      return { relations: result.rows };
    });
  }

  @Delete("relations/:relationId")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async deleteRelation(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("relationId", new ParseUUIDPipe()) relationId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query(
        "DELETE FROM entity_relations WHERE id = $1 AND workspace_id = $2 RETURNING id",
        [relationId, workspaceId],
      );
      if (!result.rows[0]) throw new NotFoundException("Relation introuvable.");
      return { deleted: true, relationId };
    });
  }
}
