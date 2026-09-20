import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../platform/redis-shared", () => ({ getSharedRedis: () => null }));
import { __clearAllAccumulatedClips, getClipAccumulatorDiagnostics, hydrateAccumulatedClips, loadAccumulatedClips, placeAccumulatedClipsAt } from "./video-orchestrator.clip-accumulator";
afterEach(() => { __clearAllAccumulatedClips(); vi.useRealTimers(); });
it("bounds hydration and indexed insertion across distinct runs", async () => {
  for (let i = 0; i < 350; i++) hydrateAccumulatedClips(`hydrate-${i}`, [{ text: "persisted" }]);
  expect(getClipAccumulatorDiagnostics().entryCount).toBe(300);
  for (let i = 0; i < 350; i++) await placeAccumulatedClipsAt(`place-${i}`, [{ clipIndex: 0, clip: { text: "new" } }]);
  expect(getClipAccumulatorDiagnostics().entryCount).toBe(300);
});
it("reclaims expired clips while idle and stops the empty cache timer", async () => {
  vi.useFakeTimers();
  hydrateAccumulatedClips("expired", [{ text: "retained" }]);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 60_000);
  expect(getClipAccumulatorDiagnostics()).toMatchObject({ entryCount: 0, sweepActive: false });
});
it("refreshes recently hydrated entries before capacity eviction", async () => {
  for (let i = 0; i < 300; i++) hydrateAccumulatedClips(String(i), [{ text: i }]);
  hydrateAccumulatedClips("0", [{ text: "updated" }]);
  hydrateAccumulatedClips("300", [{ text: "new" }]);
  expect(await loadAccumulatedClips("0")).toEqual([{ text: "updated" }]);
  expect(await loadAccumulatedClips("1")).toEqual([]);
});
