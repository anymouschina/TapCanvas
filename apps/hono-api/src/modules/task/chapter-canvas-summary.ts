import {
  containsHttpImageUrlDeep,
  isHttpImageUrl,
  removeHttpImageUrlsDeep,
} from "./agents-image-url-privacy";

// 章节画布·权威快照摘要（2026-06-17）。
// 病根（ch38 实测）：注入给小T 的「当前画布概况」canvasSummary 来自调用方(前端 chatContext)，且明确叫
// 小T「无需再调用 flow_get」。前端快照滞后（用户清空/改了画布后没刷）→ 小T 钉在旧状态办事
// （拿已删节点、沿用旧框架）。根治：服务端在每次请求时实时读 chapters.canvas_flow 生成权威摘要、
// 覆盖调用方那份陈旧值。本文件是纯摘要函数，便于单测；实时读取在 task.agents-bridge 调用处。

type NodeLike = { data?: unknown };

function nodeData(n: NodeLike): Record<string, unknown> {
  return n.data && typeof n.data === "object" && !Array.isArray(n.data)
    ? (n.data as Record<string, unknown>)
    : {};
}

/**
 * 把当前画布节点压成一段简洁权威摘要：总数 + 按 kind 计数 + 资产节点的状态(success/running/空) +
 * 若干关键标签（角色卡/风格锚/设计板/视频）。给小T 一眼看清"现在画布上真实有什么"，
 * 不再被前端陈旧快照误导。空画布显式说明"画布当前为空"。
 */
export function summarizeChapterCanvasNodes(nodes: NodeLike[]): string {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return "画布当前为空（无任何节点）。";
  }
  const kindCount = new Map<string, number>();
  let assetReady = 0;
  let assetPending = 0;
  const labels: string[] = [];
  for (const n of nodes) {
    const d = nodeData(n);
    const kind = String(d.kind ?? "unknown").toLowerCase() || "unknown";
    kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1);
    const isAsset = /image|imageedit|storyboardimage|video|composevideo|videocompose/.test(kind);
    if (isAsset) {
      const hasMedia =
        (typeof d.imageUrl === "string" && d.imageUrl.trim().length > 0) ||
        (typeof d.videoUrl === "string" && d.videoUrl.trim().length > 0);
      const status = String(d.status ?? "").toLowerCase();
      if (status === "success" || hasMedia) assetReady += 1;
      else assetPending += 1;
    }
    const label = String(d.label ?? "").trim();
    if (label && labels.length < 14) labels.push(`${label}${d.status ? `[${d.status}]` : ""}`);
  }
  const kindStr = [...kindCount.entries()].map(([k, c]) => `${k}×${c}`).join(", ");
  const parts = [
    `画布共 ${nodes.length} 节点（${kindStr}）`,
    `资产节点：已出图/片 ${assetReady}、待生成/空 ${assetPending}`,
  ];
  if (labels.length) parts.push(`关键节点：${labels.join(" / ")}`);
  return parts.join("；");
}

export type FlowNodeFull = { id?: unknown; type?: unknown; data?: unknown; [k: string]: unknown };

export type SlimFlowNode = {
  id: string;
  label?: string;
  kind?: string;
  productionLayer?: string;
  hasMedia: boolean;
  /** 异步生成生命周期状态（queued/running/success/failed/pending…）。
   *  没有它，"第 3 镜出完了吗、落盘了吗"只能对每个节点拉一次完整 flow_get——
   *  而状态检查是长任务里最高频的取证动作，这样烧的是上下文预算大头。 */
  status?: string;
  /** 异步任务号：status=queued/running 时据此 wait，而不是重复提交。 */
  taskId?: string;
};

