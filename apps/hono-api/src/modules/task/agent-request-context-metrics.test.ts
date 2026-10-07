import { describe, expect, it } from "vitest";
import { projectAgentRequestContextMetrics } from "./agent-request-context-metrics";
import { normalizeAgentsRuntimeTraceSummary } from "./task.agents-bridge";

const metrics = { version: 1, records: [{ sequence: 1, messageCount: 1, providerMessageChars: 30,
  systemChars: 2, totalMessageChars: 32, messages: [{ index: 0, role: "user", contentType: "string", contentChars: 2,
    toolCallCount: 0, toolCallParameterChars: 0, reasoningContentType: "absent", reasoningContentChars: 0,
    providerResponseItemCount: 0, providerResponseItemSerializedChars: 0, serializedChars: 30 }] }] };

describe("request context metric transport", () => {
  it("preserves numeric measurements across the runtime bridge and strips raw fields", () => {
    const input = structuredClone(metrics);
    Object.assign(input.records[0]!.messages[0]!, { content: "private", reasoningContent: "private", toolArguments: "private" });
    const result = normalizeAgentsRuntimeTraceSummary({ profile: "code", upstreamRequestContextMetrics: input });
    expect(result?.upstreamRequestContextMetrics).toEqual(metrics);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("records a non-terminal diagnostic for invalid metrics and distinguishes absence", () => {
    expect(projectAgentRequestContextMetrics(undefined)).toEqual({});
    expect(projectAgentRequestContextMetrics({ ...metrics, version: 2 })).toEqual({ issue: "invalid_request_context_metrics" });
    const result = normalizeAgentsRuntimeTraceSummary({ profile: "code", upstreamRequestContextMetrics: { version: 1, records: [{ content: "secret" }] } });
    expect(result?.upstreamRequestContextMetrics).toBeUndefined();
    expect(result?.upstreamRequestContextMetricsIssue).toBe("invalid_request_context_metrics");
    expect(normalizeAgentsRuntimeTraceSummary({ profile: "code" })?.upstreamRequestContextMetricsIssue).toBeUndefined();
    expect(normalizeAgentsRuntimeTraceSummary({ profile: "code", upstreamRequestContextMetricsIssue: "invalid_request_context_metrics" })?.upstreamRequestContextMetricsIssue)
      .toBe("invalid_request_context_metrics");
  });
});
