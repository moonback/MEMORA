import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const workspaceTypeEnum = pgEnum("workspace_type", ["personal", "shared"]);
export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "invited", "suspended"]);
export const sourceTypeEnum = pgEnum("source_type", ["document", "email", "audio", "note", "image", "manual", "web_clip"]);
export const sourceStatusEnum = pgEnum("source_status", ["pending", "processing", "ready", "failed", "archived"]);
export const memoryTypeEnum = pgEnum("memory_type", ["fact", "preference", "event", "decision", "commitment", "note", "observation"]);
export const memoryStatusEnum = pgEnum("memory_status", ["active", "superseded", "archived"]);
export const consentStatusEnum = pgEnum("consent_status", ["granted", "revoked"]);
export const entityTypeEnum = pgEnum("entity_type", ["person", "organization", "place", "project", "product", "topic", "other"]);
export const relationTypeEnum = pgEnum("relation_type", ["related_to", "works_with", "member_of", "located_in", "part_of", "owns", "replaces", "depends_on", "custom"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  authUserId: varchar("auth_user_id", { length: 64 }),
  displayName: varchar("display_name", { length: 160 }),
  locale: varchar("locale", { length: 16 }).notNull().default("fr-FR"),
  timeZone: varchar("time_zone", { length: 64 }).notNull().default("Europe/Paris"),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_auth_user_id_unique").on(table.authUserId),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  type: workspaceTypeEnum("type").notNull().default("personal"),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  description: varchar("description", { length: 500 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("workspaces_id_owner_unique").on(table.id, table.ownerUserId),
  uniqueIndex("workspaces_one_personal_per_owner_unique").on(table.ownerUserId).where(sql`${table.type} = 'personal'`),
  index("workspaces_owner_idx").on(table.ownerUserId),
]);

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: workspaceRoleEnum("role").notNull().default("member"),
  status: membershipStatusEnum("status").notNull().default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("workspace_members_workspace_user_unique").on(table.workspaceId, table.userId),
  index("workspace_members_user_idx").on(table.userId),
]);

export const workspaceInvitations = pgTable("workspace_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: workspaceRoleEnum("role").notNull().default("member"),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("workspace_invitations_pending_unique").on(table.workspaceId, table.email).where(sql`accepted_at IS NULL`),
  index("workspace_invitations_expiry_idx").on(table.expiresAt),
]);

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: varchar("purpose", { length: 80 }).notNull(),
  status: consentStatusEnum("status").notNull(),
  policyVersion: varchar("policy_version", { length: 40 }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
}, (table) => [
  index("consents_workspace_user_purpose_idx").on(table.workspaceId, table.userId, table.purpose, table.decidedAt),
]);

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  type: sourceTypeEnum("type").notNull(),
  status: sourceStatusEnum("status").notNull().default("pending"),
  title: varchar("title", { length: 500 }),
  originalName: varchar("original_name", { length: 500 }),
  mimeType: varchar("mime_type", { length: 160 }),
  storageKey: text("storage_key"),
  checksumSha256: varchar("checksum_sha256", { length: 64 }),
  externalProvider: varchar("external_provider", { length: 80 }),
  externalId: varchar("external_id", { length: 512 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique("sources_id_workspace_unique").on(table.id, table.workspaceId),
  index("sources_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("sources_workspace_status_idx").on(table.workspaceId, table.status),
  uniqueIndex("sources_external_identity_unique").on(table.workspaceId, table.externalProvider, table.externalId).where(sql`external_provider IS NOT NULL AND external_id IS NOT NULL`),
]);

export const sourceChunks = pgTable("source_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  sourceId: uuid("source_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  pageNumber: integer("page_number"),
  timeStartMs: integer("time_start_ms"),
  timeEndMs: integer("time_end_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.sourceId, table.workspaceId], foreignColumns: [sources.id, sources.workspaceId], name: "source_chunks_source_workspace_fk" }).onDelete("cascade"),
  unique("source_chunks_source_ordinal_unique").on(table.sourceId, table.ordinal),
  unique("source_chunks_id_workspace_unique").on(table.id, table.workspaceId),
  check("source_chunks_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  index("source_chunks_workspace_source_idx").on(table.workspaceId, table.sourceId),
]);

export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  type: memoryTypeEnum("type").notNull(),
  status: memoryStatusEnum("status").notNull().default("active"),
  content: text("content").notNull(),
  summary: varchar("summary", { length: 1000 }),
  confidence: integer("confidence"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  supersedesMemoryId: uuid("supersedes_memory_id"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  unique("memories_id_workspace_unique").on(table.id, table.workspaceId),
  foreignKey({ columns: [table.supersedesMemoryId, table.workspaceId], foreignColumns: [table.id, table.workspaceId], name: "memories_supersedes_workspace_fk" }),
  check("memories_confidence_range", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 100)`),
  check("memories_validity_range", sql`${table.validUntil} IS NULL OR ${table.validFrom} IS NULL OR ${table.validUntil} >= ${table.validFrom}`),
  index("memories_workspace_status_created_idx").on(table.workspaceId, table.status, table.createdAt),
  index("memories_workspace_type_idx").on(table.workspaceId, table.type),
]);

export const memoryEvidence = pgTable("memory_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  memoryId: uuid("memory_id").notNull(),
  sourceChunkId: uuid("source_chunk_id").notNull(),
  evidenceType: varchar("evidence_type", { length: 40 }).notNull().default("supports"),
  quote: text("quote"),
  confidence: integer("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.memoryId, table.workspaceId], foreignColumns: [memories.id, memories.workspaceId], name: "memory_evidence_memory_workspace_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.sourceChunkId, table.workspaceId], foreignColumns: [sourceChunks.id, sourceChunks.workspaceId], name: "memory_evidence_chunk_workspace_fk" }).onDelete("cascade"),
  unique("memory_evidence_memory_chunk_type_unique").on(table.memoryId, table.sourceChunkId, table.evidenceType),
  check("memory_evidence_confidence_range", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 100)`),
  index("memory_evidence_workspace_memory_idx").on(table.workspaceId, table.memoryId),
]);

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: entityTypeEnum("type").notNull(),
  canonicalName: varchar("canonical_name", { length: 300 }).notNull(),
  description: text("description"),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  unique("entities_id_workspace_unique").on(table.id, table.workspaceId),
  uniqueIndex("entities_workspace_type_name_unique").on(table.workspaceId, table.type, sql`lower(${table.canonicalName})`),
  index("entities_workspace_type_idx").on(table.workspaceId, table.type),
]);

