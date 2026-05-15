import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { config } from "../../config";

export type SignedUpload = {
  storageKey: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export class ObjectStorage {
  private readonly client = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });

  private async withStorageTimeout<T>(
    operation: string,
    run: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.storage.requestTimeoutMs,
    );

    try {
      return await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `${operation} timed out after ${config.storage.requestTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async signedPutUrl(storageKey: string, contentType: string): Promise<SignedUpload> {
    const command = new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: config.storage.uploadUrlTtlSeconds,
    });
    const expiresAt = new Date(
      Date.now() + config.storage.uploadUrlTtlSeconds * 1000,
    ).toISOString();
    return {
      storageKey,
      uploadUrl,
      headers: { "content-type": contentType },
      expiresAt,
    };
  }

  async signedDownloadUrl(storageKey: string) {
    const command = new GetObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
    });
    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: config.storage.downloadUrlTtlSeconds,
    });
    return {
      downloadUrl,
      expiresAt: new Date(
        Date.now() + config.storage.downloadUrlTtlSeconds * 1000,
      ).toISOString(),
    };
  }

  async assertObject(storageKey: string, expectedSizeBytes?: number) {
    if (config.storage.skipObjectHeadValidation) return;
    const result = await this.withStorageTimeout("Storage object validation", (abortSignal) =>
      this.client.send(
        new HeadObjectCommand({
          Bucket: config.storage.bucket,
          Key: storageKey,
        }),
        { abortSignal },
      ),
    );
    if (
      expectedSizeBytes != null &&
      result.ContentLength != null &&
      result.ContentLength !== expectedSizeBytes
    ) {
      throw new Error(`Object size mismatch for ${storageKey}`);
    }
  }

  async downloadToFile(storageKey: string, destinationPath: string) {
    const result = await this.withStorageTimeout("Storage object download", (abortSignal) =>
      this.client.send(
        new GetObjectCommand({
          Bucket: config.storage.bucket,
          Key: storageKey,
        }),
        { abortSignal },
      ),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error(`Storage object body is not readable: ${storageKey}`);
    }
    await pipeline(result.Body, createWriteStream(destinationPath));
    const info = await stat(destinationPath);
    return { path: destinationPath, sizeBytes: info.size };
  }

  async putFile(input: {
    storageKey: string;
    filePath: string;
    contentType: string;
  }) {
    const info = await stat(input.filePath);
    await this.withStorageTimeout("Storage file upload", (abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: config.storage.bucket,
          Key: input.storageKey,
          Body: createReadStream(input.filePath),
          ContentType: input.contentType,
        }),
        { abortSignal },
      ),
    );
    return { storageKey: input.storageKey, sizeBytes: info.size };
  }

  async putJson(storageKey: string, payload: unknown) {
    const body = JSON.stringify(payload);
    await this.withStorageTimeout("Storage JSON upload", (abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: config.storage.bucket,
          Key: storageKey,
          Body: body,
          ContentType: "application/json",
        }),
        { abortSignal },
      ),
    );
    return { storageKey, sizeBytes: Buffer.byteLength(body, "utf8") };
  }

  async putText(storageKey: string, text: string, contentType = "text/plain") {
    await this.withStorageTimeout("Storage text upload", (abortSignal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: config.storage.bucket,
          Key: storageKey,
          Body: text,
          ContentType: contentType,
        }),
        { abortSignal },
      ),
    );
    return { storageKey, sizeBytes: Buffer.byteLength(text, "utf8") };
  }
}

export function videoStorageKey(takeId: string, deviceIndex: number, extension: string) {
  return `takes/${takeId}/original/device_${deviceIndex}.${extension}`;
}

export function metadataStorageKey(takeId: string, deviceIndex: number) {
  return `takes/${takeId}/metadata/device_${deviceIndex}.json`;
}

export function artifactStorageKey(
  takeId: string,
  jobId: string,
  artifactName: string,
) {
  return `takes/${takeId}/jobs/${jobId}/${artifactName}`;
}
