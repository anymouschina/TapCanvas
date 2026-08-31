import { validateStoryboardDirectorV12Contract } from "./contract";
import {
  STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
  type StoryboardPurposeLayer,
  type StoryboardRenderLayer,
  type StoryboardStoryFactLocks,
  type StoryboardStructuredData,
  type StoryboardStructuredShot,
} from "./types";

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
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function asBeatRole(value: unknown): StoryboardPurposeLayer["beatRole"] | undefined {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === "opening" || normalized === "escalation" || normalized === "payoff") return normalized;
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

function parseShotNoFromShotId(value: unknown): number | null {
  const text = asTrimmedString(value);
  if (!text) return null;
  const match = text.match(/(\d{1,4})/);
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

function readPromptCn(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  return pickFirstString(record, ["cn", "enOptional"]);
}

export function derivePromptFromStructuredShot(shot: StoryboardStructuredShot): string {
  return asTrimmedString(shot?.render?.promptText);
}

function summarizeVisibleStoryFactLocks(locks: StoryboardStoryFactLocks): string[] {
  const objectiveDirectives: string[] = [];
  const viewpointDirectives: string[] = [];
  for (const binding of locks.bindings) {
    if (binding.visibility === "hidden") continue;
    const directive = `${binding.category}：${binding.directive}`;
    if (binding.visibility === "objective") objectiveDirectives.push(directive);
    else viewpointDirectives.push(directive);
  }
  return [
    objectiveDirectives.length > 0 ? `客观事实锁：${uniqueStrings(objectiveDirectives).join("、")}` : "",
    viewpointDirectives.length > 0 ? `视角认知锁：${uniqueStrings(viewpointDirectives).join("、")}` : "",
    locks.revealGuards.length > 0
      ? "叙事保密锁：不得添加未授权的身份、关系或真相信息；不得通过画面暗示、对白、字幕、闪回、道具、背景或声音泄露隐藏事实"
      : "",
  ].filter(Boolean);
}

function summarizeStoryboardDirectorV12Prompt(input: {
  globalStyle: LooseRecord;
  shot: LooseRecord;
  exitState: string;
  storyFactLocks: StoryboardStoryFactLocks;
}): string {
  const shot = input.shot;
  const scene = asRecord(shot.scene);
  const camera = asRecord(shot.camera);
  const lighting = asRecord(shot.lighting);
  const composition = asRecord(shot.composition);
  const dramaticBeat = asRecord(shot.dramaticBeat);
  const performance = asRecord(shot.performance);
  const continuity = asRecord(shot.continuity);
  const continuityLocks = asRecord(shot.continuityLocks);
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
        ]
          .filter(Boolean)
          .join("；")
      : "",
    composition
      ? [
          pickFirstString(composition, ["foreground"]) ? `前景：${pickFirstString(composition, ["foreground"])}` : "",
          pickFirstString(composition, ["midground"]) ? `中景：${pickFirstString(composition, ["midground"])}` : "",
          pickFirstString(composition, ["background"]) ? `背景：${pickFirstString(composition, ["background"])}` : "",
          pickFirstString(composition, ["spatialRule"]) ? `空间规则：${pickFirstString(composition, ["spatialRule"])}` : "",
        ]
          .filter(Boolean)
          .join("；")
      : "",
    camera
      ? [
          pickFirstString(camera, ["shotSize"]) ? `景别：${pickFirstString(camera, ["shotSize"])}` : "",
          pickFirstString(camera, ["angle"]) ? `机位角度：${pickFirstString(camera, ["angle"])}` : "",
          pickFirstString(camera, ["height"]) ? `镜头高度：${pickFirstString(camera, ["height"])}` : "",
          typeof camera.lensMm === "number" ? `焦段：${Math.trunc(camera.lensMm)}mm` : "",
          pickFirstString(camera, ["movement"]) ? `镜头运动：${pickFirstString(camera, ["movement"])}` : "",
          pickFirstString(camera, ["focusTarget"]) ? `焦点主体：${pickFirstString(camera, ["focusTarget"])}` : "",
        ]
          .filter(Boolean)
          .join("；")
      : "",
    lighting
      ? [
          pickFirstString(lighting, ["keyDirection"]) ? `主光方向：${pickFirstString(lighting, ["keyDirection"])}` : "",
          typeof lighting.keyAngleDeg === "number" ? `主光角度：${lighting.keyAngleDeg}度` : "",
          typeof lighting.colorTempK === "number" ? `色温：${Math.trunc(lighting.colorTempK)}K` : "",
          pickFirstString(lighting, ["contrastRatio"]) ? `光比：${pickFirstString(lighting, ["contrastRatio"])}` : "",
          pickFirstString(lighting, ["fillStyle"]) ? `补光：${pickFirstString(lighting, ["fillStyle"])}` : "",
          pickFirstString(lighting, ["rimLight"]) ? `轮廓光：${pickFirstString(lighting, ["rimLight"])}` : "",
        ]
          .filter(Boolean)
          .join("；")
      : "",
    actionChain ? `动作链：${actionChain}` : "",
    dramaticBeat
      ? [
          pickFirstString(dramaticBeat, ["before"]) ? `前态：${pickFirstString(dramaticBeat, ["before"])}` : "",
          pickFirstString(dramaticBeat, ["during"]) ? `当下动作：${pickFirstString(dramaticBeat, ["during"])}` : "",
          pickFirstString(dramaticBeat, ["after"]) ? `结果：${pickFirstString(dramaticBeat, ["after"])}` : "",
        ]
          .filter(Boolean)
          .join("；")
      : "",
    performance
      ? [
          pickFirstString(performance, ["emotion"]) ? `情绪：${pickFirstString(performance, ["emotion"])}` : "",
          pickFirstString(performance, ["microExpression"])
            ? `微表情：${pickFirstString(performance, ["microExpression"])}`
            : "",
          pickFirstString(performance, ["bodyLanguage"]) ? `肢体语言：${pickFirstString(performance, ["bodyLanguage"])}` : "",
        ]
          .filter(Boolean)
          .join("；")
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
        ]
          .filter(Boolean)
          .join("；")
      : "",
    [
      identityLock ? `身份锁：${identityLock}` : "",
      propLock ? `道具锁：${propLock}` : "",
      spaceLock ? `空间锁：${spaceLock}` : "",
      lightLock ? `光线锁：${lightLock}` : "",
    ]
      .filter(Boolean)
      .join("；"),
    ...summarizeVisibleStoryFactLocks(input.storyFactLocks),
    input.exitState ? `镜尾客观状态：${input.exitState}` : "",
    pickFirstString(input.globalStyle, ["genre"]) ? `风格类型：${pickFirstString(input.globalStyle, ["genre"])}` : "",
    pickFirstString(input.globalStyle, ["visualTone"])
      ? `视觉基调：${pickFirstString(input.globalStyle, ["visualTone"])}`
      : "",
    pickFirstString(input.globalStyle, ["palette"]) ? `色彩方案：${pickFirstString(input.globalStyle, ["palette"])}` : "",
    stringifyStringList(shot.negativeConstraints, 6)
      ? `禁止项：${stringifyStringList(shot.negativeConstraints, 6)}`
      : "",
    stringifyStringList(shot.failureRisks, 4) ? `风险预警：${stringifyStringList(shot.failureRisks, 4)}` : "",
  ]).join("；");
}

