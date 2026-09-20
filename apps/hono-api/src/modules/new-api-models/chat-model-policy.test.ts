import { describe, expect, it } from "vitest";
import { assertChatModelAllowed, isChatCatalogModelAllowed } from "./chat-model-policy";

describe("chat model eligibility", () => {
  const excluded = "doubao-seed-2-0-lite-260428";
  it("rejects direct selections and catalog identities without model substitution", () => {
    expect(() => assertChatModelAllowed(excluded)).toThrow(/已从 AI 对话停用/);
    expect(() => assertChatModelAllowed("gpt-5.6-luna", excluded)).toThrow();
    expect(() => assertChatModelAllowed("gpt-5.6-luna")).not.toThrow();
    expect(isChatCatalogModelAllowed({ modelName: excluded, requestModelKey: "route-id", routingAliases: [] })).toBe(false);
    expect(isChatCatalogModelAllowed({ modelName: "route-id", requestModelKey: "route-id", routingAliases: [excluded] })).toBe(false);
  });
});
