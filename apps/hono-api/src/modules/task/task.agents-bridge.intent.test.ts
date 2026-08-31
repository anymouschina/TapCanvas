import { describe, expect, it } from "vitest";
import { normalizeChapterCanvasIntent } from "./task.agents-bridge";

describe("normalizeChapterCanvasIntent", () => {
  it("accepts generate_group_storyboard", () => {
    expect(normalizeChapterCanvasIntent("generate_group_storyboard")).toBe("generate_group_storyboard");
  });
  it("rejects unknown intents", () => {
    expect(normalizeChapterCanvasIntent("bogus")).toBeNull();
  });
  it("still accepts an existing intent", () => {
    expect(normalizeChapterCanvasIntent("generate_scene_references")).toBe("generate_scene_references");
  });
});
