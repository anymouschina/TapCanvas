import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  putResponseToStorage,
  putFileToStorage,
  INLINE_UPLOAD_MAX_BYTES,
} from "./asset.hosting.stream-upload";

function webStreamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// A fake S3 client that records every PutObject: whether the Body was an
// in-heap buffer or a stream, the bytes it carried, and the ContentLength.
function makeRecordingClient() {
  const puts: Array<{ kind: "buffer" | "stream"; bytes: Buffer; contentLength: unknown; key: unknown }> = [];
  const client = {
    send: vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      const body = cmd.input.Body as unknown;
      if (body && typeof (body as { pipe?: unknown }).pipe === "function") {
        const chunks: Buffer[] = [];
        for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
        puts.push({
          kind: "stream",
          bytes: Buffer.concat(chunks),
          contentLength: cmd.input.ContentLength,
          key: cmd.input.Key,
        });
      } else {
        puts.push({
          kind: "buffer",
          bytes: Buffer.from(body as Uint8Array),
          contentLength: cmd.input.ContentLength,
          key: cmd.input.Key,
        });
      }
      return {};
    }),
  };
  return { client: client as unknown as Parameters<typeof putResponseToStorage>[0]["client"], puts };
}

describe("putResponseToStorage", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "stream-up-test-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("buffers a small, known-size asset (unchanged fast path for images)", async () => {
    const payload = new TextEncoder().encode("small-image-bytes");
    const { client, puts } = makeRecordingClient();
    const arrayBuffer = vi.fn(async () => payload.buffer.slice(0));
    const res = { body: webStreamFrom(payload), arrayBuffer } as unknown as Response;

    await putResponseToStorage({
      client,
      bucket: "b",
      key: "k-small",
      res,
      contentType: "image/webp",
      contentLength: payload.byteLength,
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.kind).toBe("buffer");
    expect(puts[0]!.bytes.equals(Buffer.from(payload))).toBe(true);
    expect(puts[0]!.contentLength).toBe(payload.byteLength);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("streams a large asset to disk and uploads a file stream — never calls arrayBuffer()", async () => {
    const payload = new Uint8Array(INLINE_UPLOAD_MAX_BYTES + 1024).fill(7);
    const { client, puts } = makeRecordingClient();
    const arrayBuffer = vi.fn(async () => {
      throw new Error("must not materialize a large asset in heap");
    });
    const res = { body: webStreamFrom(payload), arrayBuffer } as unknown as Response;

    await putResponseToStorage({
      client,
      bucket: "b",
      key: "k-large",
      res,
      contentType: "video/mp4",
      contentLength: payload.byteLength,
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.kind).toBe("stream");
    expect(puts[0]!.bytes.length).toBe(payload.byteLength);
    expect(puts[0]!.contentLength).toBe(payload.byteLength);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("streams when content-length is unknown (treated as potentially large)", async () => {
    const payload = new TextEncoder().encode("unknown-length-video");
    const { client, puts } = makeRecordingClient();
    const arrayBuffer = vi.fn(async () => {
      throw new Error("must not buffer unknown-size asset");
    });
    const res = { body: webStreamFrom(payload), arrayBuffer } as unknown as Response;

    await putResponseToStorage({
      client,
      bucket: "b",
      key: "k-unknown",
      res,
      contentType: "video/mp4",
      contentLength: null,
    });

    expect(puts[0]!.kind).toBe("stream");
    expect(puts[0]!.bytes.equals(Buffer.from(payload))).toBe(true);
    expect(puts[0]!.contentLength).toBe(payload.byteLength);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe("putFileToStorage", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "file-up-test-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uploads an on-disk file as a re-readable stream with exact ContentLength", async () => {
    const payload = Buffer.from("a-rendered-film-on-disk-that-must-not-be-readFile-into-heap");
    const filePath = join(tmp, "film.mp4");
    await writeFile(filePath, payload);
    const { client, puts } = makeRecordingClient();

    await putFileToStorage({
      client,
      bucket: "b",
      key: "gen/videos/film.mp4",
      filePath,
      contentType: "video/mp4",
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.kind).toBe("stream");
    expect(puts[0]!.bytes.equals(payload)).toBe(true);
    expect(puts[0]!.contentLength).toBe(payload.byteLength);
    expect(puts[0]!.key).toBe("gen/videos/film.mp4");
  });
});
