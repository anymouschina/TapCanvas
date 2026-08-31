import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import type { ObjectStorageConfig } from "./rustfs.client";

/**
 * Download a media asset to `dest` WITHOUT ever materializing it whole in the JS
 * heap. If the URL points at our own object storage, pull it via the S3 API
 * (GetObject) — in some egress-restricted environments the CDN domain is
 * throttled while the S3 endpoint is reachable — otherwise stream the fetch()
 * body. In both branches the bytes go socket/S3 -> disk via a stream pipeline,
 * never through an `arrayBuffer()` / `transformToByteArray()` heap buffer.
 *
 * This is the single canonical implementation of the pattern that previously
 * lived (correctly) only in video-concat.ts and was duplicated as four
 * buffer-into-heap copies across the task tool bridge.
 */
export async function streamDownloadToFile(
  url: string,
  dest: string,
  storage: ObjectStorageConfig,
  s3: S3Client,
): Promise<void> {
  const publicBase = storage.publicBase.trim().replace(/\/+$/, "");
  if (publicBase && url.startsWith(`${publicBase}/`)) {
    const key = url.slice(publicBase.length + 1).split(/[?#]/)[0];
    const out = await s3.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
    );
    await streamPipeline(
      (out.Body as { transformToWebStream(): ReadableStream }).transformToWebStream(),
      createWriteStream(dest),
    );
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed (${res.status}) for ${url}`);
  }
  if (!res.body) {
    throw new Error(`download returned an empty body for ${url}`);
  }
  await streamPipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
}
