import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "../workspaces/workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "../workspaces/workspace-membership.guard.js";
import {
  S3ObjectStorageService,
  validateUploadRequest,
} from "./object-storage.service.js";

const uploadBodySchema = z.object({
  contentType: z.string().trim().min(3).max(160),
  byteSize: z.number().int().min(1).max(100 * 1024 * 1024),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();

@Controller("workspaces/:workspaceId/sources/:sourceId/object")
@UseGuards(WorkspaceMembershipGuard)
export class SourceObjectController {
  constructor(private readonly storage: S3ObjectStorageService) {}

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
    try {
      input = validateUploadRequest(parsed.data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Paramètres invalides.");
    }

    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const source = await client.query<{ id: string }>(
        "SELECT id FROM sources WHERE id = $1 AND workspace_id = $2 AND status <> 'archived' LIMIT 1",
        [sourceId, workspaceId],
      );
      if (!source.rows[0]) throw new NotFoundException("Source introuvable.");
      const signed = await this.storage.createUploadUrl({ ...input, workspaceId, sourceId });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO source_objects
          (workspace_id, source_id, storage_provider, bucket_name, object_key, status,
           content_type, byte_size, checksum_sha256)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
         ON CONFLICT (source_id) DO UPDATE SET
           storage_provider = EXCLUDED.storage_provider,
           bucket_name = EXCLUDED.bucket_name,
           object_key = EXCLUDED.object_key,
           status = 'pending',
           content_type = EXCLUDED.content_type,
           byte_size = EXCLUDED.byte_size,
           checksum_sha256 = EXCLUDED.checksum_sha256,
           etag = NULL, version_id = NULL, uploaded_at = NULL, verified_at = NULL,
           updated_at = now()
         WHERE source_objects.status IN ('failed', 'deleted')
         RETURNING id`,
        [workspaceId, sourceId, signed.storageProvider, signed.bucketName, signed.objectKey,
          input.contentType, input.byteSize, input.checksumSha256],
      );
      if (!inserted.rows[0]) throw new ConflictException("Un objet est déjà associé à cette source.");
      return {
        objectId: inserted.rows[0].id,
        uploadUrl: signed.url,
        expiresIn: signed.expiresIn,
        requiredHeaders: signed.requiredHeaders,
      };
    });
  }

  @Post("complete")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async completeUpload(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<{
        id: string; bucket_name: string; object_key: string; content_type: string;
        byte_size: string; checksum_sha256: string; status: string;
      }>(
        `SELECT id, bucket_name, object_key, content_type, byte_size, checksum_sha256, status
         FROM source_objects WHERE source_id = $1 AND workspace_id = $2 FOR UPDATE`,
        [sourceId, workspaceId],
      );
      const object = result.rows[0];
      if (!object) throw new NotFoundException("Téléversement introuvable.");
      if (object.status === "verified") return { objectId: object.id, status: "verified" };
      if (object.status !== "pending" || !object.byte_size || !object.checksum_sha256) {
        throw new ConflictException("Cet objet ne peut pas être finalisé.");
      }
      try {
        const verified = await this.storage.verifyUploadedObject({
          bucketName: object.bucket_name,
          objectKey: object.object_key,
          expectedByteSize: Number(object.byte_size),
          expectedContentType: object.content_type,
          expectedChecksumSha256: object.checksum_sha256,
        });
        await client.query(
          `UPDATE source_objects SET status = 'verified', uploaded_at = now(), verified_at = now(),
             byte_size = $3, checksum_sha256 = $4, etag = $5, version_id = $6, updated_at = now()
           WHERE id = $1 AND workspace_id = $2`,
          [object.id, workspaceId, verified.byteSize, verified.checksumSha256, verified.etag, verified.versionId],
        );
        return { objectId: object.id, status: "verified" };
      } catch {
        throw new BadGatewayException("Le stockage n'a pas pu vérifier le fichier téléversé.");
      }
    });
  }

  @Get("download-url")
  async createDownloadUrl(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client) => {
      const result = await client.query<{
        bucket_name: string; object_key: string; content_type: string; status: string;
      }>(
        `SELECT bucket_name, object_key, content_type, status
         FROM source_objects WHERE source_id = $1 AND workspace_id = $2 LIMIT 1`,
        [sourceId, workspaceId],
      );
      const object = result.rows[0];
      if (!object || object.status !== "verified") throw new NotFoundException("Fichier vérifié introuvable.");
      try {
        return await this.storage.createDownloadUrl({
          bucketName: object.bucket_name,
          objectKey: object.object_key,
          contentType: object.content_type,
        });
      } catch {
        throw new BadGatewayException("Le stockage ne peut pas générer le lien de téléchargement.");
      }
    });
  }
}