/**
 * flow_get 工具的节点选择/瘦身（2026-06-20·根治每轮把整个画布完整 prompt 注进 LLM 上下文烧 token）：
 * - nodeIds 非空 → 默认只返回有界的生命周期/资产事实，避免把单个旧状态节点里的长 prompt、镜头表或
 *   textResults 历史一次性灌进模型上下文；需要创作文本或其他语义字段时必须显式传 fields；
 * - 否则 → 返回全部节点的【精简摘要】(id/label/kind/productionLayer/hasMedia)，不含 prompt/imageUrl 等大字段。
 * 纯函数、可单测；handler 在 agents-tool-bridge.routes 调用。
 */
/** 剥掉 TOS 预签名 URL 的鉴权 query（X-Amz-*…，每条 600+ 字符且 1h 即过期，LLM 用不到、只撑爆 token）。
 *  保留 base URL（资产身份）。非签名 URL（如 TOS public origin 永久直链）原样返回。 */
function stripSignedUrl(u: unknown): unknown {
  if (typeof u !== "string") return u;
  const q = u.indexOf("?");
  if (q < 0) return u;
  // 只剥明显的对象存储签名（含 X-Amz- / X-Tos- 鉴权参数）的 query，避免误伤带正常 query 的 URL。
  if (/[?&](X-Amz-|X-Tos-)/i.test(u)) return u.slice(0, q);
  return u;
}

