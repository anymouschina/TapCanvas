import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getAssetByIdForUser, type AssetRow } from "../asset/asset.repo";
import {
  getMaterialVersionForOwner,
  listMaterialAssets,
} from "../material/material.repo";
import { listProjectNodeAssetsForOwner } from "../material/material.project-node-assets.service";
import { PROJECT_NODE_ASSET_ID_PREFIX } from "../material/material.project-node-assets";
import {
  mapFlowRowToDto,
  type FlowRow,
} from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  IMAGE_REFERENCE_INSPECTION_BATCH_SIZE,
  MAX_EXECUTION_IMAGE_REFERENCES,
  MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
} from "./agents-tool-bridge.image-reference-contract";
import { isStoryPreviewAssetData } from "./story-preview-asset";

type ImageReferenceSource =
  | "node"
  | "asset"
  | "project_node"
  | "material_asset"
  | "material_version";

export type ResolvedExecutionImageReference = {
  referenceId: string;
  source: ImageReferenceSource;
  nodeId: string | null;
  assetId: string | null;
  assetRefId: string | null;
  name: string;
  url: string;
  previewOnly: boolean;
};

export type AgentVisibleImageReference = Omit<ResolvedExecutionImageReference, "url" | "previewOnly"> & {
  mediaType: "image";
  ready: true;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readHttpImageUrl(value: unknown): string {
  const url = readTrimmedString(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function normalizeReferenceIds(
  value: unknown,
  fieldName: string,
  maximumItems: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = readTrimmedString(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length > maximumItems) {
    throw new AppError(`${fieldName} 最多允许 ${maximumItems} 项`, {
      status: 400,
      code: "agents_tool_image_reference_limit_exceeded",
      details: { fieldName, count: out.length, max: maximumItems },
    });
  }
  return out;
}

function readImageResultCandidate(value: unknown): {
  url: string;
  assetId: string;
  assetRefId: string;
  name: string;
} | null {
  if (typeof value === "string") {
    const url = readHttpImageUrl(value);
    return url ? { url, assetId: "", assetRefId: "", name: "" } : null;
  }
  const record = readRecord(value);
  if (!record) return null;
  const url =
    readHttpImageUrl(record.url) ||
    readHttpImageUrl(record.imageUrl) ||
    readHttpImageUrl(record.sourceUrl);
  if (!url) return null;
  return {
    url,
    assetId: readTrimmedString(record.assetId),
    assetRefId: readTrimmedString(record.assetRefId),
    name:
      readTrimmedString(record.assetName) ||
      readTrimmedString(record.name) ||
      readTrimmedString(record.title),
  };
}

function readFirstImageResult(data: Record<string, unknown>): {
  url: string;
  assetId: string;
  assetRefId: string;
  name: string;
} | null {
  const directUrl =
    readHttpImageUrl(data.imageUrl) ||
    readHttpImageUrl(data.threeViewImageUrl) ||
    readHttpImageUrl(data.firstFrameUrl) ||
    readHttpImageUrl(data.lastFrameUrl);
  if (directUrl) {
    return {
      url: directUrl,
      assetId:
        readTrimmedString(data.assetId) ||
        readTrimmedString(data.serverAssetId),
      assetRefId: readTrimmedString(data.assetRefId),
      name:
        readTrimmedString(data.assetName) ||
        readTrimmedString(data.label) ||
        readTrimmedString(data.roleName),
    };
  }

  const collectionKeys = [
    "imageResults",
    "images",
    "roleCardReferenceImages",
    "referenceImages",
  ] as const;
  for (const key of collectionKeys) {
    const values = Array.isArray(data[key]) ? data[key] : [];
    for (const value of values) {
      const candidate = readImageResultCandidate(value);
      if (candidate) return candidate;
    }
  }

  const cells = Array.isArray(data.storyboardEditorCells)
    ? data.storyboardEditorCells
    : [];
  for (const cell of cells) {
    const record = readRecord(cell);
    if (!record) continue;
    const candidate = readImageResultCandidate({
      imageUrl: record.imageUrl,
      assetId: record.assetId,
      assetRefId: record.assetRefId,
      name: record.label,
    });
    if (candidate) return candidate;
  }
  return null;
}

function readFlowNodes(row: FlowRow): Array<Record<string, unknown>> {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const record = readRecord(data);
  return Array.isArray(record?.nodes)
    ? record.nodes.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function resolveNodeImageReference(
  row: FlowRow,
  nodeId: string,
): ResolvedExecutionImageReference | null {
  const node = readFlowNodes(row).find(
    (item) => readTrimmedString(item.id) === nodeId,
  );
  if (!node) return null;
  const data = readRecord(node.data) ?? {};
  const kind = readTrimmedString(data.kind).toLowerCase();
  const image =
    readFirstImageResult(data) ||
    (kind.includes("image")
      ? readImageResultCandidate({
          url: data.url,
          assetId: data.assetId,
          assetRefId: data.assetRefId,
          name: data.label,
        })
      : null);
  if (!image) return null;
  const assetId = image.assetId || readTrimmedString(data.assetId) || null;
  const assetRefId =
    image.assetRefId || readTrimmedString(data.assetRefId) || null;
  const name =
    image.name ||
    readTrimmedString(data.label) ||
    readTrimmedString(data.roleName) ||
    nodeId;
  return {
    referenceId: `node:${nodeId}`,
    source: "node",
    nodeId,
    assetId,
    assetRefId,
    name,
    url: image.url,
    previewOnly: isStoryPreviewAssetData(data),
  };
}

function parseAssetRowImageReference(
  row: AssetRow,
): ResolvedExecutionImageReference | null {
  let parsed: unknown = null;
  try {
    parsed = row.data ? JSON.parse(row.data) : null;
  } catch {
    parsed = null;
  }
  const data = readRecord(parsed) ?? {};
  const declaredType = readTrimmedString(data.type).toLowerCase();
  if (declaredType && declaredType !== "image") return null;
  const image =
    readImageResultCandidate({
      url: data.url,
      sourceUrl: data.sourceUrl,
      assetId: row.id,
      assetRefId: data.assetRefId,
      name: row.name,
    }) || readFirstImageResult(data);
  if (!image) return null;
  const assetRefId = image.assetRefId || readTrimmedString(data.assetRefId) || null;
  return {
    referenceId: `asset:${row.id}`,
    source: "asset",
    nodeId: null,
    assetId: row.id,
    assetRefId,
    name: image.name || readTrimmedString(row.name) || row.id,
    url: image.url,
    previewOnly: isStoryPreviewAssetData(data),
  };
}

async function resolveGenericAssetImageReference(input: {
  c: AppContext;
  ownerId: string;
  assetId: string;
}): Promise<ResolvedExecutionImageReference | null> {
  const genericAsset = await getAssetByIdForUser(
    input.c.env.DB,
    input.assetId,
    input.ownerId,
  );
  if (genericAsset) return parseAssetRowImageReference(genericAsset);
  return null;
}

function resolveMaterialAssetImageReference(input: {
  materialAssets: Awaited<ReturnType<typeof listMaterialAssets>>;
  assetId: string;
}): ResolvedExecutionImageReference | null {
  const material = input.materialAssets.find((item) => item.id === input.assetId);
  const data = readRecord(material?.latestVersion?.data);
  const image = data ? readFirstImageResult(data) : null;
  if (!material || !image) return null;
  return {
    referenceId: `asset:${material.id}`,
    source: "material_asset",
    nodeId: null,
    assetId: material.id,
    assetRefId:
      readTrimmedString(material.latestVersion?.id) ||
      readTrimmedString(data?.assetRefId) ||
      null,
    name: readTrimmedString(material.name) || material.id,
    url: image.url,
    previewOnly: isStoryPreviewAssetData(data),
  };
}

function resolveProjectNodeAssetImageReference(input: {
  projectNodeAssets: Awaited<ReturnType<typeof listProjectNodeAssetsForOwner>>;
  assetId: string;
}): ResolvedExecutionImageReference | null {
  const asset = input.projectNodeAssets.find((item) => item.id === input.assetId);
  const data = readRecord(asset?.latestVersion?.data);
  const image = data ? readFirstImageResult(data) : null;
  if (!asset || !image) return null;
  return {
    referenceId: `asset:${asset.id}`,
    source: "project_node",
    nodeId: readTrimmedString(asset.origin?.nodeId) || null,
    assetId: asset.id,
    assetRefId: readTrimmedString(asset.latestVersion?.id) || null,
    name: readTrimmedString(asset.name) || asset.id,
    url: image.url,
    previewOnly: isStoryPreviewAssetData(data),
  };
}

async function resolveMaterialVersionImageReference(input: {
  c: AppContext;
  ownerId: string;
  projectId: string;
  materialAssets: Awaited<ReturnType<typeof listMaterialAssets>>;
  versionId: string;
}): Promise<ResolvedExecutionImageReference | null> {
  const version = await getMaterialVersionForOwner(input.c.env.DB, {
    ownerId: input.ownerId,
    projectId: input.projectId,
    versionId: input.versionId,
  });
  if (!version) return null;
  const image = readFirstImageResult(version.data);
  if (!image) return null;
  const material = input.materialAssets.find(
    (item) => item.id === version.assetId,
  );
  const baseName = readTrimmedString(material?.name) || version.assetId;
  return {
    referenceId: `asset-version:${version.id}`,
    source: "material_version",
    nodeId: null,
    assetId: version.assetId,
    assetRefId: version.id,
    name: `${baseName} v${version.version}`,
    url: image.url,
    previewOnly: isStoryPreviewAssetData(version.data),
  };
}

export async function resolveExecutionImageReferences(input: {
  c: AppContext;
  ownerId: string;
  row: FlowRow | null;
  nodeIds?: unknown;
  assetIds?: unknown;
  allowPreviewOnly?: boolean;
}): Promise<ResolvedExecutionImageReference[]> {
  const nodeIds = normalizeReferenceIds(
    input.nodeIds,
    "referenceImageNodeIds",
    MAX_EXECUTION_IMAGE_REFERENCES,
  );
  const assetIds = normalizeReferenceIds(
    input.assetIds,
    "referenceAssetIds",
    MAX_EXECUTION_IMAGE_REFERENCES,
  );
  if (nodeIds.length + assetIds.length > MAX_EXECUTION_IMAGE_REFERENCES) {
    throw new AppError(
      `图片引用总数最多允许 ${MAX_EXECUTION_IMAGE_REFERENCES} 项`,
      {
        status: 400,
        code: "agents_tool_image_reference_limit_exceeded",
        details: {
          nodeCount: nodeIds.length,
          assetCount: assetIds.length,
          max: MAX_EXECUTION_IMAGE_REFERENCES,
        },
      },
    );
  }

  const resolved: ResolvedExecutionImageReference[] = [];
  const missingNodeIds: string[] = [];
  const missingAssetIds: string[] = [];
  for (const nodeId of nodeIds) {
    const reference = input.row
      ? resolveNodeImageReference(input.row, nodeId)
      : null;
    if (reference) resolved.push(reference);
    else missingNodeIds.push(nodeId);
  }

  const projectId = readTrimmedString(input.row?.project_id) || null;
  const hasProjectNodeAssetIds = assetIds.some((assetId) =>
    assetId.startsWith(PROJECT_NODE_ASSET_ID_PREFIX),
  );
  const hasOtherAssetIds = assetIds.some(
    (assetId) => !assetId.startsWith(PROJECT_NODE_ASSET_ID_PREFIX),
  );
  const [projectNodeAssets, materialAssets] =
    projectId && assetIds.length > 0
      ? await Promise.all([
          hasProjectNodeAssetIds
            ? listProjectNodeAssetsForOwner(input.c, input.ownerId, { projectId })
            : Promise.resolve([]),
          hasOtherAssetIds
            ? listMaterialAssets(input.c.env.DB, {
                ownerId: input.ownerId,
                projectId,
              })
            : Promise.resolve([]),
        ])
      : [[], []];
  for (const assetId of assetIds) {
    const genericReference = await resolveGenericAssetImageReference({
      c: input.c,
      ownerId: input.ownerId,
      assetId,
    });
    const projectNodeReference = resolveProjectNodeAssetImageReference({
      projectNodeAssets,
      assetId,
    });
    const materialReference = resolveMaterialAssetImageReference({
      materialAssets,
      assetId,
    });
    const versionReference =
      !genericReference && !materialReference && projectId
        ? await resolveMaterialVersionImageReference({
            c: input.c,
            ownerId: input.ownerId,
            projectId,
            materialAssets,
            versionId: assetId,
          })
        : null;
    const reference =
      genericReference || projectNodeReference || materialReference || versionReference;
    if (reference) resolved.push(reference);
    else missingAssetIds.push(assetId);
  }

  if (missingNodeIds.length || missingAssetIds.length) {
    throw new AppError(
      "引用 ID 无法解析为当前用户、当前画布中的真实图片资产",
      {
        status: 422,
        code: "agents_tool_image_reference_unresolved",
        details: { missingNodeIds, missingAssetIds },
      },
    );
  }

  const forbiddenPreviewReferences = resolved
    .filter((reference) => reference.previewOnly)
    .map((reference) => reference.referenceId);
  if (forbiddenPreviewReferences.length > 0 && input.allowPreviewOnly !== true) {
    throw new AppError(
      "剧情 preview 系列仅用于查看，不能作为图片或视频生产参考",
      {
        status: 422,
        code: "agents_tool_preview_asset_forbidden",
        details: { referenceIds: forbiddenPreviewReferences },
      },
    );
  }

  const out: ResolvedExecutionImageReference[] = [];
  const seenUrls = new Set<string>();
  for (const reference of resolved) {
    if (seenUrls.has(reference.url)) continue;
    seenUrls.add(reference.url);
    out.push(reference);
  }
  return out;
}

type InspectionReferenceId = {
  source: "node" | "asset";
  id: string;
};

/**
 * 为 agent 的章节级只读验真确定性拆批。它复用付费执行解析器的权限、媒体与 URL
 * 验真规则，但绝不把整章清单当成一个 clip 的供应商引用预算。
 */
export async function resolveImageReferencesForInspection(input: {
  c: AppContext;
  ownerId: string;
  row: FlowRow | null;
  nodeIds?: unknown;
  assetIds?: unknown;
}): Promise<ResolvedExecutionImageReference[]> {
  const nodeIds = normalizeReferenceIds(
    input.nodeIds,
    "referenceImageNodeIds",
    MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
  );
  const assetIds = normalizeReferenceIds(
    input.assetIds,
    "referenceAssetIds",
    MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
  );
  const requested: InspectionReferenceId[] = [
    ...nodeIds.map((id): InspectionReferenceId => ({ source: "node", id })),
    ...assetIds.map((id): InspectionReferenceId => ({ source: "asset", id })),
  ];
  if (requested.length > MAX_IMAGE_REFERENCE_INSPECTION_ITEMS) {
    throw new AppError(
      `图片引用只读验真总数最多允许 ${MAX_IMAGE_REFERENCE_INSPECTION_ITEMS} 项`,
      {
        status: 400,
        code: "agents_tool_image_reference_limit_exceeded",
        details: {
          nodeCount: nodeIds.length,
          assetCount: assetIds.length,
          max: MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
        },
      },
    );
  }

  const batches: InspectionReferenceId[][] = [];
  for (
    let offset = 0;
    offset < requested.length;
    offset += IMAGE_REFERENCE_INSPECTION_BATCH_SIZE
  ) {
    batches.push(requested.slice(offset, offset + IMAGE_REFERENCE_INSPECTION_BATCH_SIZE));
  }
  const resolvedBatches = await Promise.all(
    batches.map((batch) =>
      resolveExecutionImageReferences({
        c: input.c,
        ownerId: input.ownerId,
        row: input.row,
        nodeIds: batch.filter((entry) => entry.source === "node").map((entry) => entry.id),
        assetIds: batch.filter((entry) => entry.source === "asset").map((entry) => entry.id),
        allowPreviewOnly: true,
      }),
    ),
  );

  const resolved: ResolvedExecutionImageReference[] = [];
  const seenUrls = new Set<string>();
  for (const reference of resolvedBatches.flat()) {
    if (seenUrls.has(reference.url)) continue;
    seenUrls.add(reference.url);
    resolved.push(reference);
  }
  return resolved;
}

export function describeExecutionImageReference(
  reference: ResolvedExecutionImageReference,
): AgentVisibleImageReference {
  const { url: _url, previewOnly: _previewOnly, ...visible } = reference;
  return { ...visible, mediaType: "image", ready: true };
}
