import { FLOW_NODE_ID_MAX_LENGTH } from "../flow/flow-node-id.constants";

export const ASSET_OBJECT_KINDS = ["character", "scene", "prop", "vfx", "palette", "composition"] as const;
export type AssetObjectKind = (typeof ASSET_OBJECT_KINDS)[number];
export const ASSET_REFERENCE_ROLES = ["none", "identity", "wardrobe", "prop", "environment", "palette", "composition", "vfx"] as const;
export type AssetReferenceRole = (typeof ASSET_REFERENCE_ROLES)[number];

export type AssetObjectContract = {
  kind: AssetObjectKind;
  name: string;
  /**
   * Agent-authored identity of the visible physical body. Different story
   * names/personas that inhabit the same body use the same key and therefore
   * the same canonical character asset. It is never inferred from names.
   */
  physicalIdentityKey?: string;
  /** 承担该职责的真实单格参考资产节点；多视图身份包可绑定多张独立图片。 */
  referenceImageNodeIds: string[];
  /**
   * agents 从当前项目资产清单中明确选择的跨画布图片资产。
   * 语义等价关系由 agents 决定；服务端只校验项目归属、类别与真实媒体，
   * 再把它物化为当前章节节点。一个对象只绑定一个 canonical 项目资产。
   */
  referenceAssetIds?: string[];
  /** 该资产在本 clip 的唯一主参考职责，禁止无语义地把所有图当同类 reference image。 */
  referenceRole: AssetReferenceRole;
  /** 明确禁止从该参考迁移到成片的维度，例如角色卡背景/姿势、场景卡内路人。 */
  /** Optional creative notes. Their absence never blocks authoring or media submission. */
  forbiddenTransfer?: string;
  identityInvariant?: string;
  startState?: string;
  spatialRelation?: string;
  scale?: string;
  driver?: string;
  stateChange?: string;
  endState?: string;
};

export type AssetObjectContractParseResult = {
  contracts: AssetObjectContract[];
  errors: string[];
};

export type AssetObjectContractParseOptions = {
  /**
   * 局部纯文本视频可以显式声明空合同；只要 clip 同时声明了角色、场景、道具或 VFX，
   * 上层 coverage 校验仍会拒绝空合同。BeatSheet 默认保持至少一个对象的严格要求。
   */
  allowEmpty?: boolean;
  /**
   * BeatSheet 的创作规划可以先声明对象合同，再由 authoring 前置资产阶段
   * 生成并回填真实 nodeId。执行态/散跑态仍默认要求 nodeId，避免把未准备
   * 的身份图送进 provider。
   */
  allowMissingReferenceImageNodeIds?: boolean;
};

const IMPLICIT_IDENTITY_REFERENCE_ROLES: ReadonlySet<AssetReferenceRole> = new Set([
  "identity",
  "wardrobe",
  "environment",
]);

/**
 * Distinguishes a visual identity dependency from an object that only needs to
 * remain present in the executable shot description.
 *
 * `none` is the explicit text-to-video contract: the object remains available
 * to the writer, but it does not request an authoring image. Character
 * identity, wardrobe and environment contracts need a canonical
 * image even while their draft binding is still empty. Props, VFX, palettes
 * and compositions become hard dependencies only after the agent explicitly
 * binds a stable node/project asset. This is a structural contract decision;
 * names and prompt prose are never inspected.
 */
export function requiresAuthoringVisualReference(
  contract: Pick<
    AssetObjectContract,
    "referenceRole" | "referenceImageNodeIds" | "referenceAssetIds"
  >,
): boolean {
  return (
    contract.referenceImageNodeIds.length > 0 ||
    (contract.referenceAssetIds?.length ?? 0) > 0 ||
    IMPLICIT_IDENTITY_REFERENCE_ROLES.has(contract.referenceRole)
  );
}

export type BeatAssetObjectBindingsInput = {
  assetObjectContracts: unknown;
  characterRoleNames: readonly string[];
  sceneName: string;
  propNames: readonly string[];
  vfxNames: readonly string[];
  path?: string;
  allowMissingReferenceImageNodeIds?: boolean;
};

