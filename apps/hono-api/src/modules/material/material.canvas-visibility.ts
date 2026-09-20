import { projectCanvasMembership } from "@tapcanvas/workflow-kernel-protocol";
import type { MaterialAssetDto } from "./material.schemas";

/**
 * 画布删除=废弃：用户在画布上删掉的节点，其媒体与派生素材都属于「已废弃」，
 * 不得被任何创作/生成链路再次召回或引用。删除只隐藏节点、不销毁资产本体，
 * 因此这条规则必须由宿主在每个消费边界确定性执行。
 *
 * 判定不做任何语义猜测，只比对可验证的稳定身份三类：
 *   1. 媒体 URL（同一份媒体）
 *   2. 画布节点 id（画布派生素材 / 设定库卡的 sourceNodeId / 项目节点资产 id 内嵌的 nodeId）
 *   3. 供应商 taskId（generation 资产行只记录运行时节点 id 与 taskId，taskId 才是与画布节点
 *      一一对应的稳定身份）
 * 「任一画布仍可见」的身份一律不算废弃：删除只在该身份不再被任何可见画布持有时生效。
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resourceUrls(data: Record<string, unknown>): string[] {
  const results = [data.imageResults, data.videoResults].flatMap((value) => Array.isArray(value) ? value : []);
  return [data.imageUrl, data.videoUrl, data.audioUrl, data.url,
    ...results.flatMap((value) => { const item = record(value); return [item.url, item.imageUrl, item.videoUrl]; })]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function canvasNodeTaskIds(data: Record<string, unknown>): string[] {
  return [data.taskId, data.videoTaskId, data.imageTaskId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export type CanvasDeprecationScope = Readonly<{
  /** 已废弃媒体 URL：删除/脱离的节点持有、且没有任何可见节点仍在引用。 */
  resourceUrls: ReadonlySet<string>;
  /** 已废弃画布节点 id。 */
  nodeIds: ReadonlySet<string>;
  /** 已废弃节点对应的供应商 taskId。 */
  taskIds: ReadonlySet<string>;
}>;

export const EMPTY_CANVAS_DEPRECATION_SCOPE: CanvasDeprecationScope = {
  resourceUrls: new Set<string>(),
  nodeIds: new Set<string>(),
  taskIds: new Set<string>(),
};

/**
 * Canvas deletion does not destroy a material-library copy or a generation asset row.
 * It does exclude every later recall of that same resource. Identity is matched on the
 * exact recorded facts only — never display names or semantic similarity.
 */
export function deprecatedCanvasScope(canvases: readonly { data: unknown }[]): CanvasDeprecationScope {
  const deprecatedUrls = new Set<string>();
  const deprecatedNodeIds = new Set<string>();
  const deprecatedTaskIds = new Set<string>();
  const visibleUrls = new Set<string>();
  const visibleNodeIds = new Set<string>();
  const visibleTaskIds = new Set<string>();
  for (const canvas of canvases) {
    let parsed: unknown = canvas.data;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }
    const root = record(parsed);
    const projection = record(projectCanvasMembership(root));
    const visibleIds = new Set((Array.isArray(projection.nodes) ? projection.nodes : []).map((node) => record(node).id));
    for (const node of Array.isArray(root.nodes) ? root.nodes : []) {
      const nodeRecord = record(node);
      const data = record(nodeRecord.data);
      const visible = visibleIds.has(nodeRecord.id);
      for (const url of resourceUrls(data)) (visible ? visibleUrls : deprecatedUrls).add(url);
      for (const taskId of canvasNodeTaskIds(data)) (visible ? visibleTaskIds : deprecatedTaskIds).add(taskId);
      const nodeId = typeof nodeRecord.id === "string" ? nodeRecord.id : "";
      if (nodeId) (visible ? visibleNodeIds : deprecatedNodeIds).add(nodeId);
    }
  }
  for (const url of visibleUrls) deprecatedUrls.delete(url);
  for (const nodeId of visibleNodeIds) deprecatedNodeIds.delete(nodeId);
  for (const taskId of visibleTaskIds) deprecatedTaskIds.delete(taskId);
  return { resourceUrls: deprecatedUrls, nodeIds: deprecatedNodeIds, taskIds: deprecatedTaskIds };
}

/** 任意来源的引用事实（URL / 节点 id / taskId）是否命中画布废弃集合。 */
export function isDeprecatedCanvasReference(
  input: Readonly<{ urls?: readonly string[]; nodeIds?: readonly string[]; taskIds?: readonly string[] }>,
  scope: CanvasDeprecationScope,
): boolean {
  if ((input.urls ?? []).some((url) => Boolean(url) && scope.resourceUrls.has(url))) return true;
  if ((input.nodeIds ?? []).some((nodeId) => Boolean(nodeId) && scope.nodeIds.has(nodeId))) return true;
  return (input.taskIds ?? []).some((taskId) => Boolean(taskId) && scope.taskIds.has(taskId));
}

/** 素材/资产行是否属于画布上已被删除（废弃）的资源。 */
export function isDeprecatedCanvasAsset(asset: MaterialAssetDto, scope: CanvasDeprecationScope): boolean {
  const data = record(asset.latestVersion?.data ?? {});
  return isDeprecatedCanvasReference({
    urls: resourceUrls(data),
    nodeIds: [asset.origin?.nodeId, data.sourceNodeId, data.sourceCanvasNodeId, data.nodeId]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
    taskIds: canvasNodeTaskIds(data),
  }, scope);
}

/** 该画布节点 id 是否已被删除（废弃）。 */
export function isDeprecatedCanvasNodeId(nodeId: string, scope: CanvasDeprecationScope): boolean {
  return Boolean(nodeId) && scope.nodeIds.has(nodeId);
}
