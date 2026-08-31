/**
 * 视频生成 · 上游输入连线（画布对话驱动出片的画布可观测性）。
 *
 * 用户规则（2026-07-04）：画布对话驱动生成视频任务时，其上游输入（角色/场景/群像参考图、
 * 分镜板、站位图、续写链上一镜）必须在画布上有所体现——即「输入节点 → 视频节点」连边，
 * 与既有「clip → 成片节点」连线（orchestrate concat 块）、「storyboard → clip」连线
 * （generate-video-to-canvas 最终写回）同一约定，让生产 DAG 在画布上完整可读。
 *
 * 事实口径：边只反映**实际喂给模型的输入**（referenceImages 是护栏/封顶后的最终列表），
 * 不是全量候选——固定补绑安全网的落选卡不连，避免把画布连成蜘蛛网。
 *
 * URL→节点反查按「对象 key 尾部」匹配而非全串相等：提交前 ARK 审核会把 TOS public origin
 * 公开 URL 换成 TOS presigned S3 URL（host/query 全变，见 presignVideoFrameUrlsForArk），
 * 只有 pathname 尾部（<日期>/<uuid>.<ext>）保持稳定。
 *
 * 注意：普通可执行音频不在此连。配音卡的可见来源由独立的
 * voice_reference/reference_only 同步器维护；该关系不进入执行或混音。
 *
 * 纯函数：只产出 createEdges specs，不碰画布/DB。edge id `e-in-<source>-<target>` 确定性
 * 可去重幂等（对现存边按 id 和 source+target 双重去重）。
 */

export type ClipInputEdgeSpec = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
};

type LooseGraphNode = { id?: unknown; data?: unknown };
type LooseGraphEdge = { id?: unknown; source?: unknown; target?: unknown };

function trimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** pathname 尾部两段（<日期>/<uuid>.<ext>），presign/host 变换下唯一稳定的部分。 */
function urlTailKey(rawUrl: string): string {
	const url = trimmed(rawUrl);
	if (!url || !/^https?:\/\//i.test(url)) return "";
	try {
		const pathname = decodeURIComponent(new URL(url).pathname);
		const segments = pathname.split("/").filter(Boolean);
		if (!segments.length) return "";
		return segments.slice(-2).join("/").toLowerCase();
	} catch {
		return "";
	}
}

/** 节点 kind → 输出 handle（对齐 apps/web taskNodeSchema：image=out-image / video=out-video）。 */
function sourceHandleForKind(kind: string): string {
	const k = kind.toLowerCase();
	if (k === "video" || k === "composevideo" || k === "videocompose") return "out-video";
	if (k === "audio") return "out-audio";
	return "out-image";
}

export function buildClipInputEdges(input: {
	/** persistVideoNodePatch buildPatch 收到的 fresh graph（{nodes, edges}）。 */
	current: unknown;
	/** 视频节点 id（边的 target）。 */
	clipNodeId: string;
	/** 实际提交的参考图/首尾帧/上一镜成片 URL（按对象 key 尾部反查画布节点）。 */
	referenceImageUrls?: string[];
	/** 已知的上游节点 id 直连（storyboardImageNodeId / blockingFrameNodeId / videoReferenceNodeIds）。 */
	sourceNodeIds?: string[];
	/** 目标节点由同一 patch 的 createNodes 创建（尚不在 current 里）时置 true，跳过目标存在性校验。 */
	targetWillBeCreated?: boolean;
}): ClipInputEdgeSpec[] {
	const clipNodeId = trimmed(input.clipNodeId);
	if (!clipNodeId) return [];
	const graph = (input.current ?? {}) as Record<string, unknown>;
	const nodes = Array.isArray(graph.nodes) ? (graph.nodes as LooseGraphNode[]) : [];
	const edges = Array.isArray(graph.edges) ? (graph.edges as LooseGraphEdge[]) : [];

	// 画布索引：节点 id 集合 + kind 表 + URL 尾 key → 节点 id（图/视频/音频 URL 都收，先到先得）。
	const nodeKinds = new Map<string, string>();
	const tailKeyToNodeId = new Map<string, string>();
	for (const n of nodes) {
		const id = trimmed(n?.id);
		if (!id) continue;
		const data =
			n?.data && typeof n.data === "object" && !Array.isArray(n.data)
				? (n.data as Record<string, unknown>)
				: {};
		nodeKinds.set(id, trimmed(data.kind));
		for (const key of ["imageUrl", "url", "videoUrl", "audioUrl"]) {
			const tail = urlTailKey(trimmed(data[key]));
			if (tail && !tailKeyToNodeId.has(tail)) tailKeyToNodeId.set(tail, id);
		}
	}
	// 目标节点须已在图上，除非它正由同一 patch 的 createNodes 创建（占位节点首建场景）。
	if (!nodeKinds.has(clipNodeId) && input.targetWillBeCreated !== true) return [];

	// 现存边去重：按 id 与 source+target 对双重去重（对齐 storyboard→clip 连线的 dup 判定）。
	const existingEdgeIds = new Set<string>();
	const existingPairs = new Set<string>();
	for (const e of edges) {
		const id = trimmed(e?.id);
		if (id) existingEdgeIds.add(id);
		const source = trimmed(e?.source);
		const target = trimmed(e?.target);
		if (source && target) existingPairs.add(`${source}→${target}`);
	}

	const sources: string[] = [];
	const seen = new Set<string>();
	const push = (idRaw: string) => {
		const id = trimmed(idRaw);
		if (!id || id === clipNodeId || seen.has(id)) return;
		if (!nodeKinds.has(id)) return; // 幻觉/跨图 id 不连
		seen.add(id);
		sources.push(id);
	};
	for (const id of input.sourceNodeIds ?? []) push(id);
	for (const u of input.referenceImageUrls ?? []) {
		const tail = urlTailKey(u);
		if (tail) push(tailKeyToNodeId.get(tail) ?? "");
	}

	const out: ClipInputEdgeSpec[] = [];
	for (const source of sources) {
		const id = `e-in-${source}-${clipNodeId}`;
		if (existingEdgeIds.has(id) || existingPairs.has(`${source}→${clipNodeId}`)) continue;
		out.push({
			id,
			source,
			target: clipNodeId,
			sourceHandle: sourceHandleForKind(nodeKinds.get(source) ?? ""),
			targetHandle: "in-any",
		});
	}
	return out;
}
