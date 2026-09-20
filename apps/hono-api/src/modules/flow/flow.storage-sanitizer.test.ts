import { describe, expect, it } from "vitest";
import { sanitizeFlowDataForStorage } from "./flow.storage-sanitizer";

describe("canvas storage shared reference preservation", () => {
  it("preserves reused arrays and objects across nodes and the submission manifest", () => {
    const purposes = ["character"];
    const image = { url: "https://example.com/image.png", purposes };
    const input = { nodes: [{ data: { purposes, image } }, { data: { image, manifest: { images: [image] } } }] };
    const result = sanitizeFlowDataForStorage(input);
    expect(result).toEqual(JSON.parse(JSON.stringify(input)));
    expect(input.nodes[0]?.data.image).toBe(image);
  });

  it("removes only an ancestor back-edge and preserves the same object at another path", () => {
    const shared: Record<string, unknown> = { label: "card" };
    shared.self = shared;
    expect(sanitizeFlowDataForStorage({ first: shared, second: shared })).toEqual({ first: { label: "card" }, second: { label: "card" } });
  });

  it("continues excluding transient URLs without deleting valid repeated assets", () => {
    const image = { url: "https://example.com/real.png", preview: "blob:temporary" };
    expect(sanitizeFlowDataForStorage([image, image, "data:image/png;base64,abc"])).toEqual([{ url: image.url }, { url: image.url }]);
  });
});
