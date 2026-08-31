// 角色卡「按名去重」——根治重名角色卡复活/重复。
//
// 根因（用户实测）：删除角色卡只记 node id（前端墓碑 / 409 合并 / 库清理全是 id 维度），
// 但任何「按名字重新播种」的写入（agent flow_patch createNodes、生成图最终写）都会带一个
// **新 id + 同名**的节点 → 绕过所有 id 维度防线 → 画布冒出重复重名角色卡。
//
// 修复（正确默认，非硬闸）：角色卡的真实身份是「名字（+状态版）」。所有落 chapters.canvas_flow
// 的写入在落盘前先按身份核对：若同身份角色卡已在本章画布上，则**折叠**这次重复创建（首卡为准），
// 并把同批 patch 里指向被丢弃 id 的引用（边端点 / patchNodeData / parent）改指既有卡。
// 这样 agent 重播种会收敛到既有卡，而不是生出新 id 的同名副本 → SSE 不会广播副本、409 合并也
// 收不到副本，重名从源头被消灭。
//
// 状态版（stateKey/stateDescription，护栏 B 分支 B 的「同身体换装/状态更新」产物）有意区分，
// 不收进同一身份 → 允许同名不同态的卡共存（与 material-auto-register 的版本语义一致）。

import {
  classifyCanvasCardForRegistry,
  readCanvasCardStateMarker,
} from "./material-card-classify";

type AnyRecord = Record<string, unknown>;

/** env flag：角色卡按名去重，默认 ON。设 0/false/off 关闭（逐字回退到旧行为）。 */
export function isCharacterCardNameDedupeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.CHARACTER_CARD_NAME_DEDUPE ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function readStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNodeData(node: unknown): AnyRecord {
  if (!node || typeof node !== "object") return {};
  const d = (node as AnyRecord).data;
  return d && typeof d === "object" ? (d as AnyRecord) : {};
}

/**
 * 角色卡「身份键」：同名 + 同状态版 = 同一张卡。
 * - 仅图节点产物的角色卡返回非 null（沿用 classifyCanvasCardForRegistry 的保守口径，
 *   分镜帧/场景卡/普通节点一律 null，不参与去重）。
 * - 带状态标记（stateKey/stateDescription）→ 视作独立的状态版，身份键含状态，不与基态折叠。
 */
export function characterCardIdentity(
  nodeData: AnyRecord | null | undefined,
): string | null {
  const cls = classifyCanvasCardForRegistry(nodeData);
  if (!cls || cls.kind !== "character") return null;
  const name = cls.name.trim().toLowerCase();
  if (!name) return null;
  const marker = readCanvasCardStateMarker(nodeData);
  const state = (marker?.stateKey || marker?.stateDescription || "")
    .trim()
    .toLowerCase();
  return `${name}::${state}`;
}

export interface CharacterCardDedupeResult {
  /** 重写后的 patch（无折叠时与入参 ===，零拷贝）。 */
  patch: AnyRecord;
  /** 被折叠掉的重复创建：fromId=本次创建意图 id（无显式 id 时为空串），toId=既有卡 id。 */
  collapsed: Array<{ fromId: string; toId: string; identity: string }>;
}

/**
 * 把一个 PublicFlowPatch 里「同名角色卡的重复创建」折叠到既有卡上。
 * 纯函数：不读库、不落盘。必须在每次乐观锁重试时用**最新读到的 current.nodes** 调用，
 * 这样并发写者已提交的卡也会被看见、被折叠。
 */
