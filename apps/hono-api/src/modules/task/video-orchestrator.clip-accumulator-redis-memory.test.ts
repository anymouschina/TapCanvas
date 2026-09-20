import { afterEach, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ get: vi.fn(async () => JSON.stringify([{ text: "durable clip" }])), del: vi.fn(), set: vi.fn() }));
vi.mock("../../platform/redis-shared", () => ({ getSharedRedis: () => redis }));
import { __clearAllAccumulatedClips, getClipAccumulatorDiagnostics, loadAccumulatedClips } from "./video-orchestrator.clip-accumulator";
afterEach(() => { __clearAllAccumulatedClips(); vi.clearAllMocks(); });
it("bounds Redis read-through caching without deleting or changing durable clips", async () => {
  for (let i = 0; i < 350; i++) expect(await loadAccumulatedClips(`run-${i}`)).toEqual([{ text: "durable clip" }]);
  expect(getClipAccumulatorDiagnostics().entryCount).toBe(300);
  expect(await loadAccumulatedClips("run-0")).toEqual([{ text: "durable clip" }]);
  expect(redis.del).not.toHaveBeenCalled();
  expect(redis.set).not.toHaveBeenCalled();
});
