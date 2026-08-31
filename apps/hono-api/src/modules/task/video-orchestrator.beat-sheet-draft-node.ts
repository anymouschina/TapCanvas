import {
  parseStoryFactLocks,
  parseStoryFactsContext,
  type StoryboardDirectorV12ValidationIssue,
} from "../storyboard/storyboard-structure";
import {
  validateBeatAssetObjectBindings,
} from "./video-orchestrator.asset-object-contract";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";
import {
  parseBeatCharacterStateVersions,
  parseBeatSceneState,
  parseBeatTemporalContext,
} from "./video-orchestrator.temporal-state-contract";
import {
  parseBeatContinuityLedger,
  parseBeatVisualStateRefs,
} from "./video-orchestrator.visual-state-timeline";
import {
  parseNarrativeAudioPlan,
  validateNarrativeAudioPlacement,
} from "./video-orchestrator.spoken-script";

const CONTINUITY_MODES = new Set(["editorial_cut", "bridge_frames", "reference_video"]);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];

export type BeatSheetDraftNodeValidationOptions = {
  generationContract?: VideoGenerationContract;
};

const readNamedObjectContracts = (
  value: unknown,
): Array<{ kind: string; name: string }> =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind.trim() : "";
        const name = typeof record.name === "string" ? record.name.trim() : "";
        return kind && name ? [{ kind, name }] : [];
      })
    : [];

const readDialogueSpeakerNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const speakerName = (item as Record<string, unknown>).speakerName;
        return typeof speakerName === "string" && speakerName.trim()
          ? [speakerName.trim()]
          : [];
      })))
    : [];

const readNarrativeAudioLines = (value: unknown): unknown[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines = (value as Record<string, unknown>).lines;
  return Array.isArray(lines) ? lines : [];
};

/**
 * Compile duplicated execution selectors from the two semantic sources of
 * truth already authored by the agent.  This is a structural projection only:
 * it does not classify prose, infer aliases, or invent missing objects.
 */
export function projectBeatExecutionSelectors(
  beat: Record<string, unknown>,
): Record<string, unknown> {
  const contracts = readNamedObjectContracts(beat.assetObjectContracts);
  const namesOfKind = (kind: string): string[] =>
    Array.from(new Set(
      contracts.filter((contract) => contract.kind === kind).map((contract) => contract.name),
    ));
  const sceneNames = namesOfKind("scene");
  const requestedSceneName = typeof beat.sceneName === "string"
    ? beat.sceneName.trim()
    : "";
  const projected: Record<string, unknown> = {
    ...beat,
    characterRoleNames: namesOfKind("character"),
    speakerNames: Array.from(new Set([
      ...readDialogueSpeakerNames(beat.dialogueScript),
      ...readDialogueSpeakerNames(readNarrativeAudioLines(beat.narrativeAudioPlan)),
    ])),
    propNames: namesOfKind("prop"),
    vfxNames: namesOfKind("vfx"),
  };
  if (requestedSceneName && sceneNames.includes(requestedSceneName)) {
    projected.sceneName = requestedSceneName;
  } else if (sceneNames.length === 1) projected.sceneName = sceneNames[0];
  else delete projected.sceneName;
  return projected;
}

/**
 * Checks only the deterministic, self-contained shape of one durable beat node.
 * Cross-beat continuity, model duration options, assets and creative diagnostics
 * remain commit-time concerns because they require the assembled graph/header.
 */