export const memoryEntities = pgTable("memory_entities", {
  workspaceId: uuid("workspace_id").notNull(),
  memoryId: uuid("memory_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  mention: varchar("mention", { length: 300 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.memoryId, table.entityId] }),
  foreignKey({ columns: [table.memoryId, table.workspaceId], foreignColumns: [memories.id, memories.workspaceId], name: "memory_entities_memory_workspace_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.entityId, table.workspaceId], foreignColumns: [entities.id, entities.workspaceId], name: "memory_entities_entity_workspace_fk" }).onDelete("cascade"),
  index("memory_entities_workspace_entity_idx").on(table.workspaceId, table.entityId),
]);

export const entityRelations = pgTable("entity_relations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  fromEntityId: uuid("from_entity_id").notNull(),
  toEntityId: uuid("to_entity_id").notNull(),
  type: relationTypeEnum("type").notNull(),
  label: varchar("label", { length: 160 }),
  properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
  confidence: integer("confidence"),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  foreignKey({ columns: [table.fromEntityId, table.workspaceId], foreignColumns: [entities.id, entities.workspaceId], name: "entity_relations_from_workspace_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.toEntityId, table.workspaceId], foreignColumns: [entities.id, entities.workspaceId], name: "entity_relations_to_workspace_fk" }).onDelete("cascade"),
  check("entity_relations_distinct_entities", sql`${table.fromEntityId} <> ${table.toEntityId}`),
  check("entity_relations_confidence_range", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 100)`),
  check("entity_relations_validity_range", sql`${table.validUntil} IS NULL OR ${table.validFrom} IS NULL OR ${table.validUntil} >= ${table.validFrom}`),
  index("entity_relations_workspace_from_idx").on(table.workspaceId, table.fromEntityId),
  index("entity_relations_workspace_to_idx").on(table.workspaceId, table.toEntityId),
]);

export const entityRelationEvidence = pgTable("entity_relation_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  relationId: uuid("relation_id").notNull(),
  sourceChunkId: uuid("source_chunk_id").notNull(),
  quote: text("quote"),
  confidence: integer("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.relationId, table.workspaceId], foreignColumns: [entityRelations.id, entityRelations.workspaceId], name: "entity_relation_evidence_relation_workspace_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.sourceChunkId, table.workspaceId], foreignColumns: [sourceChunks.id, sourceChunks.workspaceId], name: "entity_relation_evidence_chunk_workspace_fk" }).onDelete("cascade"),
  unique("entity_relation_evidence_relation_chunk_unique").on(table.relationId, table.sourceChunkId),
  check("entity_relation_evidence_confidence_range", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 100)`),
  index("entity_relation_evidence_workspace_relation_idx").on(table.workspaceId, table.relationId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  resourceType: varchar("resource_type", { length: 80 }).notNull(),
  resourceId: uuid("resource_id"),
  outcome: varchar("outcome", { length: 24 }).notNull().default("success"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 500 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("audit_logs_workspace_resource_idx").on(table.workspaceId, table.resourceType, table.resourceId),
]);