/**
 * Single structural source of truth for a beat's declared object bindings.
 * It validates only canonical names and object kinds supplied by the caller;
 * it never infers story semantics from those strings.
 */
export function validateBeatAssetObjectBindings(
  input: BeatAssetObjectBindingsInput,
): AssetObjectContractParseResult {
  const path = input.path ?? "assetObjectContracts";
  const parsed = parseAssetObjectContracts(
    input.assetObjectContracts,
    path,
    {
      allowMissingReferenceImageNodeIds:
        input.allowMissingReferenceImageNodeIds === true,
    },
  );
  const errors = [...parsed.errors];
  const hasObject = (kind: AssetObjectKind, name: string): boolean =>
    parsed.contracts.some(
      (contract) => contract.kind === kind && contract.name === name,
    );
  input.characterRoleNames.forEach((name) => {
    if (!hasObject("character", name)) {
      errors.push(
        `${path} 缺 character:${name}；每个出场角色必须有同名对象合同`,
      );
    }
  });
  if (!input.sceneName) {
    const suffix = ".assetObjectContracts";
    const scenePath = path.endsWith(suffix)
      ? `${path.slice(0, -suffix.length)}.sceneName`
      : "sceneName";
    errors.push(
      `${scenePath} 必填；每个付费 clip 必须声明 canonical 场景并绑定场景对象合同`,
    );
  } else if (!hasObject("scene", input.sceneName)) {
    errors.push(
      `${path} 缺 scene:${input.sceneName}；场景必须有同名对象合同`,
    );
  }
  input.propNames.forEach((name) => {
    if (!hasObject("prop", name)) {
      errors.push(
        `${path} 缺 prop:${name}；每个出场道具必须有同名对象合同`,
      );
    }
  });
  input.vfxNames.forEach((name) => {
    if (!hasObject("vfx", name)) {
      errors.push(
        `${path} 缺 vfx:${name}；每个 VFX 必须具名并与实体道具分离`,
      );
    }
  });
  return { contracts: parsed.contracts, errors };
}

