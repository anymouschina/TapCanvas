import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

/**
 * Assets at or below this known size keep the simple buffered PutObject — the
 * heap cost is negligible (a few MB) and a Uint8Array Body is retry-safe. Above
 * it, or when the size is unknown, we stream through a temp file so a multi-MB
 * to multi-hundred-MB video is NEVER fully materialized in the JS heap (off-heap
 * `arrayBuffers`), which is the dominant peak-OOM lever on the api container.
 */
export const INLINE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Upload an (unconsumed) fetch Response body to object storage without holding
 * the whole asset in the JS heap. Small known-size assets are buffered (fast
 * path, unchanged for images); large or unknown-size assets are streamed to a
 * temp file and uploaded via a re-readable file stream with an exact
 * ContentLength — same single-PutObject API, flat memory regardless of size.
 */
export async function putResponseToStorage(input: {
  client: S3Client;
  bucket: string;
  key: string;
  res: Response;
  contentType: string;
  contentLength: number | null;
  cacheControl?: string;
  /**
   * Runs after the body has landed on the temp file, BEFORE the upload — for in-place transforms
   * whose output must be what actually gets stored (e.g. mp4 faststart remux). Setting this forces
   * the temp-file path even for small assets. Must not throw for non-fatal work (wrap it); the
   * upload uses the file's post-callback bytes and size.
   */
  beforeTempFileUpload?: (tmpFile: string) => Promise<void>;
  /**
   * Runs after a successful upload, while the asset still exists as a local temp file — e.g. video
   * poster extraction that would otherwise have to re-download the bytes. Setting this forces the
   * temp-file path even for small assets. The callback must not throw for non-fatal work (wrap it);
   * the temp dir is removed as soon as it returns.
   */
  afterTempFileUpload?: (tmpFile: string) => Promise<void>;
}): Promise<void> {
  const { client, bucket, key, res, contentType, contentLength } = input;
  const cacheControl = input.cacheControl ?? DEFAULT_CACHE_CONTROL;

  const knownSmall =
    typeof contentLength === "number" &&
    contentLength >= 0 &&
    contentLength <= INLINE_UPLOAD_MAX_BYTES &&
    !input.afterTempFileUpload &&
    !input.beforeTempFileUpload;

  if (knownSmall) {
    const buf = new Uint8Array(await res.arrayBuffer());
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
        CacheControl: cacheControl,
        ContentLength: buf.byteLength,
      }),
    );
    return;
  }

  if (!res.body) {
    throw new Error("upstream response has no body to stream to storage");
  }

  const dir = await mkdtemp(join(tmpdir(), "asset-up-"));
  const tmpFile = join(dir, "asset.bin");
  try {
    await streamPipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(tmpFile),
    );
    if (input.beforeTempFileUpload) {
      await input.beforeTempFileUpload(tmpFile);
    }
    await putFileToStorage({
      client,
      bucket,
      key,
      filePath: tmpFile,
      contentType,
      cacheControl,
    });
    if (input.afterTempFileUpload) {
      await input.afterTempFileUpload(tmpFile);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Upload an on-disk file to object storage via a re-readable file stream with an
 * exact ContentLength — for ffmpeg outputs (concat film, segments, transcode
 * proxy, etc.) that are already written to a temp file. Replaces the
 * `readFile(outFile) -> Body: buffer` pattern that loaded the whole (often
 * 100s-of-MB) output into the JS heap before the PutObject.
 */
export async function putFileToStorage(input: {
  client: S3Client;
  bucket: string;
  key: string;
  filePath: string;
  contentType: string;
  cacheControl?: string;
}): Promise<void> {
  const size = (await stat(input.filePath)).size;
  await input.client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? DEFAULT_CACHE_CONTROL,
      ContentLength: size,
    }),
  );
}