function stripSignedUrlsDeep(v: unknown): unknown {
  if (typeof v === "string") return stripSignedUrl(v);
  if (Array.isArray(v)) return v.map(stripSignedUrlsDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = stripSignedUrlsDeep(val);
    return out;
  }
  return v;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nodeHasImageMedia(node: FlowNodeFull, data: Record<string, unknown>): boolean {
  // 只描述节点自身的图片产物。video 节点即使携带 referenceImages / 首尾帧，
  // 其 assetId 仍是视频资产，不能误标成可执行图片引用交给主模型。
  const kind = nodeKindOf(node, data);
  if (!kind.includes("image")) return false;
  const directCandidates = [
    data.imageUrl,
    data.threeViewImageUrl,
    data.firstFrameUrl,
    data.lastFrameUrl,
  ];
  if (directCandidates.some(isHttpImageUrl)) return true;
  const collections = [
    data.imageResults,
    data.images,
    data.referenceImages,
    data.styleImages,
    data.styleReferenceImages,
    data.roleCardReferenceImages,
    data.storyboardEditorCells,
  ];
  if (collections.some(containsHttpImageUrlDeep)) return true;
  return kind.includes("image") && isHttpImageUrl(data.url);
}

function buildNodeImageReference(
  node: FlowNodeFull,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const nodeId = readTrimmedString(node.id);
  if (!nodeId || !nodeHasImageMedia(node, data)) return null;
  const assetId =
    readTrimmedString(data.assetId) || readTrimmedString(data.serverAssetId);
  const assetRefId = readTrimmedString(data.assetRefId);
  const name =
    readTrimmedString(data.assetName) ||
    readTrimmedString(data.label) ||
    readTrimmedString(data.roleName) ||
    nodeId;
  return {
    referenceId: `node:${nodeId}`,
    source: "node",
    nodeId,
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    name,
    mediaType: "image",
    ready: true,
  };
}

/**
 * 完整节点返回前瘦身（2026-06-23·根治 flow_get 读视频节点回合上下文爆炸）：
 * ① 去重 `videoPrompt`——它是 `prompt` 的运行时回声、对视频节点常与 prompt 逐字相同，存了两遍（各几百行镜头表）；
 *    与 prompt 相同则删，不同则保留（保住真有差异的少数）。
 * ② 剥 referenceImages / firstFrameUrl / lastFrameUrl / 嵌套结构里的 TOS 预签名 URL 鉴权 query。
 * 只动【返回给 LLM 的副本】，DB 节点不变。
 */
export function slimFullNodeForTool(node: FlowNodeFull): FlowNodeFull {
  if (!node || typeof node !== "object") return node;
  const d = node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? { ...(node.data as Record<string, unknown>) }
    : null;
  if (!d) return node;
  if (typeof d.videoPrompt === "string" && typeof d.prompt === "string" && d.videoPrompt === d.prompt) {
    delete d.videoPrompt;
  }
  const imageReference = buildNodeImageReference(node, d);
  const stripped = stripSignedUrlsDeep(d);
  const slimmed = removeHttpImageUrlsDeep(stripped) as Record<string, unknown>;
  if (imageReference) {
    slimmed.hasImage = true;
    slimmed.mediaReferences = [imageReference];
  }
  return { ...node, data: slimmed };
}

function nodeKindOf(node: FlowNodeFull, d: Record<string, unknown>): string {
  const k =
    typeof d.kind === "string"
      ? d.kind
      : typeof node?.type === "string"
        ? (node.type as string)
        : "";
  return k.toLowerCase();
}

function nodeHasMediaD(d: Record<string, unknown>): boolean {
  return (
    (typeof d.imageUrl === "string" && d.imageUrl.trim().length > 0) ||
    (typeof d.videoUrl === "string" && d.videoUrl.trim().length > 0)
  );
}

/** q 全文匹配面：把节点里"模型能据以认出它"的文本字段拼起来（label/prompt/镜头表/角色名/场景描述/层），小写。 */
function nodeSearchText(d: Record<string, unknown>): string {
  const fields = ["label", "prompt", "videoPrompt", "roleName", "stateDescription", "productionLayer"];
  const parts: string[] = [];
  for (const f of fields) {
    const v = d[f];
    if (typeof v === "string" && v.trim()) parts.push(v);
  }
  return parts.join("\n").toLowerCase();
}

function toSlimNode(n: FlowNodeFull): SlimFlowNode {
  const d = nodeData(n as NodeLike);
  const id = String(n?.id ?? "");
  const label = typeof d.label === "string" ? d.label : undefined;
  const kind = nodeKindOf(n, d) || undefined;
  const productionLayer = typeof d.productionLayer === "string" ? d.productionLayer : undefined;
  const status = typeof d.status === "string" && d.status.trim() ? d.status.trim() : undefined;
  const taskId = typeof d.taskId === "string" && d.taskId.trim() ? d.taskId.trim() : undefined;
  return {
    id,
    ...(label ? { label } : {}),
    ...(kind ? { kind } : {}),
    ...(productionLayer ? { productionLayer } : {}),
    hasMedia: nodeHasMediaD(d),
    ...(status ? { status } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

// ── flow_search / flow_get 过滤（2026-06-30·对标 codex grep：先按内容/类型定位，再精读详情）──

export type FlowNodeFilter = {
  /** 子串模糊：对 label + prompt + 镜头表 + 角色名 + 场景描述 做大小写无关 includes 匹配。 */
  q?: string;
  /** 节点 kind（image/video/text/storyboardimage…），大小写无关精确。 */
  kind?: string;
  /** productionLayer（anchors/design_board/expansion…），大小写无关精确。 */
  productionLayer?: string;
  /** status；特殊值 "empty"=资产节点但未出图/片（无 media 且非 success）。 */
  status?: string;
  /** 有无媒体（已出图/片）。 */
  hasMedia?: boolean;
};

export function hasAnyFilter(f?: FlowNodeFilter): boolean {
  if (!f) return false;
  return Boolean(
    (f.q && f.q.trim()) ||
      (f.kind && f.kind.trim()) ||
      (f.productionLayer && f.productionLayer.trim()) ||
      (f.status && f.status.trim()) ||
      typeof f.hasMedia === "boolean",
  );
}

export function nodeMatchesFilter(node: FlowNodeFull, f: FlowNodeFilter): boolean {
  const d = nodeData(node as NodeLike);
  if (f.kind && f.kind.trim() && nodeKindOf(node, d) !== f.kind.trim().toLowerCase()) return false;
  if (
    f.productionLayer &&
    f.productionLayer.trim() &&
    String(d.productionLayer ?? "").toLowerCase() !== f.productionLayer.trim().toLowerCase()
  )
    return false;
  if (typeof f.hasMedia === "boolean" && nodeHasMediaD(d) !== f.hasMedia) return false;
  if (f.status && f.status.trim()) {
    const want = f.status.trim().toLowerCase();
    const st = String(d.status ?? "").toLowerCase();
    if (want === "empty") {
      if (st === "success" || nodeHasMediaD(d)) return false;
    } else if (st !== want) return false;
  }
  if (f.q && f.q.trim()) {
    if (!nodeSearchText(d).includes(f.q.trim().toLowerCase())) return false;
  }
  return true;
}

export type FlowSearchResult = {
  total: number;
  shown: number;
  offset: number;
  limit: number;
  nodes: SlimFlowNode[];
};

/** 画布 grep（对标 codex file-search）：按 filter 命中 → 分页 → 返回轻量命中(slim 字段) + total/shown 供 overage 信号。 */
export function searchFlowNodes(
  nodes: FlowNodeFull[],
  filter: FlowNodeFilter,
  page?: { limit?: number; offset?: number },
): FlowSearchResult {
  const all = Array.isArray(nodes) ? nodes : [];
  const matched = hasAnyFilter(filter) ? all.filter((n) => nodeMatchesFilter(n, filter)) : all;
  const total = matched.length;
  const offRaw = Math.trunc(Number(page?.offset ?? 0));
  const offset = Number.isFinite(offRaw) && offRaw > 0 ? offRaw : 0;
  const limRaw = Math.trunc(Number(page?.limit ?? 30));
  const limit = Number.isFinite(limRaw) && limRaw > 0 ? Math.min(100, limRaw) : 30;
  const slice = matched.slice(offset, offset + limit);
  return { total, shown: slice.length, offset, limit, nodes: slice.map(toSlimNode) };
}

/** full 模式字段裁剪：只保留 id/type + data 的 {kind,label,productionLayer} 恒留项 + 请求的 fields。 */
function projectNodeFields(node: FlowNodeFull, fields: string[]): FlowNodeFull {
  const d = nodeData(node as NodeLike);
  const keep = new Set<string>([
    "kind",
    "label",
    "productionLayer",
    "hasImage",
    "mediaReferences",
    ...fields.map((x) => String(x ?? "").trim()).filter(Boolean),
  ]);
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in d) out[k] = (d as Record<string, unknown>)[k];
  return { id: node.id, type: node.type, data: out };
}

export type FlowGetSelectOpts = {
  nodeIds?: string[];
  filter?: FlowNodeFilter;
  /** full 模式（nodeIds 指定时）：只取这些 data 字段，省 token。 */
  fields?: string[];
  limit?: number;
  offset?: number;
};

/**
 * 多节点精读的默认事实面。批量读取通常是为了拿到资产/任务句柄，而不是把每个节点的长 prompt
 * 重新注入模型上下文。完整 prompt、镜头表等语义内容必须由调用方显式 fields 请求。
 */
const DEFAULT_SINGLE_DETAIL_FIELDS = [
  "status",
  "taskId",
  "videoUrl",
  "imageUrl",
  "firstFrameUrl",
  "lastFrameUrl",
  "runId",
  "runCreatedAt",
  "authoringState",
  "productionState",
  "pendingUserInput",
  "assetRepairRequired",
  "assetRepair",
  "concatVideoUrl",
  "clipCount",
  "totalDurationSeconds",
  "aspect",
  "resolution",
  "vendor",
  "imageModel",
];

const DEFAULT_BATCH_DETAIL_FIELDS = [
  ...DEFAULT_SINGLE_DETAIL_FIELDS,
  "assetId",
  "assetRefId",
  "referenceType",
  "materialIdentity",
  "assetInputs",
  "clipIndex",
  "clipRunId",
  "imageTaskId",
  "imageTaskKind",
];

// ── ⑤ 节点内文本锚定增量编辑（对标 codex apply_patch：锚定上下文唯一匹配 + 部分失败可恢复）──
export type AnchoredTextEdit = { find: string; replace: string };
export type AnchoredEditResult = {
  text: string;
  applied: number;
  failed: Array<{ find: string; reason: "not_found" | "ambiguous" | "empty_find" }>;
  changed: boolean;
};

/** 对一段文本依次应用「锚定 find→replace」：find 必须在【当前文本】里恰好出现一次（唯一锚定，像 codex 要求
 *  上下文唯一），命中即替换;0 次=not_found、>1 次=ambiguous、空 find=empty_find。失败的 edit 跳过、不影响其余
 *  (部分失败可恢复，= AppliedPatchDelta)。返回最终文本 + 成功数 + 失败清单。纯函数、可单测。 */
export function applyAnchoredTextEdits(original: string, edits: AnchoredTextEdit[]): AnchoredEditResult {
  let text = String(original ?? "");
  let applied = 0;
  const failed: AnchoredEditResult["failed"] = [];
  for (const edit of Array.isArray(edits) ? edits : []) {
    const find = String(edit?.find ?? "");
    const replace = String(edit?.replace ?? "");
    if (!find) {
      failed.push({ find, reason: "empty_find" });
      continue;
    }
    const first = text.indexOf(find);
    if (first < 0) {
      failed.push({ find, reason: "not_found" });
      continue;
    }
    if (text.indexOf(find, first + find.length) >= 0) {
      failed.push({ find, reason: "ambiguous" }); // 多处命中 → 拒绝（避免误改），让调用方给更长锚
      continue;
    }
    text = text.slice(0, first) + replace + text.slice(first + find.length);
    applied += 1;
  }
  return { text, applied, failed, changed: applied > 0 };
}

export function selectFlowNodesForTool(
  nodes: FlowNodeFull[],
  arg?: string[] | FlowGetSelectOpts,
): { mode: "full" | "slim"; nodes: FlowNodeFull[] | SlimFlowNode[]; total?: number; shown?: number; offset?: number } {
  const all = Array.isArray(nodes) ? nodes : [];
  const opts: FlowGetSelectOpts = Array.isArray(arg) ? { nodeIds: arg } : arg ?? {};
  const ids = Array.isArray(opts.nodeIds)
    ? opts.nodeIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (ids.length > 0) {
    const want = new Set(ids);
    let full = all.filter((n) => want.has(String(n?.id ?? ""))).map(slimFullNodeForTool);
    const fields = Array.isArray(opts.fields) && opts.fields.length > 0
      ? opts.fields
      : ids.length > 1
        ? DEFAULT_BATCH_DETAIL_FIELDS
        : DEFAULT_SINGLE_DETAIL_FIELDS;
    if (fields) {
      full = full.map((n) => projectNodeFields(n, fields));
    }
    return { mode: "full", nodes: full };
  }
  // slim 模式：可选 filter + 分页（任一给了就带 total/shown/offset 做 overage 信号）。
  const filtered = hasAnyFilter(opts.filter) ? all.filter((n) => nodeMatchesFilter(n, opts.filter!)) : all;
  const paged = opts.limit != null || opts.offset != null;
  const offRaw = Math.trunc(Number(opts.offset ?? 0));
  const offset = Number.isFinite(offRaw) && offRaw > 0 ? offRaw : 0;
  const limRaw = Math.trunc(Number(opts.limit ?? 0));
  const limit = Number.isFinite(limRaw) && limRaw > 0 ? Math.min(200, limRaw) : 0;
  const window = paged ? filtered.slice(offset, limit > 0 ? offset + limit : undefined) : filtered;
  const slim = window.map(toSlimNode);
  if (hasAnyFilter(opts.filter) || paged) {
    return { mode: "slim", nodes: slim, total: filtered.length, shown: slim.length, offset };
  }
  return { mode: "slim", nodes: slim };
}
