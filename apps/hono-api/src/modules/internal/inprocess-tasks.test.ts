import { describe, expect, it } from "vitest";

import { buildInternalContext } from "./inprocess-tasks";
import type { WorkerEnv } from "../../types";

describe("buildInternalContext", () => {
  it("wraps a WorkerEnv into an AppContext with working get/set and a stub req.url", () => {
    const env = { DB: {}, INTERNAL_WORKER_TOKEN: "t" } as unknown as WorkerEnv;
    const c = buildInternalContext(env);
    expect(c.env).toBe(env);
    expect(typeof c.req.url).toBe("string");
    c.set("userId", "u1");
    expect(c.get("userId")).toBe("u1");
  });
});
