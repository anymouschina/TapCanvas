import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { streamDownloadToFile } from "./stream-download";
import type { ObjectStorageConfig } from "./rustfs.client";
import type { S3Client } from "@aws-sdk/client-s3";

const STORAGE = {
  bucket: "test-bucket",
  publicBase: "https://cdn.test",
} as unknown as ObjectStorageConfig;

function webStreamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("streamDownloadToFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "stream-dl-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("streams a fetched body to disk without ever materializing it whole via arrayBuffer()", async () => {
    const payload = new TextEncoder().encode("hello-streamed-video-bytes");
    const arrayBufferSpy = vi.fn(async () => {
      throw new Error("must not materialize the whole asset via arrayBuffer()");
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: webStreamFrom(payload),
      arrayBuffer: arrayBufferSpy,
    }) as unknown as typeof fetch;

    const dest = join(dir, "out.bin");
    await streamDownloadToFile(
      "https://example.invalid/clip.mp4",
      dest,
      STORAGE,
      {} as S3Client,
    );

    expect(new Uint8Array(await readFile(dest))).toEqual(payload);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("streams an own-storage object via the GetObject web stream, not transformToByteArray", async () => {
    const payload = new TextEncoder().encode("s3-streamed-bytes");
    const transformToByteArray = vi.fn(async () => {
      throw new Error("must not buffer the S3 body into heap");
    });
    const s3 = {
      send: vi.fn().mockResolvedValue({
        Body: {
          transformToWebStream: () => webStreamFrom(payload),
          transformToByteArray,
        },
      }),
    } as unknown as S3Client;

    const dest = join(dir, "out2.bin");
    await streamDownloadToFile("https://cdn.test/gen/clip.mp4", dest, STORAGE, s3);

    expect(new Uint8Array(await readFile(dest))).toEqual(payload);
    expect(transformToByteArray).not.toHaveBeenCalled();
    expect(s3.send as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error on a non-200 fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }) as unknown as typeof fetch;
    await expect(
      streamDownloadToFile(
        "https://example.invalid/clip.mp4",
        join(dir, "x.bin"),
        STORAGE,
        {} as S3Client,
      ),
    ).rejects.toThrow(/download failed \(503\)/);
  });
});