export function adaptStoryboardDirectorV12ToStructuredData(value: unknown): StoryboardStructuredData | null {
  const validation = validateStoryboardDirectorV12Contract(value);
  if (!validation.ok) return null;
  const { globalStyle, storyFactsContext } = validation.value;
  const shots: StoryboardStructuredShot[] = validation.value.shots.map((validatedShot) => {
    const shotRecord = validatedShot.record;
    const scene = asRecord(shotRecord.scene);
    const camera = asRecord(shotRecord.camera);
    const lighting = asRecord(shotRecord.lighting);
    const dramaticBeat = asRecord(shotRecord.dramaticBeat);
    const continuity = asRecord(shotRecord.continuity);
    const narrativeGoal = pickFirstString(shotRecord, ["narrativeGoal"]);
    const dramaticBeatText = [
      pickFirstString(dramaticBeat, ["before"]),
      pickFirstString(dramaticBeat, ["during"]),
      pickFirstString(dramaticBeat, ["after"]),
    ]
      .filter(Boolean)
      .join(" -> ");
    const promptText = summarizeStoryboardDirectorV12Prompt({
      globalStyle,
      shot: shotRecord,
      exitState: validatedShot.exitState,
      storyFactLocks: validatedShot.storyFactLocks,
    });
    return {
      shotNo: parseShotNoFromShotId(validatedShot.shotId),
      sourceShotId: validatedShot.shotId,
      exitState: validatedShot.exitState,
      storyFactLocks: validatedShot.storyFactLocks,
      purpose: {
        dramaticBeat: dramaticBeatText,
        storyPurpose: narrativeGoal,
        ...(asBeatRole(shotRecord.beatRole) ? { beatRole: asBeatRole(shotRecord.beatRole) } : null),
        continuity: validatedShot.continuityFromPrev,
        transitionHook: validatedShot.exitState,
        ...(asPositiveDuration(shotRecord.durationSec) ? { durationSec: asPositiveDuration(shotRecord.durationSec) } : null),
      },
      render: {
        promptText,
        ...(stringifyStringList(shotRecord.actionChain, 6)
          ? { subjectAction: stringifyStringList(shotRecord.actionChain, 6) }
          : null),
        ...(pickFirstString(camera, ["shotSize"]) ? { shotType: pickFirstString(camera, ["shotSize"]) } : null),
        ...(pickFirstString(camera, ["movement"])
          ? { cameraMovement: pickFirstString(camera, ["movement"]) }
          : null),
        ...(pickFirstString(camera, ["angle"]) ? { perspective: pickFirstString(camera, ["angle"]) } : null),
        ...(scene
          ? {
              environment: [
                pickFirstString(scene, ["location"]),
                pickFirstString(scene, ["timeOfDay"]),
                pickFirstString(scene, ["weather"]),
              ]
                .filter(Boolean)
                .join(" / "),
            }
          : null),
        ...(lighting
          ? {
              timeLighting: [
                pickFirstString(scene, ["timeOfDay"]),
                pickFirstString(lighting, ["keyDirection"]),
                typeof lighting.colorTempK === "number" ? `${Math.trunc(lighting.colorTempK)}K` : "",
              ]
                .filter(Boolean)
                .join(" / "),
            }
          : null),
        ...(pickFirstString(globalStyle, ["palette"])
          ? { colorTone: pickFirstString(globalStyle, ["palette"]) }
          : null),
        ...(pickFirstString(globalStyle, ["genre"]) || pickFirstString(globalStyle, ["visualTone"])
          ? {
              qualityTags: uniqueStrings([
                pickFirstString(globalStyle, ["genre"]),
                pickFirstString(globalStyle, ["visualTone"]),
              ]),
            }
          : null),
      },
    };
  });
  const totalDurationSec = shots.reduce((sum, shot) => sum + (shot.purpose.durationSec ?? 0), 0);
  return {
    version: "two_phase_v1",
    sourceSchemaVersion: STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
    storyFactsContext,
    ...(totalDurationSec > 0 ? { totalDurationSec } : null),
    ...(pickFirstString(globalStyle, ["visualTone"]) ? { pacingGoal: pickFirstString(globalStyle, ["visualTone"]) } : null),
    ...(pickFirstString(globalStyle, ["genre"])
      ? { progressionSummary: pickFirstString(globalStyle, ["genre"]) }
      : null),
    continuityPlan: shots.map((shot) => shot.exitState || "").filter(Boolean).join(" | "),
    shots,
  };
}