export function dedupeCharacterCardCreatesAgainstCanvas(input: {
  currentNodes: unknown[];
  patch: AnyRecord | null | undefined;
  enabled?: boolean;
}): CharacterCardDedupeResult {
  const enabled = input.enabled ?? isCharacterCardNameDedupeEnabled();
  const patch = (input.patch ?? {}) as AnyRecord;
  const createNodes = Array.isArray(patch.createNodes) ? patch.createNodes : [];
  if (!enabled || createNodes.length === 0) {
    return { patch, collapsed: [] };
  }

  // 既有画布上的角色卡身份 → 节点 id（首张为准，保证锚定稳定）。
  const identityToId = new Map<string, string>();
  for (const node of input.currentNodes) {
    const id = readStr((node as AnyRecord)?.id);
    if (!id) continue;
    const identity = characterCardIdentity(readNodeData(node));
    if (identity && !identityToId.has(identity)) identityToId.set(identity, id);
  }

  const collapsed: CharacterCardDedupeResult["collapsed"] = [];
  const remap = new Map<string, string>(); // 被丢弃的创建 id → 既有卡 id
  const keptCreates: unknown[] = [];

  for (const raw of createNodes) {
    const identity = characterCardIdentity(readNodeData(raw));
    const createId = readStr((raw as AnyRecord)?.id);
    if (identity) {
      const existingId = identityToId.get(identity);
      if (existingId && existingId !== createId) {
        // 同身份角色卡已存在 → 丢弃这次重复创建（首卡为准），引用改指既有卡。
        if (createId) remap.set(createId, existingId);
        collapsed.push({ fromId: createId, toId: existingId, identity });
        continue;
      }
      // 该身份首次出现：保留创建，并登记 身份→id，供同批后续同名一并折叠。
      if (!identityToId.has(identity) && createId) {
        identityToId.set(identity, createId);
      }
    }
    keptCreates.push(raw);
  }

  if (collapsed.length === 0) {
    return { patch, collapsed: [] };
  }

  const remapId = (id: string): string => remap.get(id) ?? id;
  const next: AnyRecord = { ...patch };

  // 剩余 createNodes 的 parent 引用改指（角色卡极少作父，稳妥兜底）。
  next.createNodes = keptCreates.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const node = { ...(raw as AnyRecord) };
    const parentId = readStr(node.parentId);
    if (parentId && remap.has(parentId)) node.parentId = remapId(parentId);
    const parentNode = readStr(node.parentNode);
    if (parentNode && remap.has(parentNode)) node.parentNode = remapId(parentNode);
    return node;
  });

  // createEdges 端点改指 + 折叠后自环丢弃 + 去重。
  if (Array.isArray(patch.createEdges) && patch.createEdges.length) {
    const seen = new Set<string>();
    const edges: unknown[] = [];
    for (const raw of patch.createEdges) {
      if (!raw || typeof raw !== "object") {
        edges.push(raw);
        continue;
      }
      const edge = { ...(raw as AnyRecord) };
      const source = remapId(readStr(edge.source));
      const target = remapId(readStr(edge.target));
      if (source && target && source === target) continue; // 折叠后自环
      if (source) edge.source = source;
      if (target) edge.target = target;
      if (source && target) {
        const key = `${source}->${target}:${readStr(edge.sourceHandle)}:${readStr(edge.targetHandle)}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      edges.push(edge);
    }
    next.createEdges = edges;
  }

  // patchNodeData / appendNodeArrays 指向被丢弃 id 的，改指既有卡（同批数据更新落到既有卡）。
  for (const key of ["patchNodeData", "appendNodeArrays"] as const) {
    const list = patch[key];
    if (Array.isArray(list) && list.length) {
      next[key] = list.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const item = { ...(raw as AnyRecord) };
        const id = readStr(item.id);
        if (id && remap.has(id)) item.id = remapId(id);
        return item;
      });
    }
  }

  return { patch: next, collapsed };
}

/**
 * 生成图「最终写」单节点版去重：若该最终节点是角色卡、且本章画布上已有**不同 id** 的同身份卡，
 * 返回应当改写入的既有卡 id（把生成结果落到既有卡上刷新，而不是新建一张同名副本）。
 */
export function resolveCharacterCardFinalWriteTarget(input: {
  currentNodes: unknown[];
  finalNodeData: AnyRecord | null | undefined;
  finalNodeId: string;
  enabled?: boolean;
}): { redirectToId: string | null } {
  const enabled = input.enabled ?? isCharacterCardNameDedupeEnabled();
  if (!enabled) return { redirectToId: null };
  const identity = characterCardIdentity(input.finalNodeData);
  if (!identity) return { redirectToId: null };
  for (const node of input.currentNodes) {
    const id = readStr((node as AnyRecord)?.id);
    if (!id || id === input.finalNodeId) continue;
    if (characterCardIdentity(readNodeData(node)) === identity) {
      return { redirectToId: id };
    }
  }
  return { redirectToId: null };
}
