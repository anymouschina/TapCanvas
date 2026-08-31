"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_REFERENCE_EDGE_LABEL = exports.REFERENCE_ONLY_EXECUTION_ROLE = exports.VOICE_REFERENCE_RELATION_KIND = void 0;
exports.createVoiceReferenceEdgeData = createVoiceReferenceEdgeData;
exports.buildVoiceReferenceEdgeId = buildVoiceReferenceEdgeId;
exports.isReferenceOnlyCanvasEdge = isReferenceOnlyCanvasEdge;
exports.isVoiceReferenceCanvasEdge = isVoiceReferenceCanvasEdge;
exports.VOICE_REFERENCE_RELATION_KIND = "voice_reference";
exports.REFERENCE_ONLY_EXECUTION_ROLE = "reference_only";
exports.VOICE_REFERENCE_EDGE_LABEL = "音色";
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function createVoiceReferenceEdgeData() {
    return {
        edgeType: "audio",
        relationKind: exports.VOICE_REFERENCE_RELATION_KIND,
        executionRole: exports.REFERENCE_ONLY_EXECUTION_ROLE,
        label: exports.VOICE_REFERENCE_EDGE_LABEL,
    };
}
function buildVoiceReferenceEdgeId(sourceNodeId, targetNodeId) {
    const source = sourceNodeId.trim();
    const target = targetNodeId.trim();
    if (!source || !target) {
        throw new Error("voice reference edge requires non-empty source and target node ids");
    }
    return `e-voice-reference-${source}-${target}`;
}
function isReferenceOnlyCanvasEdge(edge) {
    return asRecord(edge?.data)?.executionRole === exports.REFERENCE_ONLY_EXECUTION_ROLE;
}
function isVoiceReferenceCanvasEdge(edge) {
    const data = asRecord(edge?.data);
    return (data?.edgeType === "audio" &&
        data.relationKind === exports.VOICE_REFERENCE_RELATION_KIND &&
        data.executionRole === exports.REFERENCE_ONLY_EXECUTION_ROLE);
}
