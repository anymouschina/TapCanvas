export type StoryboardPurposeLayer = {
  dramaticBeat: string;
  storyPurpose: string;
  beatRole?: "opening" | "escalation" | "payoff";
  emotionalShift?: string;
  escalation?: string;
  continuity?: string;
  durationSec?: number;
  transitionHook?: string;
};

export type StoryboardRenderLayer = {
  promptText: string;
  subjectAction?: string;
  shotType?: string;
  cameraMovement?: string;
  perspective?: string;
  subjects?: string[];
  environment?: string;
  timeLighting?: string;
  colorTone?: string;
  composition?: string;
  qualityTags?: string[];
};

export type StoryboardStructuredShot = {
  shotNo: number | null;
  purpose: StoryboardPurposeLayer;
  render: StoryboardRenderLayer;
};

export type StoryboardStructuredData = {
  version: "two_phase_v1";
  totalDurationSec?: number;
  pacingGoal?: string;
  progressionSummary?: string;
  continuityPlan?: string;
  shots: StoryboardStructuredShot[];
};

export type StoryboardShotDesign = {
  shotNo: number | null;
  purpose: StoryboardPurposeLayer;
  renderDirectives: Omit<StoryboardRenderLayer, "promptText"> & {
    promptText?: string;
  };
};

export type StoryboardShotDesignArtifact = {
  version: "shot_design_v1";
  pacingGoal?: string;
  progressionSummary?: string;
  continuityPlan?: string;
  totalDurationSec?: number;
  shots: StoryboardShotDesign[];
};

export type StoryboardMiniArcAssessment = {
  ok: boolean;
  reasons: string[];
  totalDurationSec: number;
  shotCount: number;
};

type StoryboardDirectorV11Shot = {
  shotId?: unknown;
  durationSec?: unknown;
  narrativeGoal?: unknown;
  subjectAnchors?: unknown;
  scene?: unknown;
  camera?: unknown;
  lighting?: unknown;
  actionChain?: unknown;
  composition?: unknown;
  dramaticBeat?: unknown;
  performance?: unknown;
  continuity?: unknown;
  continuityLocks?: unknown;
  failureRisks?: unknown;
  negativeConstraints?: unknown;
  prompt?: unknown;
};

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asTrimmedString(item);
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function asPositiveDuration(value: unknown): number | undefined {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.max(1, Math.min(15, Math.trunc(raw)));
}

function asBeatRole(value: unknown): StoryboardPurposeLayer["beatRole"] | undefined {
  const normalized = asTrimmedString(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "opening" || normalized === "setup" || normalized === "pressure") return "opening";
  if (
    normalized === "escalation" ||
    normalized === "turn" ||
    normalized === "midpoint" ||
    normalized === "complication"
  ) {
    return "escalation";
  }
  if (
    normalized === "payoff" ||
    normalized === "reveal" ||
    normalized === "landing" ||
    normalized === "resolution" ||
    normalized === "aftermath"
  ) {
    return "payoff";
  }
  return undefined;
}

function pickFirstString(record: LooseRecord | null, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const text = asTrimmedString(record[key]);
    if (text) return text;
  }
  return "";
}

