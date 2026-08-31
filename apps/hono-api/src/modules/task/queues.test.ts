import { describe, expect, it } from "vitest";

import {
  QUEUE_NAMES,
  assertValidQueueName,
  resolveQueueConnectionOptions,
} from "./queues";

describe("queue names", () => {
  it("never contain ':' (BullMQ v5 rejects colons in queue names)", () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(name).not.toContain(":");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("assertValidQueueName throws on a colon and passes a hyphenated name", () => {
    expect(() => assertValidQueueName("tapcanvas:bad")).toThrow(/':'/);
    expect(assertValidQueueName("tapcanvas-good")).toBe("tapcanvas-good");
  });
});

describe("resolveQueueConnectionOptions", () => {
  it("uses maxRetriesPerRequest:null (required by BullMQ; getSharedRedis's 2 is incompatible)", () => {
    const { url, options } = resolveQueueConnectionOptions("redis://example:6379");
    expect(url).toBe("redis://example:6379");
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it("falls back to REDIS_URL and throws when neither is set", () => {
    expect(() => resolveQueueConnectionOptions("")).toThrow(/REDIS_URL/);
  });
});
