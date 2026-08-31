import type { StoryboardDirectorV12ValidationIssue } from "./types";
import {
  asRecord,
  ensureAllowedKeys,
  pushIssue,
  readRequiredArray,
  readRequiredFiniteNumber,
  readRequiredRecord,
  readRequiredString,
  readStringArray,
  type UnknownRecord,
  validateOptionalString,
  validateRequiredBoolean,
  validateStringFields,
} from "./validation-utils";

export function validateCoreArtifactShape(
  record: UnknownRecord,
  issues: StoryboardDirectorV12ValidationIssue[],
): { globalStyle: UnknownRecord | null; rawShots: unknown[] | null } {
  ensureAllowedKeys(
    record,
    [
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
    ],
    "$",
    issues,
  );

  const chapter = readRequiredRecord(record, "chapter", "$", issues);
  if (chapter) {
    ensureAllowedKeys(chapter, ["bookTitle", "chapterTitle", "sourceSpan"], "$.chapter", issues);
    validateStringFields(chapter, ["bookTitle", "chapterTitle", "sourceSpan"], "$.chapter", issues);
  }

  const globalStyle = readRequiredRecord(record, "globalStyle", "$", issues);
  if (globalStyle) {
    ensureAllowedKeys(globalStyle, ["genre", "visualTone", "palette", "aspectRatio", "fps"], "$.globalStyle", issues);
    validateStringFields(globalStyle, ["genre", "visualTone", "palette", "aspectRatio"], "$.globalStyle", issues);
    readRequiredFiniteNumber(globalStyle, "fps", "$.globalStyle", issues, { min: 12, max: 120, integer: true });
  }

  const modelingSpec = readRequiredRecord(record, "modelingSpec", "$", issues);
  if (modelingSpec) {
    const keys = ["unitScale", "topologyDetail", "materialStyle", "textureAging", "clothBehavior"] as const;
    ensureAllowedKeys(modelingSpec, keys, "$.modelingSpec", issues);
    validateStringFields(modelingSpec, keys, "$.modelingSpec", issues);
  }

  const stopMotionSpec = readRequiredRecord(record, "stopMotionSpec", "$", issues);
  if (stopMotionSpec) {
    const keys = ["fpsBase", "cadence", "microJitterPx", "holdFrames", "imperfectionPolicy"] as const;
    ensureAllowedKeys(stopMotionSpec, keys, "$.stopMotionSpec", issues);
    readRequiredFiniteNumber(stopMotionSpec, "fpsBase", "$.stopMotionSpec", issues, {
      min: 6,
      max: 120,
      integer: true,
    });
    const cadence = readRequiredString(stopMotionSpec, "cadence", "$.stopMotionSpec", issues, 20);
    if (cadence && cadence !== "onOnes" && cadence !== "onTwos" && cadence !== "onThrees") {
      pushIssue(issues, "stop_motion_cadence_invalid", "$.stopMotionSpec.cadence", "cadence 非法");
    }
    readRequiredFiniteNumber(stopMotionSpec, "microJitterPx", "$.stopMotionSpec", issues, { min: 0, max: 5 });
    const holdFrames = readRequiredArray(stopMotionSpec, "holdFrames", "$.stopMotionSpec", issues, 1);
    for (let index = 0; index < (holdFrames?.length ?? 0); index += 1) {
      const value = holdFrames?.[index];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 24) {
        pushIssue(issues, "hold_frame_invalid", `$.stopMotionSpec.holdFrames[${index}]`, "hold frame 必须是 1-24 整数");
      }
    }
    readRequiredString(stopMotionSpec, "imperfectionPolicy", "$.stopMotionSpec", issues);
  }

  const atmosphereSpec = readRequiredRecord(record, "atmosphereSpec", "$", issues);
  if (atmosphereSpec) {
    const keys = [
      "tensionLevel",
      "airDensity",
      "humidityCue",
      "windVector",
      "particleType",
      "soundProxySources",
    ] as const;
    ensureAllowedKeys(atmosphereSpec, keys, "$.atmosphereSpec", issues);
    readRequiredFiniteNumber(atmosphereSpec, "tensionLevel", "$.atmosphereSpec", issues, { min: 0, max: 1 });
    validateStringFields(atmosphereSpec, ["airDensity", "humidityCue", "windVector"], "$.atmosphereSpec", issues);
    readStringArray(atmosphereSpec.particleType, "$.atmosphereSpec.particleType", issues, { minItems: 1 });
    readStringArray(atmosphereSpec.soundProxySources, "$.atmosphereSpec.soundProxySources", issues, { minItems: 1 });
  }

  const cast = readRequiredArray(record, "cast", "$", issues, 1);
  for (let index = 0; index < (cast?.length ?? 0); index += 1) {
    const item = asRecord(cast?.[index]);
    const path = `$.cast[${index}]`;
    if (!item) {
      pushIssue(issues, "cast_item_invalid", path, "cast item 必须是对象");
      continue;
    }
    ensureAllowedKeys(item, ["id", "name", "anchorTraits"], path, issues);
    validateStringFields(item, ["id", "name"], path, issues);
    readStringArray(item.anchorTraits, `${path}.anchorTraits`, issues, { minItems: 1 });
  }

  const relationships = readRequiredArray(record, "relationshipGraph", "$", issues, 0);
  for (let index = 0; index < (relationships?.length ?? 0); index += 1) {
    const item = asRecord(relationships?.[index]);
    const path = `$.relationshipGraph[${index}]`;
    if (!item) {
      pushIssue(issues, "relationship_item_invalid", path, "relationship item 必须是对象");
      continue;
    }
    ensureAllowedKeys(item, ["from", "to", "relationType", "intensity", "state"], path, issues);
    validateStringFields(item, ["from", "to", "relationType", "state"], path, issues);
    readRequiredFiniteNumber(item, "intensity", path, issues, { min: 0, max: 1 });
  }

  return {
    globalStyle,
    rawShots: readRequiredArray(record, "shots", "$", issues, 1),
  };
}

