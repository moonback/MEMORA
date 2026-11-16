import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_SOURCE_OBJECT_BYTES = 100 * 1024 * 1024;
export const PRESIGNED_URL_TTL_SECONDS = 300;

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  provider: string;
}

export interface UploadRequest {
  contentType: string;
  byteSize: number;
  checksumSha256: string;
}

export function checksumHexToBase64(checksum: string): string {
  return Buffer.from(checksum, "hex").toString("base64");
}

export function validateUploadRequest(input: unknown): UploadRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Paramètres de téléversement invalides.");
  }
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.some((key) => !["contentType", "byteSize", "checksumSha256"].includes(key))) {
    throw new Error("Paramètres de téléversement invalides.");
  }
  if (typeof value.contentType !== "string" || value.contentType.length > 160 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*(?:\s*;\s*[a-zA-Z0-9=._-]+)*$/.test(value.contentType)) {
    throw new Error("Type MIME invalide.");
  }
  if (typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) ||
      value.byteSize < 1 || value.byteSize > MAX_SOURCE_OBJECT_BYTES) {
    throw new Error("La taille du fichier doit être comprise entre 1 octet et 100 MiB.");
  }
  if (typeof value.checksumSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.checksumSha256)) {
    throw new Error("Un checksum SHA-256 valide est requis.");
  }
  return {
    contentType: value.contentType,
    byteSize: value.byteSize,
    checksumSha256: value.checksumSha256.toLowerCase(),
  };
}

@Injectable()
export class S3ObjectStorageService {
  private client?: S3Client;
  private config?: ObjectStorageConfig;

  private getConfiguration(): { client: S3Client; config: ObjectStorageConfig } {
    if (this.client && this.config) return { client: this.client, config: this.config };
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
    const region = process.env.OBJECT_STORAGE_REGION ?? "eu-west-1";
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    const bucket = process.env.OBJECT_STORAGE_BUCKET;
    const provider = process.env.OBJECT_STORAGE_PROVIDER ?? "s3-compatible";
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new ServiceUnavailableException("Le stockage objet privé n'est pas configuré.");
    }
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint);
    } catch {
      throw new ServiceUnavailableException("L'endpoint du stockage objet est invalide.");
    }
    if (parsedEndpoint.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && parsedEndpoint.hostname === "localhost")) {
      throw new ServiceUnavailableException("Le stockage objet doit utiliser HTTPS.");
    }
    this.config = { endpoint: parsedEndpoint.toString(), region, accessKeyId, secretAccessKey, bucket, provider };
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    return { client: this.client, config: this.config };
  }

  async createUploadUrl(input: UploadRequest & { workspaceId: string; sourceId: string }) {
    const { client, config } = this.getConfiguration();
    const objectKey = `${input.workspaceId}/${input.sourceId}/${randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
      ChecksumSHA256: checksumHexToBase64(input.checksumSha256),
    });
    const url = await getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
    return {
      storageProvider: config.provider,
      bucketName: config.bucket,
      objectKey,
      url,
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
      requiredHeaders: {
        "content-type": input.contentType,
        "x-amz-checksum-sha256": checksumHexToBase64(input.checksumSha256),
      },
    };
  }

  async verifyUploadedObject(input: {
    bucketName: string;
    objectKey: string;
    expectedByteSize: number;
    expectedContentType: string;
    expectedChecksumSha256: string;
  }) {
    const { client } = this.getConfiguration();
    const result = await client.send(new HeadObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      ChecksumMode: "ENABLED",
    }));
    if (result.ContentLength !== input.expectedByteSize ||
        result.ContentType !== input.expectedContentType ||
        result.ChecksumSHA256 !== checksumHexToBase64(input.expectedChecksumSha256)) {
      throw new Error("Les métadonnées du fichier téléversé ne correspondent pas à la demande initiale.");
    }
    return {
      byteSize: result.ContentLength,
      contentType: result.ContentType,
      checksumSha256: input.expectedChecksumSha256.toLowerCase(),
      etag: result.ETag ?? null,
      versionId: result.VersionId ?? null,
    };
  }

  async createDownloadUrl(input: { bucketName: string; objectKey: string; contentType: string }) {
    const { client } = this.getConfiguration();
    const command = new GetObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      ResponseContentType: input.contentType,
    });
    return {
      url: await getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS }),
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    };
  }
}
