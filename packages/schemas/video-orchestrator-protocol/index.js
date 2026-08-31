var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  VIDEO_AUTHORING_EXECUTION_SCOPES: () => VIDEO_AUTHORING_EXECUTION_SCOPES,
  VIDEO_AUTHORING_GRAPH_NODE_KINDS: () => VIDEO_AUTHORING_GRAPH_NODE_KINDS,
  VIDEO_AUTHORING_GRAPH_NODE_STATES: () => VIDEO_AUTHORING_GRAPH_NODE_STATES,
  VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION: () => VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
  VIDEO_AUTHORING_STATES: () => VIDEO_AUTHORING_STATES,
  VIDEO_AUTHORING_TERMINAL_STATES: () => VIDEO_AUTHORING_TERMINAL_STATES,
  VIDEO_ORCHESTRATOR_PROTOCOL_VERSION: () => VIDEO_ORCHESTRATOR_PROTOCOL_VERSION,
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION: () => VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS: () => VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS,
  VIDEO_PRODUCTION_WORKFLOW_KEY: () => VIDEO_PRODUCTION_WORKFLOW_KEY,
  VIDEO_PRODUCTION_WORKFLOW_NODE_IDS: () => VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
  VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES: () => VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES,
  VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION: () => VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
  VIDEO_RUN_STATES: () => VIDEO_RUN_STATES,
  VIDEO_RUN_STATUS_PROJECTION_OWNER: () => VIDEO_RUN_STATUS_PROJECTION_OWNER,
  VIDEO_RUN_STATUS_PROTOCOL_VERSION: () => VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  VIDEO_RUN_TERMINAL_STATES: () => VIDEO_RUN_TERMINAL_STATES,
  isTerminalVideoAuthoringState: () => isTerminalVideoAuthoringState,
  isTerminalVideoRunState: () => isTerminalVideoRunState,
  parseVideoProductionWorkflowEvent: () => parseVideoProductionWorkflowEvent,
  parseVideoProductionWorkflowNodeProjection: () => parseVideoProductionWorkflowNodeProjection,
  parseVideoProductionWorkflowSnapshot: () => parseVideoProductionWorkflowSnapshot,
  parseVideoRunStatusEvent: () => parseVideoRunStatusEvent,
  parseVideoRunStatusSnapshot: () => parseVideoRunStatusSnapshot
});
module.exports = __toCommonJS(index_exports);
const VIDEO_ORCHESTRATOR_PROTOCOL_VERSION = "1";
const VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION = "2";
const VIDEO_RUN_STATUS_PROTOCOL_VERSION = "2";
const VIDEO_RUN_STATUS_PROJECTION_OWNER = "video_run_status";
const VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION = "1";
const VIDEO_PRODUCTION_WORKFLOW_KEY = "one-click-production/v1";
const VIDEO_PRODUCTION_WORKFLOW_NODE_IDS = [
  "production-contract",
  "story-adaptation",
  "clip-contracts",
  "asset-preparation",
  "media-production",
  "composition",
  "delivery"
];
const VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES = [
  "queued",
  "running",
  "waiting_external",
  "succeeded",
  "partial",
  "failed",
  "cancelled"
];
const VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS = [
  "agent_turn",
  "tool_call",
  "effect",
  "artifact",
  "diagnostic",
  "status"
];
const VIDEO_PRODUCTION_WORKFLOW_DEFINITION = {
  protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
  workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
  definitionVersion: 1,
  nodes: [
    { nodeId: "production-contract", label: "\u4EFB\u52A1\u5408\u540C", kind: "contract", inputPorts: ["request"], outputPorts: ["delivery-contract"] },
    { nodeId: "story-adaptation", label: "\u5267\u672C\u6539\u7F16", kind: "authoring", inputPorts: ["delivery-contract"], outputPorts: ["beat-sheet"] },
    { nodeId: "clip-contracts", label: "Clip \u5408\u540C", kind: "authoring", inputPorts: ["beat-sheet"], outputPorts: ["clip-contracts"] },
    { nodeId: "asset-preparation", label: "\u8D44\u4EA7\u51C6\u5907", kind: "asset", inputPorts: ["clip-contracts"], outputPorts: ["asset-bindings"] },
    { nodeId: "media-production", label: "\u5A92\u4F53\u751F\u4EA7", kind: "media", inputPorts: ["asset-bindings"], outputPorts: ["media-assets"] },
    { nodeId: "composition", label: "\u5408\u6210", kind: "compose", inputPorts: ["media-assets"], outputPorts: ["master-video"] },
    { nodeId: "delivery", label: "\u4EA4\u4ED8", kind: "delivery", inputPorts: ["master-video"], outputPorts: ["delivery-evidence"] }
  ],
  edges: [
    { edgeId: "production-contract-to-story-adaptation", source: "production-contract", target: "story-adaptation" },
    { edgeId: "story-adaptation-to-clip-contracts", source: "story-adaptation", target: "clip-contracts" },
    { edgeId: "clip-contracts-to-asset-preparation", source: "clip-contracts", target: "asset-preparation" },
    { edgeId: "asset-preparation-to-media-production", source: "asset-preparation", target: "media-production" },
    { edgeId: "media-production-to-composition", source: "media-production", target: "composition" },
    { edgeId: "composition-to-delivery", source: "composition", target: "delivery" }
  ]
};
const VIDEO_AUTHORING_EXECUTION_SCOPES = ["prompt_only", "media_delivery"];
const VIDEO_AUTHORING_GRAPH_NODE_KINDS = [
  "beat_sheet",
  "asset_coverage",
  "clip_writer",
  "assembly",
  "prompt_package",
  "estimate",
  "production_handoff",
  "video_submission",
  "video_result",
  "concat",
  "delivery_verify"
];
const VIDEO_AUTHORING_GRAPH_NODE_STATES = [
  "pending",
  "running",
  "waiting_external",
  "ready",
  "failed",
  "stale"
];
const VIDEO_RUN_STATES = [
  "collecting",
  "planned",
  "scheduled",
  "video_running",
  "video_success",
  "concatenating",
  "concatenated",
  "failed",
  "cancelled"
];
const VIDEO_RUN_TERMINAL_STATES = [
  "concatenated",
  "failed",
  "cancelled"
];
const VIDEO_AUTHORING_STATES = [
  "beats_committed",
  "writing_dispatched",
  "assembled",
  "script_approved",
  "deriving_assets",
  "asset_repair_required",
  "assets_ready",
  "estimate_ready",
  "authoring_done",
  "authoring_failed"
];
const VIDEO_AUTHORING_TERMINAL_STATES = [
  "authoring_done",
  "authoring_failed"
];
const VIDEO_RUN_STATE_SET = new Set(VIDEO_RUN_STATES);
const VIDEO_AUTHORING_STATE_SET = new Set(VIDEO_AUTHORING_STATES);
const VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET = new Set(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
const VIDEO_PRODUCTION_WORKFLOW_NODE_STATUS_SET = new Set(VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES);
const VIDEO_PRODUCTION_WORKFLOW_EVENT_KIND_SET = new Set(VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS);
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function isNullableString(value) {
  return value === null || typeof value === "string";
}
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isNullableNonNegativeInteger(value) {
  return value === null || isNonNegativeInteger(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}
function isTimestamp(value) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}
function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}
function failure(message) {
  return { success: false, error: { message } };
}
function parseVideoRunStatusEvent(value) {
  const record = asRecord(value);
  if (!record) return failure("video run status event must be an object");
  if (record.protocolVersion !== VIDEO_RUN_STATUS_PROTOCOL_VERSION) {
    return failure(`protocolVersion must equal ${VIDEO_RUN_STATUS_PROTOCOL_VERSION}`);
  }
  if (typeof record.runId !== "string" || !record.runId.trim()) return failure("runId must be a non-empty string");
  if (!isNullableString(record.flowId)) return failure("flowId must be a string or null");
  if (typeof record.state !== "string" || !VIDEO_RUN_STATE_SET.has(record.state)) return failure("state is not canonical");
  if (!isNonNegativeInteger(record.totalClips)) return failure("totalClips must be a non-negative integer");
  if (!isNonNegativeInteger(record.clipsDone)) return failure("clipsDone must be a non-negative integer");
  if (!isNullableString(record.errorMessage)) return failure("errorMessage must be a string or null");
  if (!isNullableString(record.completedAt)) return failure("completedAt must be a string or null");
  if (record.authoringState !== null && (typeof record.authoringState !== "string" || !VIDEO_AUTHORING_STATE_SET.has(record.authoringState))) return failure("authoringState is not canonical");
  if (!isNonNegativeInteger(record.authoringClipsReady)) return failure("authoringClipsReady must be a non-negative integer");
  if (!isNonNegativeInteger(record.authoringTotalClips)) return failure("authoringTotalClips must be a non-negative integer");
  if (!isNullableString(record.chapterId)) return failure("chapterId must be a string or null");
  if (!isNullableString(record.chapterTitle)) return failure("chapterTitle must be a string or null");
  if (!isTimestamp(record.updatedAt)) return failure("updatedAt must be an ISO timestamp");
  return { success: true, data: record };
}
function parseVideoRunStatusSnapshot(value) {
  const record = asRecord(value);
  if (!record) return failure("video run status snapshot must be an object");
  if (record.protocolVersion !== VIDEO_RUN_STATUS_PROTOCOL_VERSION) {
    return failure(`protocolVersion must equal ${VIDEO_RUN_STATUS_PROTOCOL_VERSION}`);
  }
  if (record.scopeType !== "project" && record.scopeType !== "chapter") return failure("scopeType must be project or chapter");
  if (typeof record.scopeId !== "string" || !record.scopeId.trim()) return failure("scopeId must be a non-empty string");
  if (!isTimestamp(record.generatedAt)) return failure("generatedAt must be an ISO timestamp");
  if (!isNullableTimestamp(record.watermarkUpdatedAt)) return failure("watermarkUpdatedAt must be an ISO timestamp or null");
  if (!Array.isArray(record.runs)) return failure("runs must be an array");
  const runs = [];
  for (const rawRun of record.runs) {
    const parsed = parseVideoRunStatusEvent(rawRun);
    if (!parsed.success) return failure(`invalid snapshot run: ${parsed.error.message}`);
    runs.push(parsed.data);
  }
  return {
    success: true,
    data: {
      protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      generatedAt: record.generatedAt,
      watermarkUpdatedAt: record.watermarkUpdatedAt,
      runs
    }
  };
}
function isTerminalVideoRunState(state) {
  return state === "concatenated" || state === "failed" || state === "cancelled";
}
function isTerminalVideoAuthoringState(state) {
  return state === "authoring_done" || state === "authoring_failed";
}
function parseVideoProductionWorkflowNodeProjection(value) {
  const record = asRecord(value);
  if (!record) return failure("video production workflow node projection must be an object");
  if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
    return failure("workflowRunId must be a non-empty string");
  }
  if (typeof record.workflowNodeId !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET.has(record.workflowNodeId)) {
    return failure("workflowNodeId is not canonical");
  }
  if (typeof record.status !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_STATUS_SET.has(record.status)) {
    return failure("status is not canonical");
  }
  if (!isNonNegativeInteger(record.completedUnits)) return failure("completedUnits must be a non-negative integer");
  if (!isNullableNonNegativeInteger(record.totalUnits)) return failure("totalUnits must be a non-negative integer or null");
  if (!isStringArray(record.inputArtifactIds)) return failure("inputArtifactIds must be non-empty string values");
  if (!isStringArray(record.outputArtifactIds)) return failure("outputArtifactIds must be non-empty string values");
  if (!isStringArray(record.effectIds)) return failure("effectIds must be non-empty string values");
  if (!isNonNegativeInteger(record.errorCount)) return failure("errorCount must be a non-negative integer");
  const timing = asRecord(record.timing);
  if (!timing) return failure("timing must be an object");
  if (!isNullableTimestamp(timing.startedAt)) return failure("timing.startedAt must be an ISO timestamp or null");
  if (!isNullableTimestamp(timing.updatedAt)) return failure("timing.updatedAt must be an ISO timestamp or null");
  if (!isNullableTimestamp(timing.finishedAt)) return failure("timing.finishedAt must be an ISO timestamp or null");
  if (!isNullableNonNegativeInteger(timing.durationMs)) return failure("timing.durationMs must be a non-negative integer or null");
  if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
  return { success: true, data: record };
}
function parseVideoProductionWorkflowEvent(value) {
  const record = asRecord(value);
  if (!record) return failure("video production workflow event must be an object");
  if (record.protocolVersion !== VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION) {
    return failure(`protocolVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION}`);
  }
  if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
    return failure("workflowRunId must be a non-empty string");
  }
  if (typeof record.workflowNodeId !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET.has(record.workflowNodeId)) {
    return failure("workflowNodeId is not canonical");
  }
  if (typeof record.eventId !== "string" || !record.eventId.trim()) return failure("eventId must be a non-empty string");
  if (!isNonNegativeInteger(record.seq)) return failure("seq must be a non-negative integer");
  if (typeof record.kind !== "string" || !VIDEO_PRODUCTION_WORKFLOW_EVENT_KIND_SET.has(record.kind)) {
    return failure("kind is not canonical");
  }
  if (!isTimestamp(record.occurredAt)) return failure("occurredAt must be an ISO timestamp");
  if (!isNullableString(record.payloadRef)) return failure("payloadRef must be a string or null");
  if (!isStringArray(record.artifactIds)) return failure("artifactIds must be non-empty string values");
  if (!isStringArray(record.effectIds)) return failure("effectIds must be non-empty string values");
  return { success: true, data: record };
}
function parseVideoProductionWorkflowSnapshot(value) {
  const record = asRecord(value);
  if (!record) return failure("video production workflow snapshot must be an object");
  if (record.protocolVersion !== VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION) {
    return failure(`protocolVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION}`);
  }
  if (record.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) {
    return failure(`workflowKey must equal ${VIDEO_PRODUCTION_WORKFLOW_KEY}`);
  }
  if (record.definitionVersion !== VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion) {
    return failure(`definitionVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion}`);
  }
  if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
    return failure("workflowRunId must be a non-empty string");
  }
  if (!isTimestamp(record.generatedAt)) return failure("generatedAt must be an ISO timestamp");
  if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
  if (!Array.isArray(record.nodes)) return failure("nodes must be an array");
  const nodes = [];
  for (const rawNode of record.nodes) {
    const parsed = parseVideoProductionWorkflowNodeProjection(rawNode);
    if (!parsed.success) return failure(`invalid workflow node: ${parsed.error.message}`);
    if (parsed.data.workflowRunId !== record.workflowRunId) {
      return failure("workflow node run ID must match snapshot workflowRunId");
    }
    nodes.push(parsed.data);
  }
  const expectedNodeIds = VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.join(",");
  const actualNodeIds = nodes.map((node) => node.workflowNodeId).join(",");
  if (actualNodeIds !== expectedNodeIds) return failure("workflow snapshot must contain the canonical seven nodes in order");
  return {
    success: true,
    data: {
      protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
      workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
      definitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
      workflowRunId: record.workflowRunId,
      generatedAt: record.generatedAt,
      latestEventSeq: record.latestEventSeq,
      nodes
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VIDEO_AUTHORING_EXECUTION_SCOPES,
  VIDEO_AUTHORING_GRAPH_NODE_KINDS,
  VIDEO_AUTHORING_GRAPH_NODE_STATES,
  VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION,
  VIDEO_AUTHORING_STATES,
  VIDEO_AUTHORING_TERMINAL_STATES,
  VIDEO_ORCHESTRATOR_PROTOCOL_VERSION,
  VIDEO_PRODUCTION_WORKFLOW_DEFINITION,
  VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
  VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES,
  VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
  VIDEO_RUN_STATES,
  VIDEO_RUN_STATUS_PROJECTION_OWNER,
  VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  VIDEO_RUN_TERMINAL_STATES,
  isTerminalVideoAuthoringState,
  isTerminalVideoRunState,
  parseVideoProductionWorkflowEvent,
  parseVideoProductionWorkflowNodeProjection,
  parseVideoProductionWorkflowSnapshot,
  parseVideoRunStatusEvent,
  parseVideoRunStatusSnapshot
});
