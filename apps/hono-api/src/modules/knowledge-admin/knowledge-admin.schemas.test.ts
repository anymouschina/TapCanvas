import { describe, expect, it } from "vitest";

import {
  KnowledgeAdminCardInputSchema,
  KnowledgeAdminCardSchema,
  KnowledgeAdminListQuerySchema,
} from "./knowledge-admin.schemas";

const longTitle = "长标题".repeat(171);

const cardFields = {
  id: "long-title-card",
  domain: "知识工程",
  facet: null,
  title: longTitle,
  roleScope: ["generation" as const],
  keywords: ["长标题"],
  sourceUrls: ["internal://knowledge/long-title-card"],
  body: "正文。",
};

describe("knowledge admin card schemas", () => {
  it("accepts persisted cards whose titles exceed the admin input limit", () => {
    const parsed = KnowledgeAdminCardSchema.parse({
      ...cardFields,
      path: "/runtime/bootstrap/apps/agents-cli/knowledge/long-title-card.md",
      sourceRoot: "/runtime/bootstrap/apps/agents-cli/knowledge",
      sourceKind: "filesystem",
      contentSha256: "a".repeat(64),
      embeddingModel: "text-embedding-v4",
      updatedAt: "2026-08-05T00:00:00.000Z",
      collectionId: "builtin",
      collectionLabel: "内置知识",
      editable: true,
    });

    expect(parsed.title).toBe(longTitle);
  });

  it("allows editing a long existing title while retaining a bounded input contract", () => {
    const parsed = KnowledgeAdminCardInputSchema.parse(cardFields);

    expect(parsed.title).toBe(longTitle);
    expect(() => KnowledgeAdminCardInputSchema.parse({
      ...cardFields,
      title: "x".repeat(2_001),
    })).toThrow();
  });

  it("parses bounded pagination and knowledge filters", () => {
    expect(KnowledgeAdminListQuerySchema.parse({
      collection: "prompt-video",
      page: "2",
      pageSize: "50",
      query: "追逐",
      roleScope: "director",
    })).toEqual({
      collection: "prompt-video",
      page: 2,
      pageSize: 50,
      query: "追逐",
      roleScope: "director",
    });
    expect(() => KnowledgeAdminListQuerySchema.parse({ pageSize: "101" })).toThrow();
  });
});