const MAX_OBJECTS_PER_CLIP = 24;
const MAX_OBJECT_FIELD_CHARS = 500;
const ASSET_OBJECT_FIELDS = new Set([
  "kind",
  "name",
  "physicalIdentityKey",
  "referenceImageNodeIds",
  "referenceAssetIds",
  "referenceRole",
  "forbiddenTransfer",
  "identityInvariant",
  "startState",
  "spatialRelation",
  "scale",
  "driver",
  "stateChange",
  "endState",
]);

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 纯结构解析：不从名称或文案推断对象类型、身份、尺度或动作。 */
export function parseAssetObjectContracts(
  input: unknown,
  path = "assetObjectContracts",
  options: AssetObjectContractParseOptions = {},
): AssetObjectContractParseResult {
  if (!Array.isArray(input)) {
    return {
      contracts: [],
      errors: [`${path} 必须是非空数组`],
    };
  }
  const errors: string[] = [];
  if (input.length === 0 && options.allowEmpty !== true) {
    errors.push(`${path} 必须至少声明一个资产对象`);
  }
  if (input.length > MAX_OBJECTS_PER_CLIP) {
    errors.push(`${path} 最多 ${MAX_OBJECTS_PER_CLIP} 项（收到 ${input.length}）`);
  }
  const contracts: AssetObjectContract[] = [];
  const seen = new Set<string>();
  input.forEach((raw, index) => {
    const itemPath = `${path}[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${itemPath} 必须是对象`);
      return;
    }
    const record = raw as Record<string, unknown>;
    Object.keys(record).forEach((field) => {
      if (!ASSET_OBJECT_FIELDS.has(field)) {
        errors.push(`${itemPath}.${field} 不是允许字段`);
      }
    });
    const kind = readTrimmedString(record.kind) as AssetObjectKind;
    const name = readTrimmedString(record.name);
    const physicalIdentityKey = readTrimmedString(record.physicalIdentityKey);
    const referenceImageNodeIds = Array.isArray(record.referenceImageNodeIds)
      ? [...new Set(record.referenceImageNodeIds.map(readTrimmedString).filter(Boolean))]
      : [];
    const referenceAssetIds = Array.isArray(record.referenceAssetIds)
      ? [...new Set(record.referenceAssetIds.map(readTrimmedString).filter(Boolean))]
      : [];
    const referenceRole = readTrimmedString(record.referenceRole) as AssetReferenceRole;
    const requiresVisualReference = requiresAuthoringVisualReference({
      referenceRole,
      referenceImageNodeIds,
      referenceAssetIds,
    });
    if (!ASSET_OBJECT_KINDS.includes(kind)) {
      errors.push(`${itemPath}.kind 必须 ∈ {${ASSET_OBJECT_KINDS.join("/")}}`);
    }
    if (!ASSET_REFERENCE_ROLES.includes(referenceRole)) {
      errors.push(`${itemPath}.referenceRole 必须 ∈ {${ASSET_REFERENCE_ROLES.join("/")}}`);
    }
    if (
      !referenceImageNodeIds.length &&
      !referenceAssetIds.length &&
      requiresVisualReference &&
      options.allowMissingReferenceImageNodeIds !== true
    ) {
      errors.push(
        `${itemPath} 必须通过 referenceImageNodeIds 或 referenceAssetIds 绑定真实图片资产`,
      );
    }
    if (referenceImageNodeIds.some((nodeId) => nodeId.length > FLOW_NODE_ID_MAX_LENGTH)) {
      errors.push(`${itemPath}.referenceImageNodeIds 每项最多 ${FLOW_NODE_ID_MAX_LENGTH} 字`);
    }
    if (referenceAssetIds.length > 1) {
      errors.push(`${itemPath}.referenceAssetIds 最多绑定一个 canonical 项目资产`);
    }
    if (referenceAssetIds.some((assetId) => assetId.length > 500)) {
      errors.push(`${itemPath}.referenceAssetIds 每项最多 500 字`);
    }
    const fields = {
      forbiddenTransfer: readTrimmedString(record.forbiddenTransfer),
      identityInvariant: readTrimmedString(record.identityInvariant),
      startState: readTrimmedString(record.startState),
      spatialRelation: readTrimmedString(record.spatialRelation),
      scale: readTrimmedString(record.scale),
      driver: readTrimmedString(record.driver),
      stateChange: readTrimmedString(record.stateChange),
      endState: readTrimmedString(record.endState),
    };
    if (!name) errors.push(`${itemPath}.name 必填`);
    if (physicalIdentityKey.length > MAX_OBJECT_FIELD_CHARS) {
      errors.push(`${itemPath}.physicalIdentityKey 最多 ${MAX_OBJECT_FIELD_CHARS} 字（收到 ${physicalIdentityKey.length}）`);
    }
    if (kind !== "character" && physicalIdentityKey) {
      errors.push(`${itemPath}.physicalIdentityKey 只允许 character 对象声明`);
    }
    Object.entries(fields).forEach(([field, value]) => {
      if (value.length > MAX_OBJECT_FIELD_CHARS) {
        errors.push(`${itemPath}.${field} 最多 ${MAX_OBJECT_FIELD_CHARS} 字（收到 ${value.length}）`);
      }
    });
    const key = `${kind}:${name}`;
    if (kind && name && seen.has(key)) errors.push(`${itemPath} 重复声明资产对象 ${key}`);
    if (kind && name) seen.add(key);
    if (
      ASSET_OBJECT_KINDS.includes(kind) &&
      ASSET_REFERENCE_ROLES.includes(referenceRole) &&
      (
        referenceImageNodeIds.length > 0 ||
        referenceAssetIds.length > 0 ||
        options.allowMissingReferenceImageNodeIds === true ||
        !requiresVisualReference
      ) &&
      referenceImageNodeIds.every((nodeId) => nodeId.length <= FLOW_NODE_ID_MAX_LENGTH) &&
      referenceAssetIds.length <= 1 &&
      referenceAssetIds.every((assetId) => assetId.length <= 500) &&
      name &&
      physicalIdentityKey.length <= MAX_OBJECT_FIELD_CHARS &&
      (kind === "character" || !physicalIdentityKey) &&
      Object.values(fields).every((value) => value.length <= MAX_OBJECT_FIELD_CHARS)
    ) {
      contracts.push({
        kind,
        name,
        ...(physicalIdentityKey ? { physicalIdentityKey } : {}),
        referenceImageNodeIds,
        referenceAssetIds,
        referenceRole,
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value.length > 0),
        ),
      });
    }
  });
  return { contracts, errors };
}

