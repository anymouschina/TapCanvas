import { describe, expect, it } from "vitest";

import {
  resolvePositiveIntEnv,
  CONCURRENCY_DEFAULTS,
} from "./concurrency-limits";

describe("resolvePositiveIntEnv", () => {
  it("returns the finite fallback when the env var is unset (no fail-open 999999)", () => {
    expect(resolvePositiveIntEnv(undefined, 4)).toBe(4);
    expect(resolvePositiveIntEnv(null, 4)).toBe(4);
    expect(resolvePositiveIntEnv("", 4)).toBe(4);
  });

  it("returns the parsed value when set to a valid positive integer", () => {
    expect(resolvePositiveIntEnv("8", 4)).toBe(8);
    expect(resolvePositiveIntEnv("  10  ", 4)).toBe(10);
    expect(resolvePositiveIntEnv("16.9", 4)).toBe(16);
  });

  it("falls back on non-numeric / non-positive values", () => {
    expect(resolvePositiveIntEnv("abc", 4)).toBe(4);
    expect(resolvePositiveIntEnv("-3", 4)).toBe(4);
    expect(resolvePositiveIntEnv("0", 4)).toBe(4);
  });

  it("accepts 0 only when allowZero is set (for queue depth)", () => {
    expect(resolvePositiveIntEnv("0", 256, { allowZero: true })).toBe(0);
    expect(resolvePositiveIntEnv("-1", 256, { allowZero: true })).toBe(256);
  });

  it("exposes finite (non-999999) defaults for every heavy-op limit", () => {
    const keys = [
      "imageGlobal",
      "bridgeMaxConcurrency",
      "bridgeMaxQueueDepth",
      "bridgeMaxPerUser",
    ] as const;
    for (const k of keys) {
      const v = CONCURRENCY_DEFAULTS[k];
      expect(v, k).toBeGreaterThan(0);
      expect(v, k).toBeLessThan(1000);
    }
  });
});