export function validateShotCore(
  record: UnknownRecord,
  index: number,
  issues: StoryboardDirectorV12ValidationIssue[],
): { shotId: string; exitState: string; continuityFromPrev: string } {
  const path = `$.shots[${index}]`;
  ensureAllowedKeys(
    record,
    [
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
    ],
    path,
    issues,
  );
  const shotId = readRequiredString(record, "shotId", path, issues, 160);
  if (shotId && !/^SHOT_[0-9]{2,}$/.test(shotId)) {
    pushIssue(issues, "shot_id_invalid", `${path}.shotId`, "shotId 必须符合 SHOT_01 格式");
  }
  readRequiredFiniteNumber(record, "durationSec", path, issues, { min: 0, exclusiveMin: true });
  const beatRole = readRequiredString(record, "beatRole", path, issues, 20);
  if (beatRole && beatRole !== "opening" && beatRole !== "escalation" && beatRole !== "payoff") {
    pushIssue(issues, "shot_beat_role_invalid", `${path}.beatRole`, "beatRole 非法");
  }
  readRequiredString(record, "narrativeGoal", path, issues);
  readStringArray(record.subjectAnchors, `${path}.subjectAnchors`, issues, { minItems: 1 });

  const crowdRelations = Array.isArray(record.crowdRelations) ? record.crowdRelations : null;
  if (!crowdRelations) pushIssue(issues, "crowd_relations_invalid", `${path}.crowdRelations`, "crowdRelations 必须是数组");
  for (let crowdIndex = 0; crowdIndex < (crowdRelations?.length ?? 0); crowdIndex += 1) {
    const relation = asRecord(crowdRelations?.[crowdIndex]);
    const relationPath = `${path}.crowdRelations[${crowdIndex}]`;
    if (!relation) {
      pushIssue(issues, "crowd_relation_invalid", relationPath, "crowd relation 必须是对象");
      continue;
    }
    const keys = ["group", "relationToSubject", "blocking", "distance"] as const;
    ensureAllowedKeys(relation, keys, relationPath, issues);
    validateStringFields(relation, keys, relationPath, issues);
  }

  const scene = readRequiredRecord(record, "scene", path, issues);
  if (scene) {
    const keys = ["location", "timeOfDay", "weather", "environmentDetails"] as const;
    ensureAllowedKeys(scene, keys, `${path}.scene`, issues);
    validateStringFields(scene, ["location", "timeOfDay", "weather"], `${path}.scene`, issues);
    readStringArray(scene.environmentDetails, `${path}.scene.environmentDetails`, issues, { minItems: 1 });
  }

  const rigAndPose = readRequiredRecord(record, "rigAndPose", path, issues);
  if (rigAndPose) {
    const keys = ["centerOfMass", "limbConstraints", "forbiddenPoses", "keyPoseNotes"] as const;
    ensureAllowedKeys(rigAndPose, keys, `${path}.rigAndPose`, issues);
    validateStringFields(rigAndPose, ["centerOfMass", "keyPoseNotes"], `${path}.rigAndPose`, issues);
    readStringArray(rigAndPose.limbConstraints, `${path}.rigAndPose.limbConstraints`, issues);
    readStringArray(rigAndPose.forbiddenPoses, `${path}.rigAndPose.forbiddenPoses`, issues);
  }

  const camera = readRequiredRecord(record, "camera", path, issues);
  if (camera) {
    const keys = ["shotSize", "angle", "height", "lensMm", "shutterAngleDeg", "movement", "focusTarget"] as const;
    ensureAllowedKeys(camera, keys, `${path}.camera`, issues);
    validateStringFields(camera, ["shotSize", "angle", "height", "movement", "focusTarget"], `${path}.camera`, issues);
    readRequiredFiniteNumber(camera, "lensMm", `${path}.camera`, issues, { min: 8, max: 600 });
    readRequiredFiniteNumber(camera, "shutterAngleDeg", `${path}.camera`, issues, { min: 1, max: 360 });
  }

  const lighting = readRequiredRecord(record, "lighting", path, issues);
  if (lighting) {
    const keys = ["keyDirection", "keyAngleDeg", "colorTempK", "contrastRatio", "fillStyle", "rimLight"] as const;
    ensureAllowedKeys(lighting, keys, `${path}.lighting`, issues);
    validateStringFields(lighting, ["keyDirection", "contrastRatio", "fillStyle", "rimLight"], `${path}.lighting`, issues);
    readRequiredFiniteNumber(lighting, "keyAngleDeg", `${path}.lighting`, issues, { min: 0, max: 180 });
    readRequiredFiniteNumber(lighting, "colorTempK", `${path}.lighting`, issues, {
      min: 1_000,
      max: 20_000,
      integer: true,
    });
  }

  readStringArray(record.actionChain, `${path}.actionChain`, issues, { minItems: 1 });

  const composition = readRequiredRecord(record, "composition", path, issues);
  if (composition) {
    const keys = ["foreground", "midground", "background", "spatialRule"] as const;
    ensureAllowedKeys(composition, keys, `${path}.composition`, issues);
    validateStringFields(composition, keys, `${path}.composition`, issues);
  }

  const dramaticBeat = readRequiredRecord(record, "dramaticBeat", path, issues);
  if (dramaticBeat) {
    const keys = ["before", "during", "after"] as const;
    ensureAllowedKeys(dramaticBeat, keys, `${path}.dramaticBeat`, issues);
    validateStringFields(dramaticBeat, keys, `${path}.dramaticBeat`, issues);
  }

  const performance = readRequiredRecord(record, "performance", path, issues);
  if (performance) {
    const keys = ["emotion", "microExpression", "bodyLanguage"] as const;
    ensureAllowedKeys(performance, keys, `${path}.performance`, issues);
    validateStringFields(performance, keys, `${path}.performance`, issues);
  }

  const continuity = readRequiredRecord(record, "continuity", path, issues);
  let continuityFromPrev = "";
  if (continuity) {
    const keys = ["fromPrev", "persistentAnchors", "forbiddenDrifts"] as const;
    ensureAllowedKeys(continuity, keys, `${path}.continuity`, issues);
    continuityFromPrev = readRequiredString(continuity, "fromPrev", `${path}.continuity`, issues);
    readStringArray(continuity.persistentAnchors, `${path}.continuity.persistentAnchors`, issues, { minItems: 1 });
    readStringArray(continuity.forbiddenDrifts, `${path}.continuity.forbiddenDrifts`, issues, { minItems: 1 });
  }

  const continuityLocks = readRequiredRecord(record, "continuityLocks", path, issues);
  if (continuityLocks) {
    const keys = ["identityLock", "propLock", "spaceLock", "lightLock"] as const;
    ensureAllowedKeys(continuityLocks, keys, `${path}.continuityLocks`, issues);
    for (const key of keys) readStringArray(continuityLocks[key], `${path}.continuityLocks.${key}`, issues);
  }

  const readabilityChecks = readRequiredRecord(record, "readabilityChecks", path, issues);
  if (readabilityChecks) {
    const keys = ["subjectReadable", "relationshipReadable", "lightingConsistent"] as const;
    ensureAllowedKeys(readabilityChecks, keys, `${path}.readabilityChecks`, issues);
    for (const key of keys) validateRequiredBoolean(readabilityChecks, key, `${path}.readabilityChecks`, issues);
  }

  readStringArray(record.failureRisks, `${path}.failureRisks`, issues, { minItems: 1 });
  readStringArray(record.negativeConstraints, `${path}.negativeConstraints`, issues, { minItems: 2 });

  const prompt = readRequiredRecord(record, "prompt", path, issues);
  if (prompt) {
    ensureAllowedKeys(prompt, ["cn", "enOptional"], `${path}.prompt`, issues);
    readRequiredString(prompt, "cn", `${path}.prompt`, issues, 20_000);
    validateOptionalString(prompt, "enOptional", `${path}.prompt`, issues, 20_000);
  }

  const exitState = readRequiredString(record, "exitState", path, issues, 4_000);
  return { shotId, exitState, continuityFromPrev };
}
