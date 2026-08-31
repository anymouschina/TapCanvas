// 项目锚定资产只用于正向候选装配与非阻塞诊断。是否采用某个角色、场景或道具锚点
// 属于创作语义，不能由 Hono 以“已有锚却未绑定”为由阻止生成。这里仅保留可复用的
// 结构化候选装配函数，供 agents 基于真实项目事实选择。

// 章节复用策略开关：默认 ON（用户定行为，2026-06-26）；显式 0/false/off 才回退旧的"项目级全局最新"行为。
export function isChapterCardReusePolicyEnabled(env: unknown): boolean {
  const raw = String(
    (env as Record<string, unknown>)?.CHAPTER_CARD_REUSE_POLICY ??
      globalThis.process?.env?.CHAPTER_CARD_REUSE_POLICY ??
      "",
  )
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export type MaterialAnchorAssetLike = {
  id?: string | null;
  kind?: string | null;
  name?: string | null;
  updatedAt?: string | null;
  latestVersion?: { data?: Record<string, unknown> | null } | null;
};

// chapterId 形如 `book-{bookId}-ch{N}`（chapters.id 同形）。从尾部 `-ch{N}` 解析章节序号。
// 解析不出（如 UUID 形 id、空）返回 null = 未知章节。与 routes 侧 parseChapterSequenceFromChapterId 同规则。
export function parseChapterIndexFromId(value: unknown): number | null {
  const s = typeof value === "string" ? value.trim() : "";
  const m = /-ch(\d+)$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

// 章节序号解析器：优先用 chapters 表映射(chapterId→chapter_index，兼容 UUID 形 id)，回退尾部 `-ch{N}` 解析。
export type ChapterIndexResolver = (chapterId: string) => number | null;

// 读卡所属章节序号：从 latestVersion.data.sourceChapterId 解析。null = 未知章节。
// 传 resolver 可接 chapters 表映射；默认走纯字符串解析（book-{bookId}-ch{N}）。
export function readCardChapterIndex(
  asset: MaterialAnchorAssetLike,
  resolve: ChapterIndexResolver = parseChapterIndexFromId,
): number | null {
  const cid = readAnchorStringField(asset.latestVersion?.data ?? null, "sourceChapterId");
  if (!cid) return null;
  return resolve(cid);
}

// 角色卡「就近取最新」比较：先按章节序号(未知=-∞)，再按 updatedAt。返回 >0 表示 a 更优（更该被选）。
function compareCharacterRecency(
  a: MaterialAnchorAssetLike,
  b: MaterialAnchorAssetLike,
  resolve: ChapterIndexResolver,
): number {
  const ia = readCardChapterIndex(a, resolve);
  const ib = readCardChapterIndex(b, resolve);
  const va = ia == null ? Number.NEGATIVE_INFINITY : ia;
  const vb = ib == null ? Number.NEGATIVE_INFINITY : ib;
  if (va !== vb) return va - vb; // 章节更近者优
  const ta = Date.parse(String(a.updatedAt || "")) || 0;
  const tb = Date.parse(String(b.updatedAt || "")) || 0;
  return ta - tb; // 更新更晚者优
}

export type ChapterReusePolicyInput<T extends MaterialAnchorAssetLike = MaterialAnchorAssetLike> = {
  characters: T[];
  scenes: T[];
  props: T[];
  // 当前章节序号；null = 无法判定本章（如调用方未带 chapterId）→ 退化为不按章节限制。
  currentChapterIndex: number | null;
  // 可选：chapterId→chapter_index 解析器（接 chapters 表映射，兼容 UUID 形）。默认纯字符串解析。
  resolveChapterIndex?: ChapterIndexResolver;
};

// 【章节复用策略·用户定 2026-07-10 统一版】所有同名资产（角色/场景/道具）项目级复用·就近获取：
// - 不再限制场景卡只留本章（旧规则 2026-06-26「场景限本章」被用户明确推翻：
//   「所有同名资产都应该复用，而不是限制一个章节，应该是就近获取」）。
// - 统一规则：chapter_index ≤ 当前章 的卡，按名分组、就近取最新一张（章节更近者优、同章 updatedAt 晚者优）；
//   无章节标记的卡仍纳入（视为 -∞ 章节排末，作兜底）；未来章节的卡不回流。
//   currentChapterIndex==null（无 chapterId 调用）时不设上界、按名取最新。
// - 「同名＝同一实体」由命名铁律保证（canonical name，章节号不进 name）；是否真是同一地点/器物
//   属创作判断，归 SKILL/知识卡层，服务端只做确定性就近去重。
// 纯函数零 I/O，可单测。currentChapterIndex 由调用方从 chapterId 解析后传入。
export function applyChapterReusePolicy<T extends MaterialAnchorAssetLike>(
  input: ChapterReusePolicyInput<T>,
): { characters: T[]; scenes: T[]; props: T[] } {
  const { currentChapterIndex } = input;
  const resolve = input.resolveChapterIndex ?? parseChapterIndexFromId;

  // 同名分组·就近取最新（全 kind 统一）。输出按就近降序，装配截断 limit 时优先保留最相关的。
  const nearestByName = (list: T[]): T[] => {
    const eligible =
      currentChapterIndex == null
        ? list
        : list.filter((a) => {
            const idx = readCardChapterIndex(a, resolve);
            return idx == null || idx <= currentChapterIndex; // 未知章节仍纳入（兜底，排末）
          });
    const byName = new Map<string, T>();
    for (const a of eligible) {
      const name = String(a.name || "").trim();
      if (!name) continue;
      const prev = byName.get(name);
      if (!prev || compareCharacterRecency(a, prev, resolve) > 0) byName.set(name, a);
    }
    return [...byName.values()].sort((a, b) => compareCharacterRecency(b, a, resolve));
  };

  return {
    characters: nearestByName(input.characters),
    scenes: nearestByName(input.scenes),
    props: nearestByName(input.props),
  };
}

export type StoryboardAnchorCandidate = {
  assetId: string;
  kind: string;
  name: string;
  imageUrl: string;
  label: string;
  description?: string;
};

function readAnchorStringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function anchorLabelPrefix(kind: string): string {
  if (kind === "character") return "角色参考";
  if (kind === "scene") return "场景参考";
  if (kind === "prop") return "道具参考";
  if (kind === "style") return "画风参考";
  // 群像参考：多人同框设定图（含站位），群像/人群镜挂它根治同脸。标签刻意不含「站位图」
  // ——orchestrate 会剔除 label 含「站位图/blocking」的项；群像图须能绑进视频参考。
  if (kind === "ensemble") return "群像参考";
  // 姿态参考：人物×道具非常规组合形态单格图（扛/挑/背/骑…），命中该形态的镜挂它
  // 根治"文字描形必走样"（扁担悬空/道具浮空）。标签同样刻意不含「站位图」。
  if (kind === "pose") return "姿态参考";
  return "参考";
}

// 把素材资产数组装配成锚定候选：取 latestVersion.data.imageUrl（缺则回退 threeViewImageUrl），
// 按 imageUrl 去重，带 @类型：名称 标签，截到 limit（默认 6，对齐 gpt-image-2 参考图上限）。
export function buildStoryboardAnchorCandidatesFromAssets(
  assets: MaterialAnchorAssetLike[],
  limit = 6,
): { candidates: StoryboardAnchorCandidate[]; referenceImages: string[] } {
  const candidates: StoryboardAnchorCandidate[] = [];
  const seenUrls = new Set<string>();
  const cap = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 6;
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset || typeof asset !== "object") continue;
    const data = asset.latestVersion?.data ?? null;
    const imageUrl =
      readAnchorStringField(data, "imageUrl") ||
      readAnchorStringField(data, "threeViewImageUrl");
    if (!imageUrl || seenUrls.has(imageUrl)) continue;
    const kind = String(asset.kind || "").trim();
    const name = String(asset.name || "").trim() || "未命名";
    const description =
      readAnchorStringField(data, "stateDescription") ||
      readAnchorStringField(data, "prompt");
    candidates.push({
      assetId: String(asset.id || "").trim(),
      kind,
      name,
      imageUrl,
      label: `${anchorLabelPrefix(kind)}：${name}`,
      ...(description ? { description } : {}),
    });
    seenUrls.add(imageUrl);
    if (candidates.length >= cap) break;
  }
  return { candidates, referenceImages: candidates.map((item) => item.imageUrl) };
}
