import { chapterAssetPlanSchema } from './schema.mjs';

/**
 * 章节资产的「大纲 → 逐对象并行 → 汇总」扇出契约。
 *
 * 动机（2026-10-01 实测）：单个资产作者一次写整份登记表，耗时 10.2–28.7 min，波动来自偶发的超长思考
 * 调用（一次 3.5 万 token/243s，而登记表只有约 1 万字符）。真实原文 + 真实 schema 的探针里，
 * 大纲 1 次调用 20s，18 个对象并行各写一个：墙钟 38.5s、18/18 合法。
 *
 * 约束：
 * - 大纲作者必须看到章节序列：没有序列时它会过度规划（9→14~18 个对象），序列起范围限定作用。
 * - 对象身份（objectId）由宿主分配，作者不发明；逐对象作者的 schema 把 objectId/kind/name 钉死。
 * - 汇总后整份产物仍按原 chapterAssetPlanSchema 完整校验，下游消费者无感知。
 *
 * v2（2026-10-06）：每章必有的资产由大纲的「结构槽位」承载，不靠作者自行想起。
 * v1 只有一个 objects 列表，色彩锚点、回忆地点都要作者主动登记；拆成扇出后大纲作者按「宁少勿多」
 * 只列角色/主场景/道具，色卡从 10-01 起整体消失，回忆地点只有底图没有场景对象。
 * - palette：恰好一个本章色彩与光影锚点（必填槽位，不能省略）。
 * - scenes：每个实际出现的地点（含回忆/闪回）一个场景对象，空场背景底图嵌在所属场景下，
 *   因此不存在「有底图、无场景」的地点。
 * - objects：其余 kind（角色/道具/特效/群像），按影片需要列出。
 * 新增 registry kind 时必须在这里给出槽位，测试会检查每个 kind 都能从大纲产出。
 */

export const CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE = 'tapcanvas.chapter-asset-outline/v2';
export const CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE = 'tapcanvas.chapter-asset-seeds/v1';
export const CHAPTER_ASSET_PART_ARTIFACT_TYPE = 'tapcanvas.chapter-asset-part/v1';
export const CHAPTER_ASSET_PLAN_ARTIFACT_TYPE = 'tapcanvas.chapter-asset-plan/v3';

export const CHAPTER_ASSET_OBJECT_KINDS = Object.freeze(['character', 'scene', 'prop', 'vfx', 'palette', 'composition']);
/** 大纲 objects 列表可用的 kind；palette 与 scene 各有专属槽位。 */
export const CHAPTER_ASSET_OUTLINE_LISTED_KINDS = Object.freeze(CHAPTER_ASSET_OBJECT_KINDS.filter(kind => kind !== 'palette' && kind !== 'scene'));
/** 种子的 kind：登记对象沿用 registry 的 kind，背景底图为 'background'。 */
export const CHAPTER_ASSET_BACKGROUND_KIND = 'background';

const text = { type: 'string', minLength: 1 };
const namedBrief = (nameDescription, briefDescription) => ({
  type: 'object',
  properties: {
    name: { ...text, description: nameDescription },
    brief: { ...text, description: briefDescription },
  },
  required: ['name', 'brief'],
  additionalProperties: false,
});

export const chapterAssetOutlineSchema = {
  type: 'object',
  properties: {
    palette: {
      ...namedBrief(
        'Name of this chapter\'s color and lighting anchor, for example: 夏夜灯火武侠轻喜剧色彩锚点.',
        'One sentence: the chapter\'s dominant palette, light sources and contrast that every asset and clip of this chapter shares.',
      ),
      description: 'Exactly one color and lighting anchor for the whole chapter. It becomes a palette reference image that clips use for color only.',
    },
    scenes: {
      type: 'array',
      minItems: 1,
      description: 'One scene object per distinct location the film shows, including flashback or memory locations. Each scene lists its own empty-space base images.',
      items: {
        type: 'object',
        properties: {
          name: { ...text, description: 'Canonical Chinese location name exactly as the source or the chapter sequence names it.' },
          brief: { ...text, description: 'One sentence: what this location is and which events happen there.' },
          backgrounds: {
            type: 'array',
            minItems: 1,
            description: 'Empty-space base images (no characters) of this location: one per camera viewpoint the shots need, for example an overhead layout view and an eye-level view.',
            items: namedBrief(
              'Location and viewpoint, for example: 客栈门前长街·月夜俯视空场底图. Unique across the whole outline.',
              'One sentence: which events and shots use this base image.',
            ),
          },
        },
        required: ['name', 'brief', 'backgrounds'],
        additionalProperties: false,
      },
    },
    objects: {
      type: 'array',
      minItems: 0,
      description: 'Characters, props, visual effects and crowd compositions the film actually shows on screen, scoped by the chapter sequence events. Locations go in scenes, the color anchor goes in palette.',
      items: {
        type: 'object',
        properties: {
          name: { ...text, description: 'Canonical Chinese name exactly as the source or the chapter sequence names it.' },
          kind: { type: 'string', enum: [...CHAPTER_ASSET_OUTLINE_LISTED_KINDS] },
          brief: { ...text, description: 'One sentence: what this object is and why the film needs it (which events use it).' },
        },
        required: ['name', 'kind', 'brief'],
        additionalProperties: false,
      },
    },
  },
  required: ['palette', 'scenes', 'objects'],
  additionalProperties: false,
};

