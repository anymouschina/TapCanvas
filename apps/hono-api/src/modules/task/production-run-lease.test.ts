import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({ $queryRaw: queryRawMock }),
}));

import {
  acquireProductionRunLease,
  releaseProductionRunLease,
  renewProductionRunLease,
} from "./production-run-lease";

describe("PostgreSQL production run lease", () => {
  beforeEach(() => queryRawMock.mockReset());

  it("uses the generated ownership token returned by the atomic upsert", async () => {
    queryRawMock.mockImplementationOnce(async (query: { values: readonly unknown[] }) => {
      const generatedToken = query.values.find((value) => (
        typeof value === "string" && value !== "authoring:run-1"
      ));
      return [{ token: generatedToken }];
    });

    await expect(acquireProductionRunLease("authoring:run-1")).resolves.toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("returns null when another unexpired holder wins the lease", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    await expect(acquireProductionRunLease("run-2")).resolves.toBeNull();
  });

  it("renews and releases only when PostgreSQL returns the exact token", async () => {
    queryRawMock
      .mockResolvedValueOnce([{ token: "token-1" }])
      .mockResolvedValueOnce([]);
    await expect(renewProductionRunLease("run-3", "token-1")).resolves.toBe(true);
    await expect(releaseProductionRunLease("run-3", "token-1")).resolves.toBe(false);
  });

  it("rejects malformed lease identities without querying PostgreSQL", async () => {
    await expect(acquireProductionRunLease(" ")).rejects.toThrow("leaseKey");
    await expect(renewProductionRunLease("run-4", " ")).rejects.toThrow("token");
    await expect(releaseProductionRunLease(" ", "token-4")).rejects.toThrow("leaseKey");
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