function readShotNo(record: LooseRecord | null): number | null {
  if (!record) return null;
  const direct = Number(record.shotNo);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const label = pickFirstString(record, ["shot_number", "shotNumber"]);
  const match = label.match(/(\d{1,4})/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = asTrimmedString(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function stringifyStringList(value: unknown, limit: number): string {
  return uniqueStrings(asStringList(value, limit)).join("、");
}

function parseShotNoFromShotId(value: unknown): number | null {
  const text = asTrimmedString(value);
  if (!text) return null;
  const match = text.match(/(\d{1,4})/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function readPromptCn(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  return pickFirstString(record, ["cn", "enOptional"]);
}

export function derivePromptFromStructuredShot(shot: StoryboardStructuredShot): string {
  return asTrimmedString(shot?.render?.promptText);
}

function buildPromptTextFromRenderLayer(
  render: Omit<StoryboardRenderLayer, "promptText"> & { promptText?: string },
): string {
  const explicit = asTrimmedString(render.promptText);
  if (explicit) return explicit;
  return [
    render.perspective ? `${render.perspective}视角` : "",
    render.shotType || "",
    render.subjectAction || "",
    render.cameraMovement ? `镜头${render.cameraMovement}` : "",
    render.subjects?.length ? `主体：${render.subjects.join("、")}` : "",
    render.environment ? `环境：${render.environment}` : "",
    render.timeLighting ? `光线：${render.timeLighting}` : "",
    render.colorTone ? `色调：${render.colorTone}` : "",
    render.composition ? `构图：${render.composition}` : "",
    render.qualityTags?.length ? `质感：${render.qualityTags.join("、")}` : "",
  ]
    .map((item) => asTrimmedString(item))
    .filter(Boolean)
    .join("；");
}

function summarizeStoryboardDirectorV11Prompt(input: {
  globalStyle: LooseRecord | null;
  shot: LooseRecord | null;
}): string {
  const shot = input.shot;
  if (!shot) return "";
  const scene = asRecord(shot.scene);
  const camera = asRecord(shot.camera);
  const lighting = asRecord(shot.lighting);
  const composition = asRecord(shot.composition);
  const dramaticBeat = asRecord(shot.dramaticBeat);
  const performance = asRecord(shot.performance);
  const continuity = asRecord(shot.continuity);
  const continuityLocks = asRecord(shot.continuityLocks);
  const globalStyle = input.globalStyle;
  const promptCn = readPromptCn(shot.prompt);
  const actionChain = stringifyStringList(shot.actionChain, 6);
  const subjectAnchors = stringifyStringList(shot.subjectAnchors, 6);
  const environmentDetails = stringifyStringList(scene?.environmentDetails, 6);
  const identityLock = stringifyStringList(continuityLocks?.identityLock, 4);
  const propLock = stringifyStringList(continuityLocks?.propLock, 4);
  const spaceLock = stringifyStringList(continuityLocks?.spaceLock, 4);
  const lightLock = stringifyStringList(continuityLocks?.lightLock, 4);

  return uniqueStrings([
    promptCn,
    pickFirstString(shot, ["narrativeGoal"]) ? `叙事目标：${pickFirstString(shot, ["narrativeGoal"])}` : "",
    subjectAnchors ? `主体锚点：${subjectAnchors}` : "",
    scene
      ? [
          pickFirstString(scene, ["location"]) ? `地点：${pickFirstString(scene, ["location"])}` : "",
          pickFirstString(scene, ["timeOfDay"]) ? `时间：${pickFirstString(scene, ["timeOfDay"])}` : "",
          pickFirstString(scene, ["weather"]) ? `天气：${pickFirstString(scene, ["weather"])}` : "",
          environmentDetails ? `环境细节：${environmentDetails}` : "",
        ].filter(Boolean).join("；")
      : "",
    composition
      ? [
          pickFirstString(composition, ["foreground"]) ? `前景：${pickFirstString(composition, ["foreground"])}` : "",
          pickFirstString(composition, ["midground"]) ? `中景：${pickFirstString(composition, ["midground"])}` : "",
          pickFirstString(composition, ["background"]) ? `背景：${pickFirstString(composition, ["background"])}` : "",
          pickFirstString(composition, ["spatialRule"]) ? `空间规则：${pickFirstString(composition, ["spatialRule"])}` : "",
        ].filter(Boolean).join("；")
      : "",
    camera
      ? [
          pickFirstString(camera, ["shotSize"]) ? `景别：${pickFirstString(camera, ["shotSize"])}` : "",
          pickFirstString(camera, ["angle"]) ? `机位角度：${pickFirstString(camera, ["angle"])}` : "",
          pickFirstString(camera, ["height"]) ? `镜头高度：${pickFirstString(camera, ["height"])}` : "",
          typeof camera.lensMm === "number" ? `焦段：${Math.trunc(Number(camera.lensMm))}mm` : "",
          pickFirstString(camera, ["movement"]) ? `镜头运动：${pickFirstString(camera, ["movement"])}` : "",
          pickFirstString(camera, ["focusTarget"]) ? `焦点主体：${pickFirstString(camera, ["focusTarget"])}` : "",
        ].filter(Boolean).join("；")
      : "",
    lighting
      ? [
          pickFirstString(lighting, ["keyDirection"]) ? `主光方向：${pickFirstString(lighting, ["keyDirection"])}` : "",
          typeof lighting.keyAngleDeg === "number" ? `主光角度：${Number(lighting.keyAngleDeg)}度` : "",
          typeof lighting.colorTempK === "number" ? `色温：${Math.trunc(Number(lighting.colorTempK))}K` : "",
          pickFirstString(lighting, ["contrastRatio"]) ? `光比：${pickFirstString(lighting, ["contrastRatio"])}` : "",
          pickFirstString(lighting, ["fillStyle"]) ? `补光：${pickFirstString(lighting, ["fillStyle"])}` : "",
          pickFirstString(lighting, ["rimLight"]) ? `轮廓光：${pickFirstString(lighting, ["rimLight"])}` : "",
        ].filter(Boolean).join("；")
      : "",
    actionChain ? `动作链：${actionChain}` : "",
    dramaticBeat
      ? [
          pickFirstString(dramaticBeat, ["before"]) ? `前态：${pickFirstString(dramaticBeat, ["before"])}` : "",
          pickFirstString(dramaticBeat, ["during"]) ? `当下动作：${pickFirstString(dramaticBeat, ["during"])}` : "",
          pickFirstString(dramaticBeat, ["after"]) ? `结果：${pickFirstString(dramaticBeat, ["after"])}` : "",
        ].filter(Boolean).join("；")
      : "",
    performance
      ? [
          pickFirstString(performance, ["emotion"]) ? `情绪：${pickFirstString(performance, ["emotion"])}` : "",
          pickFirstString(performance, ["microExpression"]) ? `微表情：${pickFirstString(performance, ["microExpression"])}` : "",
          pickFirstString(performance, ["bodyLanguage"]) ? `肢体语言：${pickFirstString(performance, ["bodyLanguage"])}` : "",
        ].filter(Boolean).join("；")
      : "",
    continuity
      ? [
          pickFirstString(continuity, ["fromPrev"]) ? `承接上镜：${pickFirstString(continuity, ["fromPrev"])}` : "",
          stringifyStringList(continuity.persistentAnchors, 5)
            ? `连续锚点：${stringifyStringList(continuity.persistentAnchors, 5)}`
            : "",
          stringifyStringList(continuity.forbiddenDrifts, 5)
            ? `禁止漂移：${stringifyStringList(continuity.forbiddenDrifts, 5)}`
            : "",
        ].filter(Boolean).join("；")
      : "",
    [identityLock ? `身份锁：${identityLock}` : "", propLock ? `道具锁：${propLock}` : "", spaceLock ? `空间锁：${spaceLock}` : "", lightLock ? `光线锁：${lightLock}` : ""]
      .filter(Boolean)
      .join("；"),
    pickFirstString(globalStyle, ["genre"]) ? `风格类型：${pickFirstString(globalStyle, ["genre"])}` : "",
    pickFirstString(globalStyle, ["visualTone"]) ? `视觉基调：${pickFirstString(globalStyle, ["visualTone"])}` : "",
    pickFirstString(globalStyle, ["palette"]) ? `色彩方案：${pickFirstString(globalStyle, ["palette"])}` : "",
    stringifyStringList(shot.negativeConstraints, 6) ? `禁止项：${stringifyStringList(shot.negativeConstraints, 6)}` : "",
    stringifyStringList(shot.failureRisks, 4) ? `风险预警：${stringifyStringList(shot.failureRisks, 4)}` : "",
  ]).join("；");
}

function adaptStoryboardDirectorV11ToStructuredData(value: unknown): StoryboardStructuredData | null {
  const record = asRecord(value);
  if (!record || asTrimmedString(record.schemaVersion) !== "storyboard-director/v1.1") return null;
  const globalStyle = asRecord(record.globalStyle);
  const rawShots = Array.isArray(record.shots) ? record.shots : [];
  const shots: StoryboardStructuredShot[] = [];
  for (const rawShot of rawShots) {
    const shotRecord = asRecord(rawShot as StoryboardDirectorV11Shot);
    if (!shotRecord) continue;
    const scene = asRecord(shotRecord.scene);
    const camera = asRecord(shotRecord.camera);
    const lighting = asRecord(shotRecord.lighting);
    const dramaticBeat = asRecord(shotRecord.dramaticBeat);
    const continuity = asRecord(shotRecord.continuity);
    const promptText = summarizeStoryboardDirectorV11Prompt({ globalStyle, shot: shotRecord });
    if (!promptText) continue;
    shots.push({
      shotNo: parseShotNoFromShotId(shotRecord.shotId),
      purpose: {
        dramaticBeat:
          [
            pickFirstString(dramaticBeat, ["before"]),
            pickFirstString(dramaticBeat, ["during"]),
            pickFirstString(dramaticBeat, ["after"]),
          ].filter(Boolean).join(" -> ") || pickFirstString(shotRecord, ["narrativeGoal"]) || "剧情推进",
        storyPurpose: pickFirstString(shotRecord, ["narrativeGoal"]) || "建立当前镜头的剧情意图与冲突推进",
        ...(pickFirstString(continuity, ["fromPrev"]) ? { continuity: pickFirstString(continuity, ["fromPrev"]) } : null),
        ...(asPositiveDuration(shotRecord.durationSec) ? { durationSec: asPositiveDuration(shotRecord.durationSec) } : null),
      },
      render: {
        promptText,
        ...(stringifyStringList(shotRecord.actionChain, 6) ? { subjectAction: stringifyStringList(shotRecord.actionChain, 6) } : null),
        ...(pickFirstString(camera, ["shotSize"]) ? { shotType: pickFirstString(camera, ["shotSize"]) } : null),
        ...(pickFirstString(camera, ["movement"]) ? { cameraMovement: pickFirstString(camera, ["movement"]) } : null),
        ...(pickFirstString(camera, ["angle"]) ? { perspective: pickFirstString(camera, ["angle"]) } : null),
        ...(scene
          ? {
              environment: [
                pickFirstString(scene, ["location"]),
                pickFirstString(scene, ["timeOfDay"]),
                pickFirstString(scene, ["weather"]),
              ].filter(Boolean).join(" / "),
            }
          : null),
        ...(lighting
          ? {
              timeLighting: [
                pickFirstString(scene, ["timeOfDay"]),
                pickFirstString(lighting, ["keyDirection"]),
                typeof lighting.colorTempK === "number" ? `${Math.trunc(Number(lighting.colorTempK))}K` : "",
              ].filter(Boolean).join(" / "),
            }
          : null),
        ...(pickFirstString(globalStyle, ["palette"]) ? { colorTone: pickFirstString(globalStyle, ["palette"]) } : null),
        ...(pickFirstString(globalStyle, ["genre"]) || pickFirstString(globalStyle, ["visualTone"])
          ? { qualityTags: uniqueStrings([pickFirstString(globalStyle, ["genre"]), pickFirstString(globalStyle, ["visualTone"])]) }
          : null),
      },
    });
  }
  if (!shots.length) return null;
  const totalDurationSec = shots.reduce((sum, shot) => sum + (shot.purpose.durationSec ?? 0), 0);
  return {
    version: "two_phase_v1",
    ...(totalDurationSec > 0 ? { totalDurationSec } : null),
    ...(pickFirstString(globalStyle, ["visualTone"]) ? { pacingGoal: pickFirstString(globalStyle, ["visualTone"]) } : null),
    ...(pickFirstString(globalStyle, ["genre"]) ? { progressionSummary: pickFirstString(globalStyle, ["genre"]) } : null),
    ...(shots.some((shot) => shot.purpose.continuity)
      ? { continuityPlan: shots.map((shot) => shot.purpose.continuity || "").filter(Boolean).slice(0, 4).join(" | ") }
      : null),
    shots,
  };
}

export function normalizeStoryboardShotDesignArtifact(value: unknown): StoryboardShotDesignArtifact | null {
  const record = asRecord(value);
  if (!record) return null;
  const rawShots = Array.isArray(record.shots) ? record.shots : [];
  const shots: StoryboardShotDesign[] = [];
  for (const rawShot of rawShots) {
    const shotRecord = asRecord(rawShot);
    if (!shotRecord) continue;
    const purposeRecord = asRecord(shotRecord.purpose) ?? shotRecord;
    const renderRecord = asRecord(shotRecord.renderDirectives) ?? asRecord(shotRecord.render) ?? shotRecord;
    const renderDirectives = {
      ...(pickFirstString(renderRecord, ["promptText", "prompt_text", "render_prompt"])
        ? { promptText: pickFirstString(renderRecord, ["promptText", "prompt_text", "render_prompt"]) }
        : null),
      ...(pickFirstString(renderRecord, ["subjectAction", "subject_action"])
        ? { subjectAction: pickFirstString(renderRecord, ["subjectAction", "subject_action"]) }
        : null),
      ...(pickFirstString(renderRecord, ["shotType", "shot_type"])
        ? { shotType: pickFirstString(renderRecord, ["shotType", "shot_type"]) }
        : null),
      ...(pickFirstString(renderRecord, ["cameraMovement", "camera_movement"])
        ? { cameraMovement: pickFirstString(renderRecord, ["cameraMovement", "camera_movement"]) }
        : null),
      ...(pickFirstString(renderRecord, ["perspective"])
        ? { perspective: pickFirstString(renderRecord, ["perspective"]) }
        : null),
      ...(pickFirstString(renderRecord, ["environment"])
        ? { environment: pickFirstString(renderRecord, ["environment"]) }
        : null),
      ...(pickFirstString(renderRecord, ["timeLighting", "time_lighting"])
        ? { timeLighting: pickFirstString(renderRecord, ["timeLighting", "time_lighting"]) }
        : null),
      ...(pickFirstString(renderRecord, ["colorTone", "color_tone"])
        ? { colorTone: pickFirstString(renderRecord, ["colorTone", "color_tone"]) }
        : null),
      ...(pickFirstString(renderRecord, ["composition"])
        ? { composition: pickFirstString(renderRecord, ["composition"]) }
        : null),
      ...(asStringList(renderRecord.subjects, 8).length
        ? { subjects: asStringList(renderRecord.subjects, 8) }
        : null),
      ...(asStringList(renderRecord.qualityTags ?? renderRecord.quality_tags, 8).length
        ? { qualityTags: asStringList(renderRecord.qualityTags ?? renderRecord.quality_tags, 8) }
        : null),
    };
    if (!buildPromptTextFromRenderLayer(renderDirectives)) continue;
    shots.push({
      shotNo: readShotNo(shotRecord),
      purpose: {
        dramaticBeat: pickFirstString(purposeRecord, ["dramaticBeat", "dramatic_beat"]) || "剧情推进",
        storyPurpose:
          pickFirstString(purposeRecord, ["storyPurpose", "story_purpose"]) || "建立当前镜头的剧情意图与冲突推进",
        ...(asBeatRole(purposeRecord.beatRole ?? purposeRecord.beat_role)
          ? { beatRole: asBeatRole(purposeRecord.beatRole ?? purposeRecord.beat_role) }
          : null),
        ...(pickFirstString(purposeRecord, ["emotionalShift", "emotional_shift"])
          ? { emotionalShift: pickFirstString(purposeRecord, ["emotionalShift", "emotional_shift"]) }
          : null),
        ...(pickFirstString(purposeRecord, ["escalation", "stakes"])
          ? { escalation: pickFirstString(purposeRecord, ["escalation", "stakes"]) }
          : null),
        ...(pickFirstString(purposeRecord, ["continuity", "continuityNote", "continuity_note"])
          ? { continuity: pickFirstString(purposeRecord, ["continuity", "continuityNote", "continuity_note"]) }
          : null),
        ...(asPositiveDuration(purposeRecord.durationSec ?? purposeRecord.duration_sec)
          ? { durationSec: asPositiveDuration(purposeRecord.durationSec ?? purposeRecord.duration_sec) }
          : null),
        ...(pickFirstString(purposeRecord, ["transitionHook", "transition_hook"])
          ? { transitionHook: pickFirstString(purposeRecord, ["transitionHook", "transition_hook"]) }
          : null),
      },
      renderDirectives,
    });
    if (shots.length >= 128) break;
  }
  if (!shots.length) return null;
  const totalDurationSec = shots.reduce((sum, shot) => sum + (shot.purpose.durationSec ?? 0), 0);
  return {
    version: "shot_design_v1",
    ...(totalDurationSec > 0 ? { totalDurationSec } : null),
    ...(asTrimmedString(record.pacingGoal) ? { pacingGoal: asTrimmedString(record.pacingGoal) } : null),
    ...(asTrimmedString(record.progressionSummary)
      ? { progressionSummary: asTrimmedString(record.progressionSummary) }
      : null),
    ...(asTrimmedString(record.continuityPlan) ? { continuityPlan: asTrimmedString(record.continuityPlan) } : null),
    shots,
  };
}

export function adaptStoryboardShotDesignToStructuredData(value: unknown): StoryboardStructuredData | null {
  const design = normalizeStoryboardShotDesignArtifact(value);
  if (!design) return null;
  return {
    version: "two_phase_v1",
    ...(typeof design.totalDurationSec === "number" && design.totalDurationSec > 0
      ? { totalDurationSec: design.totalDurationSec }
      : null),
    ...(design.pacingGoal ? { pacingGoal: design.pacingGoal } : null),
    ...(design.progressionSummary ? { progressionSummary: design.progressionSummary } : null),
    ...(design.continuityPlan ? { continuityPlan: design.continuityPlan } : null),
    shots: design.shots.map((shot) => ({
      shotNo: shot.shotNo,
      purpose: shot.purpose,
      render: {
        ...shot.renderDirectives,
        promptText: buildPromptTextFromRenderLayer(shot.renderDirectives),
      },
    })),
  };
}

export function normalizeStoryboardStructuredData(value: unknown): StoryboardStructuredData | null {
  return adaptStoryboardDirectorV11ToStructuredData(value) ?? adaptStoryboardShotDesignToStructuredData(value);
}

export function assessStoryboardMiniArc(value: unknown): StoryboardMiniArcAssessment {
  const structured = normalizeStoryboardStructuredData(value);
  if (!structured) {
    return {
      ok: false,
      reasons: ["missing_structured_storyboard"],
      totalDurationSec: 0,
      shotCount: 0,
    };
  }
  const shotCount = structured.shots.length;
  const totalDurationSec = structured.shots.reduce((sum, shot) => sum + (shot.purpose.durationSec ?? 0), 0);
  const reasons: string[] = [];
  if (shotCount < 2) reasons.push("mini_arc_requires_at_least_2_shots");
  if (shotCount > 5) reasons.push("mini_arc_prefers_max_5_shots");
  if (totalDurationSec > 0 && totalDurationSec < 7) reasons.push("mini_arc_total_duration_too_short");
  if (totalDurationSec > 15) reasons.push("mini_arc_total_duration_too_long");

  const roles = structured.shots.map((shot) => shot.purpose.beatRole);
  if (!roles[0] || roles[0] !== "opening") reasons.push("mini_arc_missing_opening_setup");
  if (!roles[roles.length - 1] || roles[roles.length - 1] !== "payoff") {
    reasons.push("mini_arc_missing_payoff_landing");
  }
  const middleRoles = roles.slice(1, -1);
  if (!middleRoles.some((role) => role === "escalation")) reasons.push("mini_arc_missing_escalation_turn");

  const progressionTexts = structured.shots.map((shot) =>
    [shot.purpose.dramaticBeat, shot.purpose.storyPurpose, shot.purpose.transitionHook || ""]
      .filter(Boolean)
      .join(" | "),
  );
  const uniqueProgressionCount = new Set(progressionTexts).size;
  if (uniqueProgressionCount < Math.min(shotCount, 3)) reasons.push("mini_arc_progression_not_distinct");

  return {
    ok: reasons.length === 0,
    reasons,
    totalDurationSec,
    shotCount,
  };
}

export function deriveShotPromptsFromStructuredData(value: unknown): string[] {
  const structured = normalizeStoryboardStructuredData(value);
  if (!structured) return [];
  return structured.shots.map(derivePromptFromStructuredShot).filter(Boolean);
}
