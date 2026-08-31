import type { AssetObjectContract } from "./video-orchestrator.asset-object-contract";

type ClipReferenceSource = {
  videoReferenceNodeIds?: readonly string[];
  assetObjectContracts?: ReadonlyArray<
    Pick<AssetObjectContract, "referenceImageNodeIds"> &
      Partial<Pick<AssetObjectContract, "kind" | "name">>
  >;
  visualStateAnchorRequirements?: ReadonlyArray<{
    characterName: string;
    stateKey: string;
    stateVersionId: string;
    anchorNodeId?: string;
  }>;
};

type ClipAssetCoverageSource = {
  characterRoleNames?: readonly string[];
  sceneName?: string;
  propNames?: readonly string[];
  vfxNames?: readonly string[];
  assetObjectContracts?: readonly AssetObjectContract[];
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedNames(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(trimmed).filter(Boolean))];
}

/**
 * Clip 业务参考图的唯一编译入口。
 *
 * `videoReferenceNodeIds` 是 StoryPlan/BeatSheet 的唯一执行字段；对象合同中的真实单格资产
 * 不是第二条运行路径，而是同一冻结合同的一部分，因此在这里确定性并入并保持首次声明顺序。
 * storyboard/首尾帧拥有独立字段与职责，禁止混入该数组。
 */
export function buildCanonicalVideoReferenceNodeIds(
  source: ClipReferenceSource,
): string[] {
  const stateCharacters = new Set(
    (source.visualStateAnchorRequirements ?? [])
      .filter((requirement) => trimmed(requirement.anchorNodeId))
      .map((requirement) => trimmed(requirement.characterName)),
  );
  const replacedBaseCharacterNodeIds = new Set(
    (source.assetObjectContracts ?? []).flatMap((contract) =>
      contract.kind === "character" && stateCharacters.has(trimmed(contract.name))
        ? contract.referenceImageNodeIds.map(trimmed).filter(Boolean)
        : [],
    ),
  );
  return [
    ...new Set([
      ...(source.assetObjectContracts ?? []).flatMap((contract) =>
        contract.kind === "character" && stateCharacters.has(trimmed(contract.name))
          ? []
          : contract.referenceImageNodeIds.map(trimmed).filter(Boolean),
      ),
      ...(source.visualStateAnchorRequirements ?? [])
        .map((requirement) => trimmed(requirement.anchorNodeId))
        .filter(Boolean),
      ...normalizedNames(source.videoReferenceNodeIds).filter(
        (nodeId) => !replacedBaseCharacterNodeIds.has(nodeId),
      ),
    ]),
  ];
}

/**
 * Hard cutover：clip 级 `referenceImageNodeIds` 曾与执行层的
 * `videoReferenceNodeIds` 双轨并存，正是“画布有资产、付费请求没带资产”的根因。
 * 新请求必须原地失败并改用唯一字段，禁止静默搬运或兼容映射。
 */
export function findLegacyClipReferenceFields(
  rawClip: Record<string, unknown>,
): string[] {
  return Object.prototype.hasOwnProperty.call(rawClip, "referenceImageNodeIds")
    ? ["referenceImageNodeIds"]
    : [];
}

/** 纯结构校验：结构化出场对象必须各有同 kind + canonical name 的冻结资产合同。 */
export function validateClipAssetObjectCoverage(
  source: ClipAssetCoverageSource,
  path: string,
): string[] {
  const contracts = source.assetObjectContracts ?? [];
  const errors: string[] = [];
  const hasContract = (kind: AssetObjectContract["kind"], name: string): boolean =>
    contracts.some((contract) => contract.kind === kind && contract.name === name);

  for (const name of normalizedNames(source.characterRoleNames)) {
    if (!hasContract("character", name)) {
      errors.push(`${path}.assetObjectContracts 缺 character:${name}`);
    }
  }
  const sceneName = trimmed(source.sceneName);
  if (sceneName && !hasContract("scene", sceneName)) {
    errors.push(`${path}.assetObjectContracts 缺 scene:${sceneName}`);
  }
  for (const name of normalizedNames(source.propNames)) {
    if (!hasContract("prop", name)) {
      errors.push(`${path}.assetObjectContracts 缺 prop:${name}`);
    }
  }
  for (const name of normalizedNames(source.vfxNames)) {
    if (!hasContract("vfx", name)) {
      errors.push(`${path}.assetObjectContracts 缺 vfx:${name}`);
    }
  }
  return errors;
}

/** 帧节点拥有独立角色；重复进入业务参考数组会造成 URL 去重后证据归属不唯一。 */
export function validateFrameReferenceSeparation(input: {
  videoReferenceNodeIds: readonly string[];
  storyboardImageNodeId?: string;
  lastFrameImageNodeId?: string;
  path: string;
}): string[] {
  const businessIds = new Set(input.videoReferenceNodeIds.map(trimmed).filter(Boolean));
  const errors: string[] = [];
  const storyboardImageNodeId = trimmed(input.storyboardImageNodeId);
  const lastFrameImageNodeId = trimmed(input.lastFrameImageNodeId);
  if (storyboardImageNodeId && businessIds.has(storyboardImageNodeId)) {
    errors.push(
      `${input.path}.videoReferenceNodeIds 不得重复 storyboardImageNodeId=${storyboardImageNodeId}`,
    );
  }
  if (lastFrameImageNodeId && businessIds.has(lastFrameImageNodeId)) {
    errors.push(
      `${input.path}.videoReferenceNodeIds 不得重复 lastFrameImageNodeId=${lastFrameImageNodeId}`,
    );
  }
  return errors;
}
