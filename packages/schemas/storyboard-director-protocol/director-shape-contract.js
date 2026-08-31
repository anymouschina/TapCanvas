"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCoreArtifactShape = validateCoreArtifactShape;
exports.validateShotCore = validateShotCore;
const validation_utils_1 = require("./validation-utils");
function validateCoreArtifactShape(record, issues) {
    (0, validation_utils_1.ensureAllowedKeys)(record, [
        "schemaVersion",
        "chapter",
        "globalStyle",
        "modelingSpec",
        "stopMotionSpec",
        "atmosphereSpec",
        "storyFactsContext",
        "cast",
        "relationshipGraph",
        "shots",
    ], "$", issues);
    const chapter = (0, validation_utils_1.readRequiredRecord)(record, "chapter", "$", issues);
    if (chapter) {
        (0, validation_utils_1.ensureAllowedKeys)(chapter, ["bookTitle", "chapterTitle", "sourceSpan"], "$.chapter", issues);
        (0, validation_utils_1.validateStringFields)(chapter, ["bookTitle", "chapterTitle", "sourceSpan"], "$.chapter", issues);
    }
    const globalStyle = (0, validation_utils_1.readRequiredRecord)(record, "globalStyle", "$", issues);
    if (globalStyle) {
        (0, validation_utils_1.ensureAllowedKeys)(globalStyle, ["genre", "visualTone", "palette", "aspectRatio", "fps"], "$.globalStyle", issues);
        (0, validation_utils_1.validateStringFields)(globalStyle, ["genre", "visualTone", "palette", "aspectRatio"], "$.globalStyle", issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(globalStyle, "fps", "$.globalStyle", issues, { min: 12, max: 120, integer: true });
    }
    const modelingSpec = (0, validation_utils_1.readRequiredRecord)(record, "modelingSpec", "$", issues);
    if (modelingSpec) {
        const keys = ["unitScale", "topologyDetail", "materialStyle", "textureAging", "clothBehavior"];
        (0, validation_utils_1.ensureAllowedKeys)(modelingSpec, keys, "$.modelingSpec", issues);
        (0, validation_utils_1.validateStringFields)(modelingSpec, keys, "$.modelingSpec", issues);
    }
    const stopMotionSpec = (0, validation_utils_1.readRequiredRecord)(record, "stopMotionSpec", "$", issues);
    if (stopMotionSpec) {
        const keys = ["fpsBase", "cadence", "microJitterPx", "holdFrames", "imperfectionPolicy"];
        (0, validation_utils_1.ensureAllowedKeys)(stopMotionSpec, keys, "$.stopMotionSpec", issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(stopMotionSpec, "fpsBase", "$.stopMotionSpec", issues, {
            min: 6,
            max: 120,
            integer: true,
        });
        const cadence = (0, validation_utils_1.readRequiredString)(stopMotionSpec, "cadence", "$.stopMotionSpec", issues, 20);
        if (cadence && cadence !== "onOnes" && cadence !== "onTwos" && cadence !== "onThrees") {
            (0, validation_utils_1.pushIssue)(issues, "stop_motion_cadence_invalid", "$.stopMotionSpec.cadence", "cadence 非法");
        }
        (0, validation_utils_1.readRequiredFiniteNumber)(stopMotionSpec, "microJitterPx", "$.stopMotionSpec", issues, { min: 0, max: 5 });
        const holdFrames = (0, validation_utils_1.readRequiredArray)(stopMotionSpec, "holdFrames", "$.stopMotionSpec", issues, 1);
        for (let index = 0; index < (holdFrames?.length ?? 0); index += 1) {
            const value = holdFrames?.[index];
            if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 24) {
                (0, validation_utils_1.pushIssue)(issues, "hold_frame_invalid", `$.stopMotionSpec.holdFrames[${index}]`, "hold frame 必须是 1-24 整数");
            }
        }
        (0, validation_utils_1.readRequiredString)(stopMotionSpec, "imperfectionPolicy", "$.stopMotionSpec", issues);
    }
    const atmosphereSpec = (0, validation_utils_1.readRequiredRecord)(record, "atmosphereSpec", "$", issues);
    if (atmosphereSpec) {
        const keys = [
            "tensionLevel",
            "airDensity",
            "humidityCue",
            "windVector",
            "particleType",
            "soundProxySources",
        ];
        (0, validation_utils_1.ensureAllowedKeys)(atmosphereSpec, keys, "$.atmosphereSpec", issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(atmosphereSpec, "tensionLevel", "$.atmosphereSpec", issues, { min: 0, max: 1 });
        (0, validation_utils_1.validateStringFields)(atmosphereSpec, ["airDensity", "humidityCue", "windVector"], "$.atmosphereSpec", issues);
        (0, validation_utils_1.readStringArray)(atmosphereSpec.particleType, "$.atmosphereSpec.particleType", issues, { minItems: 1 });
        (0, validation_utils_1.readStringArray)(atmosphereSpec.soundProxySources, "$.atmosphereSpec.soundProxySources", issues, { minItems: 1 });
    }
    const cast = (0, validation_utils_1.readRequiredArray)(record, "cast", "$", issues, 1);
    for (let index = 0; index < (cast?.length ?? 0); index += 1) {
        const item = (0, validation_utils_1.asRecord)(cast?.[index]);
        const path = `$.cast[${index}]`;
        if (!item) {
            (0, validation_utils_1.pushIssue)(issues, "cast_item_invalid", path, "cast item 必须是对象");
            continue;
        }
        (0, validation_utils_1.ensureAllowedKeys)(item, ["id", "name", "anchorTraits"], path, issues);
        (0, validation_utils_1.validateStringFields)(item, ["id", "name"], path, issues);
        (0, validation_utils_1.readStringArray)(item.anchorTraits, `${path}.anchorTraits`, issues, { minItems: 1 });
    }
    const relationships = (0, validation_utils_1.readRequiredArray)(record, "relationshipGraph", "$", issues, 0);
    for (let index = 0; index < (relationships?.length ?? 0); index += 1) {
        const item = (0, validation_utils_1.asRecord)(relationships?.[index]);
        const path = `$.relationshipGraph[${index}]`;
        if (!item) {
            (0, validation_utils_1.pushIssue)(issues, "relationship_item_invalid", path, "relationship item 必须是对象");
            continue;
        }
        (0, validation_utils_1.ensureAllowedKeys)(item, ["from", "to", "relationType", "intensity", "state"], path, issues);
        (0, validation_utils_1.validateStringFields)(item, ["from", "to", "relationType", "state"], path, issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(item, "intensity", path, issues, { min: 0, max: 1 });
    }
    return {
        globalStyle,
        rawShots: (0, validation_utils_1.readRequiredArray)(record, "shots", "$", issues, 1),
    };
}
function validateShotCore(record, index, issues) {
    const path = `$.shots[${index}]`;
    (0, validation_utils_1.ensureAllowedKeys)(record, [
        "shotId",
        "durationSec",
        "beatRole",
        "narrativeGoal",
        "subjectAnchors",
        "crowdRelations",
        "scene",
        "rigAndPose",
        "camera",
        "lighting",
        "actionChain",
        "composition",
        "dramaticBeat",
        "performance",
        "continuity",
        "continuityLocks",
        "exitState",
        "storyFactLocks",
        "readabilityChecks",
        "failureRisks",
        "negativeConstraints",
        "prompt",
    ], path, issues);
    const shotId = (0, validation_utils_1.readRequiredString)(record, "shotId", path, issues, 160);
    if (shotId && !/^SHOT_[0-9]{2,}$/.test(shotId)) {
        (0, validation_utils_1.pushIssue)(issues, "shot_id_invalid", `${path}.shotId`, "shotId 必须符合 SHOT_01 格式");
    }
    (0, validation_utils_1.readRequiredFiniteNumber)(record, "durationSec", path, issues, { min: 0, exclusiveMin: true });
    const beatRole = (0, validation_utils_1.readRequiredString)(record, "beatRole", path, issues, 20);
    if (beatRole && beatRole !== "opening" && beatRole !== "escalation" && beatRole !== "payoff") {
        (0, validation_utils_1.pushIssue)(issues, "shot_beat_role_invalid", `${path}.beatRole`, "beatRole 非法");
    }
    (0, validation_utils_1.readRequiredString)(record, "narrativeGoal", path, issues);
    (0, validation_utils_1.readStringArray)(record.subjectAnchors, `${path}.subjectAnchors`, issues, { minItems: 1 });
    const crowdRelations = Array.isArray(record.crowdRelations) ? record.crowdRelations : null;
    if (!crowdRelations)
        (0, validation_utils_1.pushIssue)(issues, "crowd_relations_invalid", `${path}.crowdRelations`, "crowdRelations 必须是数组");
    for (let crowdIndex = 0; crowdIndex < (crowdRelations?.length ?? 0); crowdIndex += 1) {
        const relation = (0, validation_utils_1.asRecord)(crowdRelations?.[crowdIndex]);
        const relationPath = `${path}.crowdRelations[${crowdIndex}]`;
        if (!relation) {
            (0, validation_utils_1.pushIssue)(issues, "crowd_relation_invalid", relationPath, "crowd relation 必须是对象");
            continue;
        }
        const keys = ["group", "relationToSubject", "blocking", "distance"];
        (0, validation_utils_1.ensureAllowedKeys)(relation, keys, relationPath, issues);
        (0, validation_utils_1.validateStringFields)(relation, keys, relationPath, issues);
    }
    const scene = (0, validation_utils_1.readRequiredRecord)(record, "scene", path, issues);
    if (scene) {
        const keys = ["location", "timeOfDay", "weather", "environmentDetails"];
        (0, validation_utils_1.ensureAllowedKeys)(scene, keys, `${path}.scene`, issues);
        (0, validation_utils_1.validateStringFields)(scene, ["location", "timeOfDay", "weather"], `${path}.scene`, issues);
        (0, validation_utils_1.readStringArray)(scene.environmentDetails, `${path}.scene.environmentDetails`, issues, { minItems: 1 });
    }
    const rigAndPose = (0, validation_utils_1.readRequiredRecord)(record, "rigAndPose", path, issues);
    if (rigAndPose) {
        const keys = ["centerOfMass", "limbConstraints", "forbiddenPoses", "keyPoseNotes"];
        (0, validation_utils_1.ensureAllowedKeys)(rigAndPose, keys, `${path}.rigAndPose`, issues);
        (0, validation_utils_1.validateStringFields)(rigAndPose, ["centerOfMass", "keyPoseNotes"], `${path}.rigAndPose`, issues);
        (0, validation_utils_1.readStringArray)(rigAndPose.limbConstraints, `${path}.rigAndPose.limbConstraints`, issues);
        (0, validation_utils_1.readStringArray)(rigAndPose.forbiddenPoses, `${path}.rigAndPose.forbiddenPoses`, issues);
    }
    const camera = (0, validation_utils_1.readRequiredRecord)(record, "camera", path, issues);
    if (camera) {
        const keys = ["shotSize", "angle", "height", "lensMm", "shutterAngleDeg", "movement", "focusTarget"];
        (0, validation_utils_1.ensureAllowedKeys)(camera, keys, `${path}.camera`, issues);
        (0, validation_utils_1.validateStringFields)(camera, ["shotSize", "angle", "height", "movement", "focusTarget"], `${path}.camera`, issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(camera, "lensMm", `${path}.camera`, issues, { min: 8, max: 600 });
        (0, validation_utils_1.readRequiredFiniteNumber)(camera, "shutterAngleDeg", `${path}.camera`, issues, { min: 1, max: 360 });
    }
    const lighting = (0, validation_utils_1.readRequiredRecord)(record, "lighting", path, issues);
    if (lighting) {
        const keys = ["keyDirection", "keyAngleDeg", "colorTempK", "contrastRatio", "fillStyle", "rimLight"];
        (0, validation_utils_1.ensureAllowedKeys)(lighting, keys, `${path}.lighting`, issues);
        (0, validation_utils_1.validateStringFields)(lighting, ["keyDirection", "contrastRatio", "fillStyle", "rimLight"], `${path}.lighting`, issues);
        (0, validation_utils_1.readRequiredFiniteNumber)(lighting, "keyAngleDeg", `${path}.lighting`, issues, { min: 0, max: 180 });
        (0, validation_utils_1.readRequiredFiniteNumber)(lighting, "colorTempK", `${path}.lighting`, issues, {
            min: 1_000,
            max: 20_000,
            integer: true,
        });
    }
    (0, validation_utils_1.readStringArray)(record.actionChain, `${path}.actionChain`, issues, { minItems: 1 });
    const composition = (0, validation_utils_1.readRequiredRecord)(record, "composition", path, issues);
    if (composition) {
        const keys = ["foreground", "midground", "background", "spatialRule"];
        (0, validation_utils_1.ensureAllowedKeys)(composition, keys, `${path}.composition`, issues);
        (0, validation_utils_1.validateStringFields)(composition, keys, `${path}.composition`, issues);
    }
    const dramaticBeat = (0, validation_utils_1.readRequiredRecord)(record, "dramaticBeat", path, issues);
    if (dramaticBeat) {
        const keys = ["before", "during", "after"];
        (0, validation_utils_1.ensureAllowedKeys)(dramaticBeat, keys, `${path}.dramaticBeat`, issues);
        (0, validation_utils_1.validateStringFields)(dramaticBeat, keys, `${path}.dramaticBeat`, issues);
    }
    const performance = (0, validation_utils_1.readRequiredRecord)(record, "performance", path, issues);
    if (performance) {
        const keys = ["emotion", "microExpression", "bodyLanguage"];
        (0, validation_utils_1.ensureAllowedKeys)(performance, keys, `${path}.performance`, issues);
        (0, validation_utils_1.validateStringFields)(performance, keys, `${path}.performance`, issues);
    }
    const continuity = (0, validation_utils_1.readRequiredRecord)(record, "continuity", path, issues);
    let continuityFromPrev = "";
    if (continuity) {
        const keys = ["fromPrev", "persistentAnchors", "forbiddenDrifts"];
        (0, validation_utils_1.ensureAllowedKeys)(continuity, keys, `${path}.continuity`, issues);
        continuityFromPrev = (0, validation_utils_1.readRequiredString)(continuity, "fromPrev", `${path}.continuity`, issues);
        (0, validation_utils_1.readStringArray)(continuity.persistentAnchors, `${path}.continuity.persistentAnchors`, issues, { minItems: 1 });
        (0, validation_utils_1.readStringArray)(continuity.forbiddenDrifts, `${path}.continuity.forbiddenDrifts`, issues, { minItems: 1 });
    }
    const continuityLocks = (0, validation_utils_1.readRequiredRecord)(record, "continuityLocks", path, issues);
    if (continuityLocks) {
        const keys = ["identityLock", "propLock", "spaceLock", "lightLock"];
        (0, validation_utils_1.ensureAllowedKeys)(continuityLocks, keys, `${path}.continuityLocks`, issues);
        for (const key of keys)
            (0, validation_utils_1.readStringArray)(continuityLocks[key], `${path}.continuityLocks.${key}`, issues);
    }
    const readabilityChecks = (0, validation_utils_1.readRequiredRecord)(record, "readabilityChecks", path, issues);
    if (readabilityChecks) {
        const keys = ["subjectReadable", "relationshipReadable", "lightingConsistent"];
        (0, validation_utils_1.ensureAllowedKeys)(readabilityChecks, keys, `${path}.readabilityChecks`, issues);
        for (const key of keys)
            (0, validation_utils_1.validateRequiredBoolean)(readabilityChecks, key, `${path}.readabilityChecks`, issues);
    }
    (0, validation_utils_1.readStringArray)(record.failureRisks, `${path}.failureRisks`, issues, { minItems: 1 });
    (0, validation_utils_1.readStringArray)(record.negativeConstraints, `${path}.negativeConstraints`, issues, { minItems: 2 });
    const prompt = (0, validation_utils_1.readRequiredRecord)(record, "prompt", path, issues);
    if (prompt) {
        (0, validation_utils_1.ensureAllowedKeys)(prompt, ["cn", "enOptional"], `${path}.prompt`, issues);
        (0, validation_utils_1.readRequiredString)(prompt, "cn", `${path}.prompt`, issues, 20_000);
        (0, validation_utils_1.validateOptionalString)(prompt, "enOptional", `${path}.prompt`, issues, 20_000);
    }
    const exitState = (0, validation_utils_1.readRequiredString)(record, "exitState", path, issues, 4_000);
    return { shotId, exitState, continuityFromPrev };
}
