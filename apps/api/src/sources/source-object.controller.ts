import {
  BadGatewayException, BadRequestException, ConflictException, Controller, Get,
  NotFoundException, Param, ParseUUIDPipe, Post, Body, UseGuards, Inject,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "../workspaces/workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "../workspaces/workspace-membership.guard.js";
import { S3ObjectStorageService, validateUploadRequest, getObjectUploadTtlSeconds } from "./object-storage.service.js";

const uploadBodySchema = z.object({
  contentType: z.string().trim().min(3).max(160),
  byteSize: z.number().int().min(1).max(100 * 1024 * 1024),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();

@Controller("workspaces/:workspaceId/sources/:sourceId/object")
@UseGuards(WorkspaceMembershipGuard)
export class SourceObjectController {
  constructor(@Inject(S3ObjectStorageService) private readonly storage: S3ObjectStorageService) {}

  @Post("upload-url")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async createUploadUrl(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const parsed = uploadBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: "Paramètres de téléversement invalides.", issues: parsed.error.issues });
    let input: ReturnType<typeof validateUploadRequest>;
    try { input = validateUploadRequest(parsed.data); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Paramètres invalides."); }

    // Verify tenant/source first. No DB transaction is held while creating the presigned URL.
    await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const source = await client.query("SELECT id FROM sources WHERE id = $1 AND workspace_id = $2 AND status <> 'archived' LIMIT 1", [sourceId, workspaceId]);
      if (!source.rows[0]) throw new NotFoundException("Source introuvable.");
    });
    const signed = await this.storage.createUploadUrl({ ...input, workspaceId, sourceId });
    const uploadTtl = getObjectUploadTtlSeconds();

    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const inserted = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO source_objects
          (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type, byte_size, checksum_sha256, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, now() + ($9 * interval '1 second'))
         ON CONFLICT (source_id) DO UPDATE SET
           storage_provider = EXCLUDED.storage_provider, bucket_name = EXCLUDED.bucket_name,
           object_key = EXCLUDED.object_key, status = 'pending', content_type = EXCLUDED.content_type,
           byte_size = EXCLUDED.byte_size, checksum_sha256 = EXCLUDED.checksum_sha256,
           expires_at = EXCLUDED.expires_at, verification_token = NULL, verification_lease_until = NULL,
           cleanup_lease_token = NULL, cleanup_lease_until = NULL, cleanup_last_error = NULL,
           etag = NULL, version_id = NULL, uploaded_at = NULL, verified_at = NULL, updated_at = now()
         WHERE source_objects.status IN ('failed', 'deleted') RETURNING id, expires_at`,
        [workspaceId, sourceId, signed.storageProvider, signed.bucketName, signed.objectKey, input.contentType, input.byteSize, input.checksumSha256, uploadTtl],
      );
      if (!inserted.rows[0]) throw new ConflictException("Un objet est déjà associé à cette source.");
      return { objectId: inserted.rows[0].id, uploadUrl: signed.url, expiresIn: signed.expiresIn, expiresAt: new Date(inserted.rows[0].expires_at).toISOString(), requiredHeaders: signed.requiredHeaders };
    });
  }

  @Post("complete")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async completeUpload(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    const token = randomUUID();
    const claim = await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const current = await client.query<{ id: string; status: string; expires_at: Date }>(
        "SELECT id, status, expires_at FROM source_objects WHERE source_id = $1 AND workspace_id = $2 LIMIT 1", [sourceId, workspaceId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException("Téléversement introuvable.");
      if (row.status === "verified") return { alreadyVerified: true as const, objectId: row.id };
      if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new ConflictException("Ce téléversement est expiré ou ne peut plus être finalisé.");
      }
      const result = await client.query<{
        id: string; bucket_name: string; object_key: string; content_type: string; byte_size: string; checksum_sha256: string;
      }>(
        `UPDATE source_objects SET verification_token = $3, verification_lease_until = now() + interval '2 minutes', updated_at = now()
         WHERE source_id = $1 AND workspace_id = $2 AND status = 'pending' AND expires_at > now()
           AND (verification_token IS NULL OR verification_lease_until <= now())
           AND cleanup_lease_token IS NULL
         RETURNING id, bucket_name, object_key, content_type, byte_size, checksum_sha256`,
        [sourceId, workspaceId, token],
      );
      if (!result.rows[0]) throw new ConflictException("Une finalisation ou un nettoyage est déjà en cours.");
      return { alreadyVerified: false as const, object: result.rows[0] };
    });
    if (claim.alreadyVerified) return { objectId: claim.objectId, status: "verified" };

    let verified: Awaited<ReturnType<S3ObjectStorageService["verifyUploadedObject"]>>;
    try {
      // The claim is committed before S3 HEAD; no PostgreSQL lock is held during network I/O.
      verified = await this.storage.verifyUploadedObject({
        bucketName: claim.object.bucket_name, objectKey: claim.object.object_key,
        expectedByteSize: Number(claim.object.byte_size), expectedContentType: claim.object.content_type,
        expectedChecksumSha256: claim.object.checksum_sha256,
      });
    } catch {
      await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
        await client.query("UPDATE source_objects SET verification_token = NULL, verification_lease_until = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2 AND verification_token = $3",
          [claim.object.id, workspaceId, token]);
      });
      throw new BadGatewayException("Le stockage n'a pas pu vérifier le fichier téléversé.");
    }

    const finalized = await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE source_objects SET status = 'verified', uploaded_at = now(), verified_at = now(),
           byte_size = $4, checksum_sha256 = $5, etag = $6, version_id = $7,
           verification_token = NULL, verification_lease_until = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND status = 'pending' AND verification_token = $3
           AND expires_at > now() AND verification_lease_until > now() AND cleanup_lease_token IS NULL
         RETURNING id`,
        [claim.object.id, workspaceId, token, verified.byteSize, verified.checksumSha256, verified.etag, verified.versionId],
      );
      return result.rows[0]?.id ?? null;
    });
    if (!finalized) {
      await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
        await client.query("UPDATE source_objects SET verification_token = NULL, verification_lease_until = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2 AND verification_token = $3",
          [claim.object.id, workspaceId, token]);
      });
      throw new ConflictException("Le délai du téléversement est dépassé ou sa finalisation a été reprise par un autre traitement.");
    }
    return { objectId: finalized, status: "verified" };
  }

  @Get("download-url")
  async createDownloadUrl(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    const object = await withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<{ bucket_name: string; object_key: string; content_type: string; status: string }>(
        "SELECT bucket_name, object_key, content_type, status FROM source_objects WHERE source_id = $1 AND workspace_id = $2 LIMIT 1", [sourceId, workspaceId],
      );
      const row = result.rows[0];
      if (!row || row.status !== "verified") throw new NotFoundException("Fichier vérifié introuvable.");
      return row;
    });
    try {
      return await this.storage.createDownloadUrl({ bucketName: object.bucket_name, objectKey: object.object_key, contentType: object.content_type });
    } catch { throw new BadGatewayException("Le stockage ne peut pas générer le lien de téléchargement."); }
  }
}
