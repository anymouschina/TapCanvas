import { createHash } from "node:crypto";

export function requireVisionImageData(value: string): string {
  if (!/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Vision imageData must be a non-empty base64 image data URI");
  }
  return value;
}

/** Hash the exact bytes supplied to vision, independent of URL or filename. */
export async function readImageUnderstandingContent(url: string): Promise<{ contentHash: string; imageData: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`Image fingerprint download failed: HTTP ${response.status}`);
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!mime || !/^image\/[a-z0-9.+-]+$/.test(mime)) {
    await response.body.cancel();
    throw new Error("Image fingerprint requires an image Content-Type");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 32 * 1024 * 1024) throw new Error("Image fingerprint input exceeds 32 MiB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!length) throw new Error("Image fingerprint input is empty");
  const bytes = Buffer.concat(chunks);
  return {
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    imageData: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}
