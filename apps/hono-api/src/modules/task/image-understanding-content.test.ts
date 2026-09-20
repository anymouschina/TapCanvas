import { afterEach, describe, expect, it, vi } from "vitest";
import { readImageUnderstandingContent, requireVisionImageData } from "./image-understanding-content";

afterEach(() => { vi.unstubAllGlobals(); });
describe("image content identity", () => {
  it("matches identical bytes at different URLs and detects changed bytes at the same URL", async () => {
    const fetchImage = vi.fn()
      .mockResolvedValueOnce(new Response("same bytes", { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response("same bytes", { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response("changed bytes", { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchImage);
    const first = await readImageUnderstandingContent("https://a.test/1.png");
    const moved = await readImageUnderstandingContent("https://b.test/2.png");
    const changed = await readImageUnderstandingContent("https://a.test/1.png");
    expect(moved.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(requireVisionImageData(first.imageData)).toBe(first.imageData);
    expect(Buffer.from(first.imageData.split(",")[1], "base64").toString()).toBe("same bytes");
  });
  it("reports failed downloads without fabricating an identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    await expect(readImageUnderstandingContent("https://a.test/missing.png")).rejects.toThrow("HTTP 404");
    expect(() => requireVisionImageData("https://a.test/1.png")).toThrow();
  });
});
