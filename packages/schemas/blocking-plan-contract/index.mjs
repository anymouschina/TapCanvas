import { parseKeyframeCompositionContract } from "../keyframe-composition-contract/index.mjs";
import { blockingPlanFields } from "./schema.mjs";
import { parseBlockingBackgroundPlan, collectBlockingBackgroundPlans } from "./background.mjs";
import { parseBlockingBackground } from "./background-url.mjs";
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = value => typeof value === "string" && value.trim() ? value.trim() : null;
export function inspectBlockingCharacterCoverage(expected, characters, path) {
    const expectedNames = [...new Set(expected.map(nonEmptyString).filter(Boolean))];
    const actualNames = [...new Set(characters.map(character => character.name.trim()))];
    const missing = expectedNames.filter(name => !actualNames.includes(name));
    const extra = actualNames.filter(name => !expectedNames.includes(name));
    return missing.length || extra.length
        ? `${path}.characters must place exactly the declared character objects; missing=[${missing.join(",")}]:extra=[${extra.join(",")}]`
        : null;
}
export function projectBlockingPlans(root) {
    if (!Array.isArray(root.beats) || !Array.isArray(root.blockingPlans) || root.blockingPlans.length !== root.beats.length) {
        // State both counts: the model has to add or drop exact entries, and a bare
        // "one per beat" leaves it to re-emit the same mismatched pair every window.
        const beatsCount = Array.isArray(root.beats) ? root.beats.length : 0;
        const plansCount = Array.isArray(root.blockingPlans) ? root.blockingPlans.length : 0;
        return {
            ok: false,
            errorMessage: "blockingPlans must contain one spatial diagram plan for every BeatSheet beat"
                + `; received blockingPlans=${plansCount} beats=${beatsCount}; each plan's clipIndex must equal its zero-based position`,
        };
    }
    const blockingPlans = [];
    const characterCoverageIssues = [];
    const allowedBlockingPlanFields = new Set(blockingPlanFields);
    for (let planIndex = 0; planIndex < root.blockingPlans.length; planIndex += 1) {
        const rawPlan = root.blockingPlans[planIndex];
        const path = `blockingPlans[${planIndex}]`;
        if (!isRecord(rawPlan))
            return { ok: false, errorMessage: `${path} must be an object` };
        const unexpectedField = Object.keys(rawPlan).find((field) => !allowedBlockingPlanFields.has(field));
        if (unexpectedField)
            return { ok: false, errorMessage: `${path} contains unexpected field ${unexpectedField}` };
        if (rawPlan.clipIndex !== planIndex) {
            return { ok: false, errorMessage: `${path}.clipIndex must equal its zero-based BeatSheet position ${planIndex}` };
        }
        if (!nonEmptyString(rawPlan.title) || !nonEmptyString(rawPlan.sceneName)) {
            return { ok: false, errorMessage: `${path} requires non-empty title and sceneName` };
        }
        if (typeof rawPlan.durationSeconds !== "number" || !Number.isFinite(rawPlan.durationSeconds) || rawPlan.durationSeconds <= 0) {
            return { ok: false, errorMessage: `${path}.durationSeconds must be positive` };
        }
        if (!Array.isArray(rawPlan.characters) || !Array.isArray(rawPlan.landmarks)) {
            return { ok: false, errorMessage: `${path} requires characters and landmarks arrays` };
        }
        for (let characterIndex = 0; characterIndex < rawPlan.characters.length; characterIndex += 1) {
            const rawCharacter = rawPlan.characters[characterIndex];
            if (!isRecord(rawCharacter) || !nonEmptyString(rawCharacter.name)
                || !Array.isArray(rawCharacter.at) || rawCharacter.at.length < 2
                || rawCharacter.at.slice(0, 2).some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
                return { ok: false, errorMessage: `${path}.characters[${characterIndex}] requires name and finite at[x,y] coordinates` };
            }
        }
        if (rawPlan.characters.length === 0 && rawPlan.landmarks.length === 0 && !isRecord(rawPlan.camera)) {
            return { ok: false, errorMessage: `${path} must contain at least one character, landmark or camera marker` };
        }
        const beat = root.beats[planIndex];
        if (!isRecord(beat)) return {ok:false,errorMessage:`beats[${planIndex}] must be an object`};
        // `beats[].characters` is a host-derived index: the runtime compiles it from the
        // beat's declared character objects, so the Agent never authors it and cannot know
        // its order. Each blocking-plan character entry carries its own `at` coordinates, so
        // array order encodes no fact. The contract is therefore coverage, not sequence:
        // exactly the beat's declared characters, each placed once.
        const coverageError = inspectBlockingCharacterCoverage(
            Array.isArray(beat.characters) ? beat.characters : [], rawPlan.characters, path);
        if (coverageError) characterCoverageIssues.push(coverageError);
        if (rawPlan.durationSeconds !== beat.durationSeconds) {
            return {ok:false,errorMessage:`${path}.durationSeconds must equal beats[${planIndex}].durationSeconds`};
        }
        const composition = parseKeyframeCompositionContract(rawPlan.compositionContract);
        if (!composition.ok) {
            return { ok: false, errorMessage: `${path}.compositionContract is invalid: ${composition.issues.join("; ")}` };
        }
        const background = parseBlockingBackground(rawPlan.backgroundImageUrl);
        if (rawPlan.backgroundPlan !== undefined) {
            try {
                parseBlockingBackgroundPlan(rawPlan.backgroundPlan);
            }
            catch (error) {
                return { ok: false, errorMessage: `${path}: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        if (!background.ok)
            return { ok: false, errorMessage: `${path}.${background.errorMessage}` };
        const { backgroundImageUrl: suppliedBackground, ...planFields } = rawPlan;
        blockingPlans.push({
            ...planFields,
            ...(background.url ? { backgroundImageUrl: background.url } : {}),
            compositionContract: composition.contract,
        });
    }
    if (characterCoverageIssues.length > 0) {
        return { ok: false, errorMessage: `${characterCoverageIssues.join(" | ")}. Repair every listed plan in this same candidate.` };
    }
    try {
        collectBlockingBackgroundPlans(blockingPlans.flatMap(plan => plan.backgroundPlan === undefined ? [] : [plan.backgroundPlan]));
    } catch (error) {
        return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, blockingPlans };
}