export function validateBeatSheetDraftNode(
  beat: Record<string, unknown>,
  storyFactsContextValue: unknown,
  options: BeatSheetDraftNodeValidationOptions = {},
): string[] {
  const issues: string[] = [];
  if (typeof beat.logline !== "string" || beat.logline.trim().length === 0) {
    issues.push("logline 必须是非空字符串");
  }
  const durationBudget = Number(beat.durationBudget);
  if (!Number.isFinite(durationBudget) || durationBudget <= 0) {
    issues.push("durationBudget 必须是正数；这是 beat 总预算，不是 shots[].durationSeconds");
  }
  for (const field of ["characterRoleNames", "speakerNames", "propNames", "vfxNames", "videoReferenceNodeIds"] as const) {
    if (!isStringArray(beat[field]) && !(Array.isArray(beat[field]) && beat[field].length === 0)) {
      issues.push(`${field} 必须是字符串数组；没有条目时传 []`);
    }
  }
  if (Array.isArray(beat.speakerNames) && beat.speakerNames.length > 3) {
    issues.push("speakerNames 单 beat 最多 3 个说话人");
  }
  const speakerNames = Array.isArray(beat.speakerNames) ? beat.speakerNames : [];
  const dialogueScript = beat.dialogueScript;
  const narrativeAudioErrors: string[] = [];
  const narrativeAudioPlan = parseNarrativeAudioPlan(
    beat.narrativeAudioPlan,
    "narrativeAudioPlan",
    narrativeAudioErrors,
  );
  issues.push(...narrativeAudioErrors);
  if (!Array.isArray(dialogueScript)) {
    issues.push("dialogueScript 必填且必须是数组；无对白/OS/VO 时传 []");
  } else {
    const lineIds = new Set<string>();
    const dialogueSpeakers = new Set<string>(
      narrativeAudioPlan?.lines.map((line) => line.speakerName) ?? [],
    );
    dialogueScript.forEach((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        issues.push(`dialogueScript[${index}] 必须是对象`);
        return;
      }
      const record = line as Record<string, unknown>;
      for (const field of ["lineId", "speakerName", "text"] as const) {
        if (typeof record[field] !== "string" || !record[field].trim()) {
          issues.push(`dialogueScript[${index}].${field} 必须是非空字符串`);
        }
      }
      const lineId = typeof record.lineId === "string" ? record.lineId.trim() : "";
      if (lineId && lineIds.has(lineId)) issues.push(`dialogueScript[${index}].lineId 重复`);
      if (lineId) lineIds.add(lineId);
      const speakerName = typeof record.speakerName === "string" ? record.speakerName.trim() : "";
      if (speakerName) dialogueSpeakers.add(speakerName);
      if (record.delivery !== "on_screen" && record.delivery !== "off_screen" && record.delivery !== "voice_over") {
        issues.push(`dialogueScript[${index}].delivery 必须是 on_screen/off_screen/voice_over`);
      }
    });
    for (const line of narrativeAudioPlan?.lines ?? []) {
      if (lineIds.has(line.lineId)) {
        issues.push(`narrativeAudioPlan.lines 的 lineId=${line.lineId} 与 dialogueScript 重复`);
      }
    }
    const normalizedDialogue = dialogueScript.flatMap((line): Array<{
      lineId: string;
      speakerName: string;
      text: string;
      delivery: "on_screen" | "off_screen" | "voice_over";
    }> => {
      if (!line || typeof line !== "object" || Array.isArray(line)) return [];
      const record = line as Record<string, unknown>;
      const lineId = typeof record.lineId === "string" ? record.lineId.trim() : "";
      const speakerName = typeof record.speakerName === "string" ? record.speakerName.trim() : "";
      const text = typeof record.text === "string" ? record.text.trim() : "";
      const delivery = record.delivery;
      if (
        !lineId ||
        !speakerName ||
        !text ||
        (delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")
      ) return [];
      return [{ lineId, speakerName, text, delivery }];
    });
    validateNarrativeAudioPlacement(
      normalizedDialogue,
      narrativeAudioPlan,
      "narrativeAudioPlan",
      issues,
    );
    const canonicalSpeakers = new Set(
      speakerNames.filter((name): name is string => typeof name === "string").map((name) => name.trim()),
    );
    if (
      canonicalSpeakers.size !== dialogueSpeakers.size ||
      [...canonicalSpeakers].some((name) => !dialogueSpeakers.has(name))
    ) {
      issues.push("speakerNames 必须逐字等于 dialogueScript 与 narrativeAudioPlan.lines 的说话人集合");
    }
  }
  if (beat.storyFactLocks !== undefined) {
    const storyFactIssues: StoryboardDirectorV12ValidationIssue[] = [];
    const storyFactsContext = parseStoryFactsContext(
      storyFactsContextValue,
      "$.storyFactsContext",
      storyFactIssues,
    );
    if (storyFactsContext) {
      parseStoryFactLocks(beat.storyFactLocks, storyFactsContext, "$.storyFactLocks", storyFactIssues);
    }
    issues.push(...storyFactIssues.map((issue) => `${issue.path}：${issue.message}`));
  }
  if (typeof beat.continuityMode !== "string" || !CONTINUITY_MODES.has(beat.continuityMode)) {
    issues.push("continuityMode 必须是 editorial_cut、bridge_frames 或 reference_video");
  }
  issues.push(
    ...parseBeatTemporalContext(beat.temporalContext).errors,
    ...parseBeatSceneState(beat.sceneState).errors,
    ...parseBeatCharacterStateVersions(beat.characterStateVersions).errors,
    ...parseBeatContinuityLedger(beat.continuityLedger).errors,
    ...parseBeatVisualStateRefs(beat.visualStateRefs).errors,
  );

  const generationContract = options.generationContract;
  if (
    generationContract &&
    !generationContract.durationOptions.includes(durationBudget)
  ) {
    issues.push(
      `durationBudget 必须精确命中 generationContract.durationOptions=[${generationContract.durationOptions.join("/")}]s（收到 ${String(beat.durationBudget)}）`,
    );
  }

  const sceneName = typeof beat.sceneName === "string" ? beat.sceneName.trim() : "";
  const objectBindings = validateBeatAssetObjectBindings({
    assetObjectContracts: beat.assetObjectContracts,
    characterRoleNames: readStringArray(beat.characterRoleNames),
    sceneName,
    propNames: readStringArray(beat.propNames),
    vfxNames: readStringArray(beat.vfxNames),
    allowMissingReferenceImageNodeIds: true,
  });
  issues.push(...objectBindings.errors);
  return issues;
}