function fail(message) {
  throw new Error(`chapter-asset-fanout: ${message}`);
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 读取代理结果：{text: "<json>"} 或已解析对象。 */
export function readJsonArtifact(value, label) {
  const raw = isRecord(value) && typeof value.text === 'string' ? value.text : value;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readNamedBrief(entry, label) {
  if (!isRecord(entry)) fail(`${label} must be an object`);
  const { name, brief } = entry;
  if (typeof name !== 'string' || !name.trim()) fail(`${label}.name is required`);
  if (typeof brief !== 'string' || !brief.trim()) fail(`${label}.brief is required`);
  return { name, brief };
}

/**
 * 由大纲分配稳定的身份，按「色彩锚点 → 场景 → 其余对象」顺序编号 obj-NN，
 * 背景底图按所属场景顺序编号 bg-NN 并记录 sceneObjectId；同类名称必须唯一。
 */
export function seedsFromOutline(outlineValue) {
  const outline = readJsonArtifact(outlineValue, 'asset-outline');
  if (!isRecord(outline)) fail('asset-outline must be an object');
  if (!Array.isArray(outline.scenes) || outline.scenes.length === 0) fail('asset-outline.scenes must be a non-empty array');
  const listed = outline.objects ?? [];
  if (!Array.isArray(listed)) fail('asset-outline.objects must be an array');
  const palette = readNamedBrief(outline.palette, 'asset-outline.palette');
  const objectEntries = [
    { ...palette, kind: 'palette' },
    ...outline.scenes.map((scene, index) => ({ ...readNamedBrief(scene, `asset-outline.scenes[${index}]`), kind: 'scene', scene, index })),
    ...listed.map((entry, index) => {
      const { name, brief } = readNamedBrief(entry, `asset-outline.objects[${index}]`);
      if (!CHAPTER_ASSET_OUTLINE_LISTED_KINDS.includes(entry.kind)) {
        fail(`asset-outline.objects[${index}].kind must be one of ${CHAPTER_ASSET_OUTLINE_LISTED_KINDS.join('/')}`);
      }
      return { name, brief, kind: entry.kind };
    }),
  ];
  const names = new Set();
  const objects = objectEntries.map(({ name, brief, kind }, index) => {
    if (names.has(name)) fail(`asset-outline names must be unique: ${name}`);
    names.add(name);
    const objectId = `obj-${String(index + 1).padStart(2, '0')}`;
    return { outlineId: objectId, objectId, kind, name, brief };
  });
  const backgroundNames = new Set();
  const backgrounds = [];
  objectEntries.forEach((entry, entryIndex) => {
    if (entry.kind !== 'scene') return;
    const label = `asset-outline.scenes[${entry.index}].backgrounds`;
    if (!Array.isArray(entry.scene.backgrounds) || entry.scene.backgrounds.length === 0) fail(`${label} must be a non-empty array`);
    entry.scene.backgrounds.forEach((background, index) => {
      const { name, brief } = readNamedBrief(background, `${label}[${index}]`);
      if (backgroundNames.has(name)) fail(`asset-outline background names must be unique: ${name}`);
      backgroundNames.add(name);
      const objectId = `bg-${String(backgrounds.length + 1).padStart(2, '0')}`;
      backgrounds.push({ outlineId: objectId, objectId, kind: CHAPTER_ASSET_BACKGROUND_KIND, name, brief, sceneObjectId: objects[entryIndex].objectId });
    });
  });
  return [...objects, ...backgrounds];
}

/**
 * 逐项作者的 schema：整份 chapterAssetPlanSchema 的子集。
 * - 登记对象：恰好 1 个 objectRegistry 条目，objectId/kind/name 由宿主钉死；backgroundPlans 必须为空。
 * - 背景底图：objectRegistry 必须为空；恰好 1 个 backgroundPlans 条目，objectId 与 plan.assetId 由宿主钉死。
 */
export function bindChapterAssetPartSchema(seed) {
  const isBackground = isRecord(seed) && seed.kind === CHAPTER_ASSET_BACKGROUND_KIND;
  if (!isRecord(seed) || typeof seed.objectId !== 'string' || !seed.objectId
    || typeof seed.name !== 'string' || !seed.name
    || !(isBackground || CHAPTER_ASSET_OBJECT_KINDS.includes(seed.kind))) {
    fail('asset part requires one frozen seed with objectId, kind and name');
  }
  const schema = structuredClone(chapterAssetPlanSchema);
  const registry = schema.properties.objectRegistry;
  const background = schema.properties.backgroundPlans;
  if (isBackground) {
    registry.minItems = 0;
    registry.maxItems = 0;
    background.minItems = 1;
    background.maxItems = 1;
    const planItem = background.items;
    background.items = {
      ...planItem,
      properties: {
        ...planItem.properties,
        objectId: { const: seed.objectId },
        plan: { ...planItem.properties.plan, properties: { ...planItem.properties.plan.properties, assetId: { const: seed.objectId } } },
      },
    };
    schema.description = `Author exactly the background base image ${seed.objectId} ("${seed.name}") in backgroundPlans and leave objectRegistry empty.`;
  } else {
    registry.minItems = 1;
    registry.maxItems = 1;
    registry.items.allOf = [
      ...(registry.items.allOf ?? []),
      {
        type: 'object',
        properties: { objectId: { const: seed.objectId }, kind: { const: seed.kind }, name: { const: seed.name } },
        required: ['objectId', 'kind', 'name'],
      },
    ];
    background.minItems = 0;
    background.maxItems = 0;
    schema.description = `Author exactly the registry entry for ${seed.objectId} (${seed.kind} "${seed.name}"), leave backgroundPlans empty.`;
  }
  return schema;
}

/**
 * 汇总：按种子顺序拼接登记对象与背景计划。身份、数量、归属不符时给出精确错误；
 * 整份合并结果的 schema 校验由调用方用原 chapterAssetPlanSchema 完成。
 */
export function mergeChapterAssetParts(seeds, partValues) {
  if (!Array.isArray(seeds) || seeds.length === 0) fail('merge requires the frozen seeds');
  if (!Array.isArray(partValues) || partValues.length !== seeds.length) {
    fail(`part count must match seeds: expected=${seeds.length}:actual=${Array.isArray(partValues) ? partValues.length : 'n/a'}`);
  }
  const objectRegistry = [];
  const backgroundPlans = [];
  seeds.forEach((seed, index) => {
    const part = readJsonArtifact(partValues[index], `asset-parts[${index}]`);
    if (!isRecord(part)) fail(`asset-parts[${index}] (${seed.objectId}) must be an object`);
    const entries = Array.isArray(part.objectRegistry) ? part.objectRegistry : [];
    const plans = Array.isArray(part.backgroundPlans) ? part.backgroundPlans : [];
    if (seed.kind === CHAPTER_ASSET_BACKGROUND_KIND) {
      if (entries.length !== 0) fail(`asset-parts[${index}] (${seed.objectId}) must not carry objectRegistry entries`);
      if (plans.length !== 1) fail(`asset-parts[${index}] (${seed.objectId}) must contain exactly one backgroundPlans entry`);
      const plan = plans[0];
      if (!isRecord(plan) || plan.objectId !== seed.objectId) fail(`asset-parts[${index}] background identity differs from the frozen seed ${seed.objectId}`);
      backgroundPlans.push(plan);
      return;
    }
    if (entries.length !== 1) fail(`asset-parts[${index}] (${seed.objectId}) must contain exactly one objectRegistry entry`);
    const entry = entries[0];
    if (!isRecord(entry) || entry.objectId !== seed.objectId || entry.kind !== seed.kind || entry.name !== seed.name) {
      fail(`asset-parts[${index}] identity differs from the frozen seed ${seed.objectId}`);
    }
    if (plans.length > 0) fail(`asset-parts[${index}] (${seed.kind}) must not carry backgroundPlans`);
    objectRegistry.push(entry);
  });
  if (!objectRegistry.some(entry => entry.kind === 'scene')) fail('the chapter needs at least one scene object');
  if (backgroundPlans.length === 0) fail('the chapter needs at least one background plan');
  return { objectRegistry, backgroundPlans };
}