export function formatAssetObjectContracts(contracts: readonly AssetObjectContract[]): string {
  return contracts
    .map((contract) => [
      `${contract.kind}:${contract.name}`,
      ...(contract.physicalIdentityKey ? [`物理身份=${contract.physicalIdentityKey}`] : []),
      `参考节点=${contract.referenceImageNodeIds.join(",")}`,
      `项目资产=${(contract.referenceAssetIds ?? []).join(",")}`,
      `参考职责=${contract.referenceRole}`,
      ...(contract.forbiddenTransfer ? [`禁止迁移=${contract.forbiddenTransfer}`] : []),
      ...(contract.identityInvariant ? [`身份不变量=${contract.identityInvariant}`] : []),
      ...(contract.startState ? [`起态=${contract.startState}`] : []),
      ...(contract.spatialRelation ? [`空间=${contract.spatialRelation}`] : []),
      ...(contract.scale ? [`尺度=${contract.scale}`] : []),
      ...(contract.driver ? [`驱动=${contract.driver}`] : []),
      ...(contract.stateChange ? [`变化=${contract.stateChange}`] : []),
      ...(contract.endState ? [`终态=${contract.endState}`] : []),
    ].join("｜"))
    .join("\n");
}

/**
 * 最终参考图索引的稳定结构键。使用 JSON tuple，避免资产名本身含冒号时发生碰撞。
 */
export function assetObjectContractIdentityKey(kind: string, name: string): string {
  return JSON.stringify([kind.trim(), name.trim()]);
}

export type AssetReferenceIndicesByContractKey = ReadonlyMap<
  string,
  readonly string[]
>;

/**
 * 最终视频模型只接收参考资产的身份/职责锁定摘要。
 *
 * 完整 assetObjectContracts 仍逐字段保存在结构化 clip 中，并供 writer 规划、连续性校验、
 * referenceMediaManifest 与真实媒体附件使用。driver/stateChange/endState 等运动事实必须由 writer
 * 编译进 continuity/shots/exitState，不能再把内部合同逐字段抄到最终提示词里挤占逐镜动作预算。
 * referenceImageNodeIds 只属于执行层，不进入模型正文。
 */
export function formatAssetObjectReferenceLocks(
  contracts: readonly AssetObjectContract[],
  referenceIndicesByContractKey?: AssetReferenceIndicesByContractKey,
): string {
  if (contracts.length === 0) return "";
  let hasResolvedReference = false;
  const rows = contracts.map((contract) => {
    const references = [
      ...new Set(
        referenceIndicesByContractKey?.get(
          assetObjectContractIdentityKey(contract.kind, contract.name),
        ) ?? [],
      ),
    ].filter(Boolean);
    if (references.length > 0) hasResolvedReference = true;
    const subject = references.length > 0
      ? `${references.join("+")}（${contract.kind}:${contract.name}）`
      : `${contract.kind}:${contract.name}`;
    const notes = [
      ...(contract.identityInvariant ? [`保持：${contract.identityInvariant}`] : []),
      ...(contract.forbiddenTransfer ? [`禁迁：${contract.forbiddenTransfer}`] : []),
    ];
    return `${subject}=${contract.referenceRole}${notes.length > 0 ? `（${notes.join("；")}）` : ""}`;
  });
  return [
    ...(hasResolvedReference
      ? ["@图N 以本次供应商最终 content[] 顺序为唯一真相；镜头表中的 canonical 名均指向下方同名绑定，不按预估图序猜测。"]
      : []),
    "参考只锁身份/服装/兵器/空间/材质与职责，不继承卡图站姿、背景或构图；动作、位移、受力与终态以镜头表为准。",
    ...rows,
  ].join("\n");
}
