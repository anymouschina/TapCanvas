import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mp4NeedsFaststart } from "./asset.video-faststart";

// Build a minimal top-level MP4 atom sequence: each entry is [type, payloadSize].
function buildAtoms(atoms: Array<[string, number]>): Buffer {
  const parts: Buffer[] = [];
  for (const [type, payloadSize] of atoms) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payloadSize, 0);
    head.write(type, 4, "latin1");
    parts.push(head, Buffer.alloc(payloadSize));
  }
  return Buffer.concat(parts);
}

describe("mp4NeedsFaststart", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "faststart-test-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writeMp4(atoms: Array<[string, number]>): Promise<string> {
    const file = join(tmp, "clip.mp4");
    await writeFile(file, buildAtoms(atoms));
    return file;
  }

  it("returns true when moov comes after mdat (seedance-style tail moov)", async () => {
    // Mirrors the real seedance layout: ftyp → uuid → free → mdat → moov.
    const file = await writeMp4([
      ["ftyp", 24],
      ["uuid", 128],
      ["free", 0],
      ["mdat", 4096],
      ["moov", 512],
    ]);
    await expect(mp4NeedsFaststart(file)).resolves.toBe(true);
  });

  it("returns false when moov precedes mdat (already faststart)", async () => {
    const file = await writeMp4([
      ["ftyp", 24],
      ["moov", 512],
      ["mdat", 4096],
    ]);
    await expect(mp4NeedsFaststart(file)).resolves.toBe(false);
  });

  it("returns false for non-mp4 bytes (no parseable atoms)", async () => {
    const file = join(tmp, "not-a-video.bin");
    await writeFile(file, Buffer.from("this is not an mp4 file at all"));
    await expect(mp4NeedsFaststart(file)).resolves.toBe(false);
  });

  it("returns false when mdat is present but moov never appears (truncated file)", async () => {
    const file = await writeMp4([
      ["ftyp", 24],
      ["mdat", 4096],
    ]);
    // No moov at all → remuxing can't help; treat as not-needed and let upload proceed.
    await expect(mp4NeedsFaststart(file)).resolves.toBe(false);
  });
});
