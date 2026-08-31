// 画布删除 → 设定库同步（用户定规则）：
// 「一个设定库资产，如果它【绑定的那个章节】的画布里已经没有它了，就视为被删除，从库里同步删掉。」
//
// 关键点（为什么按绑定章节核对，而不是全局核对）：
//   - 资产的绑定章节存在 material_asset_versions.data_json.sourceChapterId。
//   - 跨章复用的卡（如 牛秀才 建于 ch40、被复用进 ch43）绑定章节仍是 ch40，
//     所以保存 ch43 时不会把它当孤儿删掉——只有它的「娘家」ch40 画布里也没了才删。
//   - 引用判定故意「宽松」：节点 materialAssetId 命中、或 anchorBindings/roleName 按名命中，
//     都算「还在用」→ 保留。只有【完全没有任何节点引用】才判孤儿。宁可漏删不可误删。

export interface ReconcileMaterialAsset {
	id: string;
	kind: string;
	name: string;
	/** 绑定章节：material_asset_versions.data_json.sourceChapterId */
	sourceChapterId: string | null;
}

export interface ReconcileFlowNode {
	data?: Record<string, unknown> | null;
}

export interface ReconcileFlow {
	nodes?: ReconcileFlowNode[];
}

function trimStr(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 收集当前画布里所有「被引用」的资产标识：id 集合 + 名称集合。 */
function collectReferencedKeys(flow: ReconcileFlow): { ids: Set<string>; names: Set<string> } {
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const node of flow.nodes ?? []) {
		const data = (node?.data ?? {}) as Record<string, unknown>;
		// 卡节点本体：data.materialAssetId 直指资产
		const matId = trimStr(data.materialAssetId);
		if (matId) ids.add(matId);
		// 卡节点 / 引用节点的角色名
		const roleName = trimStr(data.roleName);
		if (roleName) names.add(roleName);
		const label = trimStr(data.label);
		if (label) names.add(label);
		// 锚点绑定（故事板/关键帧等通过 anchorBindings 引用角色/场景）
		const bindings = Array.isArray(data.anchorBindings) ? data.anchorBindings : [];
		for (const binding of bindings) {
			if (!binding || typeof binding !== "object") continue;
			const b = binding as Record<string, unknown>;
			for (const key of ["assetId", "assetRefId", "refId"]) {
				const v = trimStr(b[key]);
				if (v) ids.add(v);
			}
			for (const key of ["entityId", "label"]) {
				const v = trimStr(b[key]);
				if (v) names.add(v);
			}
		}
	}
	return { ids, names };
}

/**
 * 给定「正在保存的章节 + 该章节最新画布 + 项目内所有资产」，返回应当从设定库删除的资产 id。
 * 纯函数：只看绑定到本章节、且本章节画布已不再引用的资产。
 */
export function computeOrphanedMaterialAssetIds(input: {
	chapterId: string;
	flow: ReconcileFlow;
	assets: ReconcileMaterialAsset[];
}): string[] {
	const chapterId = trimStr(input.chapterId);
	if (!chapterId) return [];
	const { ids, names } = collectReferencedKeys(input.flow);
	const orphans: string[] = [];
	for (const asset of input.assets) {
		// 只处理「绑定到正在保存的这个章节」的资产；别章资产一律不动（跨章复用安全）。
		if (trimStr(asset.sourceChapterId) !== chapterId) continue;
		const name = trimStr(asset.name);
		const referenced = ids.has(asset.id) || (name.length > 0 && names.has(name));
		if (!referenced) orphans.push(asset.id);
	}
	return orphans;
}

// env flag：画布删除→设定库同步。**默认 OFF（改为 opt-in）**。
// 2026-07-02 事故：本功能自 06-30 guardedFlow 回归后一直是死代码（从未真正执行）；修复 guardedFlow 后它被激活，
// 而它把「画布上暂时看不到某卡」直接翻译成「从设定库永久删卡」——一旦画布被前端陈旧状态 autosave 整图覆盖
// （已知 flow-autosave-clobber）或服务端并发写导致某卡短暂缺席，就会误删整批角色/场景资产（实测把 ch2 的
// 8 角色卡+场景+群像全删了）。瞬时画布状态 → 不可逆库删除，风险过高，改为必须显式 =1/true/on 才开。
export function isMaterialCanvasDeleteSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const raw = trimStr(env.MATERIAL_CANVAS_DELETE_SYNC).toLowerCase();
	return raw === "1" || raw === "true" || raw === "on";
}
