import { isDeepStrictEqual } from "node:util";
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** A generation identity must resolve to one exact authored plan. Never pick a conflicting version. */
export function collectBlockingBackgroundPlans(values) {
    const plans = new Map();
    for (const [index, value] of values.entries()) {
        const plan = parseBlockingBackgroundPlan(value);
        const previous = plans.get(plan.assetId);
        if (previous && !isDeepStrictEqual(previous.plan, plan)) {
            throw new Error(`Conflicting background plans for ${plan.assetId}: blockingPlans[${previous.index}].backgroundPlan and blockingPlans[${index}].backgroundPlan must use identical fields for the same assetId. Revise the same candidate: reuse one exact plan for one background, or assign distinct assetIds for intentionally different backgrounds. Preserve each beat's intended scene state.`);
        }
        if (!previous) plans.set(plan.assetId, { plan, index });
    }
    return [...plans.values()].map(entry => entry.plan);
}
export function parseBlockingBackgroundPlan(value) {
    if (!record(value))
        throw new Error("backgroundPlan must be an object");
    const allowed = new Set(["assetId", "displayName", "prompt", "negativePrompt", "referenceAssetBindings"]);
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            throw new Error(`backgroundPlan contains unexpected field ${key}`);
    for (const key of ["assetId", "displayName", "prompt", "negativePrompt"]) {
        if (typeof value[key] !== "string" || !value[key].trim())
            throw new Error(`backgroundPlan.${key} must be a non-empty string`);
    }
    if (!Array.isArray(value.referenceAssetBindings))
        throw new Error("backgroundPlan.referenceAssetBindings must be an array");
    for (const binding of value.referenceAssetBindings) {
        if (!record(binding) || typeof binding.assetId !== "string" || !binding.assetId.trim()
            || !["layout", "content", "identity", "style"].includes(String(binding.role))) {
            throw new Error("backgroundPlan.referenceAssetBindings requires exact assetId and reference role");
        }
    }
    return value;
}
