import { workflowAuthoringWaitLabel } from "./authoring-wait-label.mjs";

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Projects only versioned runtime facts already present in the workflow node
 * receipt. Conflicting or unknown reason codes stay generic instead of being
 * guessed from error prose, node labels, prompts or task content.
 *
 * Both the server (canvas status surface, execution history) and the web client
 * project the same receipt through this one function, so a waiting node can
 * never be described differently depending on which surface reads it.
 */
export function resolveWorkflowWaitingReason(outputRefs) {
    if (!isRecord(outputRefs) || !isRecord(outputRefs.evidence)) return null;
    const evidence = outputRefs.evidence;
    const requestTerminal = isRecord(evidence.requestTerminal) ? evidence.requestTerminal : null;
    const deliveryEvidence = isRecord(evidence.deliveryEvidence) ? evidence.deliveryEvidence : null;
    const recoveryCheckpoint = isRecord(deliveryEvidence?.recoveryCheckpoint)
        ? deliveryEvidence.recoveryCheckpoint
        : null;
    const declaredCodes = [
        readString(evidence.waitingReason),
        readString(evidence.continuationReason),
        readString(requestTerminal?.reason),
        readString(recoveryCheckpoint?.reasonCode),
    ].filter(Boolean);
    const repairLabel = workflowAuthoringWaitLabel(evidence);
    if (isRecord(evidence.outputRepair) && repairLabel
        && !declaredCodes.includes("provider_balance_required")
        && !declaredCodes.includes("external_dependency_unavailable")) {
        return { code: "structured_output_repair_required", label: repairLabel };
    }
    const uniqueCodes = [...new Set(declaredCodes)];
    if (uniqueCodes.length !== 1) return null;
    const code = uniqueCodes[0];
    if (code === "external_dependency_unavailable") {
        const observation = isRecord(evidence.dependencyObservation) ? evidence.dependencyObservation : null;
        const dependency = isRecord(observation?.dependency) ? observation.dependency : null;
        if (observation?.version !== 1 || dependency?.kind !== "model_catalog"
            || !readString(dependency.identity) || !readString(dependency.field)) return null;
        return { code, label: `等待模型目录修复：${readString(dependency.identity)} / ${readString(dependency.field)}` };
    }
    if (code === "provider_balance_required") return { code, label: "等待余额恢复" };
    if (code === "workflow_agent_no_progress_recovery_deferred") {
        return { code, label: "等待内部修复重试" };
    }
    return null;
}