export function normalizeStoryboardStructuredData(value: unknown): StoryboardStructuredData | null {
  return adaptStoryboardDirectorV12ToStructuredData(value);
}

function readStoryboardStructuredProjection(value: unknown): StoryboardStructuredData | null {
  const record = asRecord(value);
  if (
    record?.version !== "two_phase_v1" ||
    record.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION ||
    !Array.isArray(record.shots) ||
    record.shots.length === 0
  ) {
    return null;
  }
  for (const shot of record.shots) {
    const shotRecord = asRecord(shot);
    const purpose = asRecord(shotRecord?.purpose);
    const render = asRecord(shotRecord?.render);
    if (
      !shotRecord ||
      !purpose ||
      !render ||
      !asTrimmedString(purpose.dramaticBeat) ||
      !asTrimmedString(purpose.storyPurpose) ||
      !asTrimmedString(render.promptText)
    ) {
      return null;
    }
  }
  return value as StoryboardStructuredData;
}

export function deriveShotPromptsFromStructuredData(value: unknown): string[] {
  const structured = readStoryboardStructuredProjection(value) ?? normalizeStoryboardStructuredData(value);
  if (!structured) return [];
  return structured.shots.map(derivePromptFromStructuredShot).filter(Boolean);
}

export function summarizeStoryboardStructuredData(value: unknown): string {
  const structured = readStoryboardStructuredProjection(value) ?? normalizeStoryboardStructuredData(value);
  if (!structured) return "";
  const first = structured.shots[0];
  const last = structured.shots[structured.shots.length - 1];
  return [
    structured.pacingGoal || "",
    first?.purpose?.dramaticBeat ? `起点：${first.purpose.dramaticBeat}` : "",
    last?.purpose?.dramaticBeat ? `落点：${last.purpose.dramaticBeat}` : "",
    last?.exitState ? `退出态：${last.exitState}` : "",
    structured.continuityPlan || "",
  ]
    .filter(Boolean)
    .join(" | ");
}
