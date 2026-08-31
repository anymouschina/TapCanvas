import type { AppContext } from "../../types";
import {
  createMaterialAssetForOwner,
  createMaterialVersionForOwner,
  deleteMaterialAssetForOwner,
  listMaterialAssetsForOwner,
} from "../material/material.service";
import { getPrismaClient } from "../../platform/node/prisma";
// 纯分类逻辑已抽到 material-card-classify.ts（零依赖，可独立测试）；此处 re-export 保持既有 import。
import {
  classifyCanvasCardForRegistry,
  readCanvasCardStateMarker,
  type CanvasCardClassification,
  type CanvasCardStateMarker,
} from "./material-card-classify";
import { readPropMaterialIdentity } from "./prop-material-identity";
import { readStyleFingerprint } from "./authoring-style-provenance";

export {
  classifyCanvasCardForRegistry,
  readCanvasCardStateMarker,
  type CanvasCardClassification,
  type CanvasCardStateMarker,
};

/**
 * 画布创作产物 → 项目设定库（material_assets）自动注册。
 *
 * 根因（ch48 实测）：设定库此前唯一写入口是前端素材库 UI，agent 在章节画布上生成的
 * 角色卡/场景卡只活在 chapters.canvas_flow JSON 里 → 护栏 B 的 anchor_candidates
 * （只读 material_assets）扫出零卡 → 合法走"零锚补建" → 跨章重画同一角色（换脸）、
 * 重定画风（漂移）。这里把"创作产物入库"接上：生成成功的角色卡/场景卡自动注册，
 * 后续章节的锚定扫描即可按 roleName/名称复用同一张脸。
 *
 * 设计：
 * - 识别：角色必须是 `referenceType=character + roleName + character-card/v3`；场景必须是
 *   `referenceType=scene + sceneName + scene-card/v1`。label/title 不参与身份判断。
 * - 多剧集三分支（同名查找先 project 后 owner 回退，与护栏 B 的 owner 回退对称，
 *   防止跨项目复用后状态卡在当前项目裂成第二个同名资产）：
 *   ① 同名不存在 → 新建资产（首卡）；
 *   ② 同名存在且 nodeData 带 stateDescription/stateKey（状态更新卡，护栏 B 分支 B 产物）
 *     → 给原资产追加新版本（latest=该角色当前状态，供后续章节锚定）；不去重——
 *     重绘=再追加，latest 恒为最后过审图，膨胀由护栏 D ≤2 圈重绘上限约束；
 *   ③ 同名存在且无状态标记 → 跳过（首卡为准，保证锚定稳定，不被后续重绘悄悄顶掉；
 *     要换脸应走素材库显式管理）。
 * - best-effort：注册失败只记日志，绝不阻断出图主链路。
 */

export type AutoRegisterAction =
  | { action: "create" }
  | { action: "append-version"; targetAssetId: string }
  | { action: "skip"; reason: "duplicate-no-state" };

/**
 * 三分支决策（纯函数）：
 * - 无同名 → create；
 * - 有同名 + 状态标记 → append-version（追加到命中的原资产，project 命中优先于 owner 命中）；
 * - 本项目同名无状态标记 → skip（首卡为准）。
 *
 * 【2026-07-18 斩神2 ch1 实测修洞】owner 级（跨项目）同名命中 + 无状态标记 → 必须 create，不能 skip：
 * 设定库项目级隔离是铁律（跨项目禁互窜）——重开同书新项目时，新项目画布上新生成的角色卡
 * 会因旧项目存在同名卡而被 skip（且 skip 返回无 assetId、节点永不落 materialAssetId 标记），
 * 导致新项目设定库整批空缺（斩神2 仅 1/5 角色卡入库）、按名取卡/自动补绑全部落空、单人镜零身份锚。
 * owner 回退仅保留给「状态更新卡」（多剧集续作对旧资产 append-version），不再挡新项目首卡注册。
 */
export function decideAutoRegisterAction(input: {
  projectMatchAssetId: string | null;
  ownerMatchAssetId: string | null;
  hasStateMarker: boolean;
  newStyleFingerprint?: string | null;
  projectMatchStyleFingerprint?: string | null;
}): AutoRegisterAction {
  const matched = input.projectMatchAssetId || input.ownerMatchAssetId;
  if (!matched) return { action: "create" };
  if (input.hasStateMarker) return { action: "append-version", targetAssetId: matched };
  if (
    input.projectMatchAssetId &&
    input.newStyleFingerprint &&
    input.newStyleFingerprint !== input.projectMatchStyleFingerprint
  ) {
    return { action: "append-version", targetAssetId: input.projectMatchAssetId };
  }
  // 仅跨项目（owner 级）同名、本项目无此卡：按项目级隔离在当前项目建首卡。
  if (!input.projectMatchAssetId) return { action: "create" };
  return { action: "skip", reason: "duplicate-no-state" };
}

export function withMaterialRegistrationMarker(input: {
  nodeData: Record<string, unknown>;
  imageUrl: string;
  registration: { registered: boolean; assetId?: string };
}): Record<string, unknown> {
  if (!input.registration.assetId && !input.registration.registered) return input.nodeData;
  return {
    ...input.nodeData,
    ...(input.registration.assetId
      ? { materialAssetId: input.registration.assetId }
      : {}),
    materialRegisteredImageUrl: input.imageUrl,
  };
}

/**
 * 画布图节点的唯一真实图片读取器。
 *
 * 网页端恢复任务有时只持久化 `imageResults[]`，而同步 finalizer 会同时写
 * `imageUrl`。素材登记、显式同步和视频执行必须读取同一套事实，不能因为字段落在
 * 不同形态就把已经生成的图片当成“没有资产”。
 */
export function readDurableCanvasImageUrl(nodeData: Record<string, unknown>): string {
  const direct = String(nodeData.imageUrl ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const results = Array.isArray(nodeData.imageResults) ? nodeData.imageResults : [];
  const primaryIndex =
    typeof nodeData.imagePrimaryIndex === "number" && Number.isInteger(nodeData.imagePrimaryIndex)
      ? nodeData.imagePrimaryIndex
      : -1;
  const ordered =
    primaryIndex >= 0 && primaryIndex < results.length
      ? [results[primaryIndex], ...results.filter((_, index) => index !== primaryIndex)]
      : results;
  for (const item of ordered) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = String((item as Record<string, unknown>).url ?? "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

export function projectCardContractForMaterial(
  nodeData: Record<string, unknown>,
  kind: CanvasCardClassification["kind"],
): Record<string, unknown> {
  const stringValue = (key: string): string => String(nodeData[key] ?? "").trim();
  const stringArray = (key: string): string[] | undefined => {
    const value = nodeData[key];
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  };
  const objectValue = (key: string): Record<string, unknown> | undefined => {
    const value = nodeData[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  };

  if (kind === "character") {
    return {
      referenceType: "character",
      ...(stringValue("characterAssetRole")
        ? { characterAssetRole: stringValue("characterAssetRole") }
        : {}),
      ...(stringValue("characterProfileVersion")
        ? { characterProfileVersion: stringValue("characterProfileVersion") }
        : {}),
      ...(stringArray("identityAnchors")
        ? { identityAnchors: stringArray("identityAnchors") }
        : {}),
      ...(stringArray("prohibitedDrift")
        ? { prohibitedDrift: stringArray("prohibitedDrift") }
        : {}),
      ...(objectValue("identityBoardSpec")
        ? { identityBoardSpec: objectValue("identityBoardSpec") }
        : {}),
    };
  }
  if (kind === "scene") {
    return {
      referenceType: "scene",
      ...(stringValue("sceneAssetRole")
        ? { sceneAssetRole: stringValue("sceneAssetRole") }
        : {}),
      ...(stringValue("sceneProfileVersion")
        ? { sceneProfileVersion: stringValue("sceneProfileVersion") }
        : {}),
      ...(stringArray("sceneAnchors") ? { sceneAnchors: stringArray("sceneAnchors") } : {}),
      ...(stringArray("prohibitedSceneDrift")
        ? { prohibitedSceneDrift: stringArray("prohibitedSceneDrift") }
        : {}),
      ...(objectValue("sceneLightingSpec")
        ? { sceneLightingSpec: objectValue("sceneLightingSpec") }
        : {}),
    };
  }
  if (kind === "prop") {
    return {
      referenceType: "prop",
      ...(stringValue("propAssetRole")
        ? { propAssetRole: stringValue("propAssetRole") }
        : {}),
      ...(stringValue("propProfileVersion")
        ? { propProfileVersion: stringValue("propProfileVersion") }
        : {}),
      ...(stringArray("propAnchors") ? { propAnchors: stringArray("propAnchors") } : {}),
      ...(stringArray("prohibitedPropDrift")
        ? { prohibitedPropDrift: stringArray("prohibitedPropDrift") }
        : {}),
      ...(objectValue("propBoardSpec")
        ? { propBoardSpec: objectValue("propBoardSpec") }
        : {}),
      ...(objectValue("propFunctionSpec")
        ? { propFunctionSpec: objectValue("propFunctionSpec") }
        : {}),
      ...(objectValue("materialIdentity")
        ? { materialIdentity: objectValue("materialIdentity") }
        : {}),
    };
  }
  return {};
}

/**
 * 将当前画布上已经存在的真实图片按调用方提供的 canonical 身份同步到项目素材库。
 *
 * 这里不从 prompt/label 猜名字：视频 BeatSheet 或显式 sync 工具必须给出 kind/name，
 * nodeId 只负责把身份绑定到当前项目中唯一的真实图片。若 canonical asset 已存在且
 * 指向同一 URL，复用原 asset；若同一 URL 已经被另一个身份占用，则保留两边事实并
 * 返回冲突，绝不改名、覆盖或制造同图别名。
 */
export async function syncCanvasCardToMaterial(input: {
  c: AppContext;
  userId: string;
  projectId: string;
  imageUrl: string;
  nodeData: Record<string, unknown> | null | undefined;
  nodeId?: string;
  binding: {
    kind: CanvasCardClassification["kind"];
    name: string;
    materialIdentity?: Record<string, unknown>;
  };
}): Promise<{
  synced: boolean;
  assetId?: string;
  name: string;
  kind: CanvasCardClassification["kind"];
  reason?:
    | "created"
    | "existing_canonical"
    | "canonical_points_to_other_image"
    | "image_already_bound_to_other_identity"
    | "invalid_image_url"
    | "invalid_binding";
}> {
  const kind = input.binding.kind;
  const name = String(input.binding.name ?? "").trim();
  const imageUrl = String(input.imageUrl ?? "").trim();
  if (!/^https?:\/\//.test(imageUrl)) {
    return { synced: false, name, kind, reason: "invalid_image_url" };
  }
  if (!name || !input.projectId.trim()) {
    return { synced: false, name, kind, reason: "invalid_binding" };
  }

  const assets = await listMaterialAssetsForOwner(input.c, input.userId, {
    projectId: input.projectId.trim(),
  });
  const kindAssets = assets.filter((asset) => asset.kind === kind);
  const exact = kindAssets.find((asset) => String(asset.name ?? "").trim() === name);
  const sameImage = assets.find((asset) => {
    const data = asset.latestVersion?.data;
    return data && typeof data === "object" && String(data.imageUrl ?? "").trim() === imageUrl;
  });

  if (exact) {
    const exactImage =
      exact.latestVersion?.data && typeof exact.latestVersion.data === "object"
        ? String(exact.latestVersion.data.imageUrl ?? "").trim()
        : "";
    return {
      synced: exactImage === imageUrl,
      assetId: exact.id,
      name,
      kind,
      reason: exactImage === imageUrl ? "existing_canonical" : "canonical_points_to_other_image",
    };
  }

  if (sameImage) {
    return {
      synced: false,
      assetId: sameImage.id,
      name,
      kind,
      reason: "image_already_bound_to_other_identity",
    };
  }

  const nodeData = input.nodeData ?? {};
  const versionData: Record<string, unknown> = {
    imageUrl,
    ...(kind === "character" ? { roleName: name } : {}),
    ...(kind === "scene" ? { sceneName: name } : {}),
    ...projectCardContractForMaterial(nodeData, kind),
    ...(kind === "prop"
      ? {
          propName: name,
          materialIdentity:
            input.binding.materialIdentity ?? { mode: "base", canonicalName: name },
        }
      : {}),
    ...(input.nodeId ? { sourceNodeId: input.nodeId } : {}),
    ...(String(nodeData.prompt ?? "").trim() ? { prompt: String(nodeData.prompt).trim() } : {}),
    ...(String(nodeData.styleLockId ?? "").trim()
      ? { styleLockId: String(nodeData.styleLockId).trim() }
      : {}),
    ...(String(nodeData.styleFingerprint ?? "").trim()
      ? { styleFingerprint: String(nodeData.styleFingerprint).trim() }
      : {}),
    ...(String(nodeData.styleSource ?? "").trim() ? { styleSource: String(nodeData.styleSource).trim() } : {}),
    autoRegistered: true,
  };
  const created = await createMaterialAssetForOwner(input.c, input.userId, {
    projectId: input.projectId.trim(),
    kind,
    name,
    initialData: versionData,
  } as never);
  return { synced: true, assetId: created.asset.id, name, kind, reason: "created" };
}

export async function maybeAutoRegisterCanvasCard(input: {
  c: AppContext;
  userId: string;
  imageUrl: string;
  nodeData: Record<string, unknown> | null | undefined;
  nodeId?: string;
  chapterId?: string;
  flowId?: string;
}): Promise<{
  registered: boolean;
  kind?: string;
  name?: string;
  versioned?: boolean;
  assetId?: string;
}> {
  try {
    const imageUrl = String(input.imageUrl ?? "").trim();
    if (!/^https?:\/\//.test(imageUrl)) return { registered: false };
    const cls = classifyCanvasCardForRegistry(input.nodeData);
    if (!cls) return { registered: false };

    // 解出 projectId（章节优先；flow 兜底）。解不出就不注册（设定库按项目作用域才有意义）。
    let projectId = "";
    const prisma = getPrismaClient();
    if (input.chapterId) {
      const ch = await prisma.chapters.findUnique({
        where: { id: input.chapterId },
        select: { project_id: true },
      });
      projectId = ch?.project_id ?? "";
    } else if (input.flowId) {
      const fl = await prisma.flows.findUnique({
        where: { id: input.flowId },
        select: { project_id: true },
      });
      projectId = fl?.project_id ?? "";
    }
    if (!projectId) return { registered: false };

    // 同名查找：先 project 级，再 owner 级回退（跨项目主设定库命中也算同一身份）。
    const findByName = (assets: Awaited<ReturnType<typeof listMaterialAssetsForOwner>>) =>
			assets.find((a) => String(a.name ?? "").trim() === cls.name) ?? null;
    const projectAssets = await listMaterialAssetsForOwner(input.c, input.userId, {
      projectId,
      kind: cls.kind,
    });
    const projectMatch = findByName(projectAssets);
    const projectMatchAssetId = projectMatch?.id ?? null;
    let ownerMatch: ReturnType<typeof findByName> = null;
    if (!projectMatch) {
      const ownerAssets = await listMaterialAssetsForOwner(input.c, input.userId, {
        kind: cls.kind,
      });
      ownerMatch = findByName(ownerAssets);
    }
    const ownerMatchAssetId = ownerMatch?.id ?? null;

    const d = input.nodeData ?? {};
    const stateMarker = readCanvasCardStateMarker(d);
    const propMaterialIdentity = readPropMaterialIdentity(d);
    if (
      propMaterialIdentity?.mode === "state" &&
      projectMatchAssetId !== propMaterialIdentity.canonicalAssetId
    ) {
      throw new Error(
        `prop_state_canonical_asset_mismatch: expected=${propMaterialIdentity.canonicalAssetId} actual=${projectMatchAssetId ?? "missing"}`,
      );
    }
    const decision = decideAutoRegisterAction({
      projectMatchAssetId,
      ownerMatchAssetId,
      hasStateMarker: stateMarker != null,
      newStyleFingerprint: readStyleFingerprint(d),
      projectMatchStyleFingerprint: readStyleFingerprint(projectMatch?.latestVersion?.data),
    });

    const versionData = {
      imageUrl,
      ...(String(d.prompt ?? "").trim() ? { prompt: String(d.prompt).trim() } : {}),
      ...(cls.kind === "character" ? { roleName: cls.name } : {}),
      ...(cls.kind === "scene" ? { sceneName: cls.name } : {}),
      ...projectCardContractForMaterial(d, cls.kind),
      ...(cls.kind === "character" && String(d.approvalStatus ?? "").trim()
        ? { approvalStatus: String(d.approvalStatus).trim() }
        : {}),
      // 群像图：记录同框参与者（主角 + 路人A/B/C），供后续群像镜按组复用/比对人数。
      ...(cls.kind === "ensemble"
        ? {
            referenceType: "ensemble",
            ...(Array.isArray((d as Record<string, unknown>).characterRoleNames)
              ? { ensembleParticipants: (d as Record<string, unknown>).characterRoleNames }
              : {}),
          }
        : {}),
      // 姿态图：记录主角与涉及道具（人物×道具组合形态），供同姿势跨镜跨章按名复用。
      ...(cls.kind === "pose"
        ? {
            referenceType: "pose",
            ...(Array.isArray((d as Record<string, unknown>).characterRoleNames)
              ? { poseParticipants: (d as Record<string, unknown>).characterRoleNames }
              : {}),
            ...(Array.isArray((d as Record<string, unknown>).propNames)
              ? { posePropNames: (d as Record<string, unknown>).propNames }
              : {}),
          }
        : {}),
      ...(stateMarker?.stateDescription
        ? { stateDescription: stateMarker.stateDescription }
        : {}),
      ...(stateMarker?.stateKey ? { stateKey: stateMarker.stateKey } : {}),
      ...(propMaterialIdentity ? { materialIdentity: propMaterialIdentity } : {}),
      ...(String(d.styleLockId ?? "").trim() ? { styleLockId: String(d.styleLockId).trim() } : {}),
      ...(String(d.styleFingerprint ?? "").trim()
        ? { styleFingerprint: String(d.styleFingerprint).trim() }
        : {}),
      ...(String(d.styleSource ?? "").trim() ? { styleSource: String(d.styleSource).trim() } : {}),
      ...(Array.isArray(d.styleReferenceImages)
        ? {
            styleReferenceImages: d.styleReferenceImages
              .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
              .map((value) => value.trim()),
          }
        : {}),
      ...(input.nodeId ? { sourceNodeId: input.nodeId } : {}),
      ...(input.chapterId ? { sourceChapterId: input.chapterId } : {}),
      autoRegistered: true,
    };

    if (decision.action === "skip") {
      return {
        registered: false,
        kind: cls.kind,
        name: cls.name,
        assetId: projectMatchAssetId ?? undefined,
      };
    }

    if (decision.action === "append-version") {
      await createMaterialVersionForOwner(input.c, input.userId, decision.targetAssetId, {
        data: versionData,
        note: stateMarker?.stateDescription
          ? `章节状态更新：${stateMarker.stateDescription}`
          : readStyleFingerprint(d)
            ? "项目画风版本更新"
            : "章节状态更新",
      } as never);
      return {
        registered: true,
        versioned: true,
        kind: cls.kind,
        name: cls.name,
        assetId: decision.targetAssetId,
      };
    }

    const created = await createMaterialAssetForOwner(input.c, input.userId, {
      projectId,
      kind: cls.kind,
      name: cls.name,
      initialData: versionData,
    } as never);
    let createdId = (created as { asset?: { id?: string } })?.asset?.id;
    // 【并发注册 TOCTOU 自愈·2026-07-10 ch11 群像实测】两条收尾路径 2ms 内同时「查同名→没有→create」
    // 会裂出两条同名资产（material_assets 无唯一约束）。create 后复查：同名 ≥2 时保留最早创建的
    // （首卡为准），自己不是赢家就自删、返回赢家 id——两侧同规则，竞态收敛到一条。best-effort。
    if (createdId) {
      try {
        const dupCheck = await listMaterialAssetsForOwner(input.c, input.userId, {
          projectId,
          kind: cls.kind,
        });
        const sameName = dupCheck
          .filter((a) => String(a.name ?? "").trim() === cls.name)
          .sort((a, b) =>
            String((a as { createdAt?: unknown }).createdAt ?? "").localeCompare(
              String((b as { createdAt?: unknown }).createdAt ?? ""),
            ),
          );
        const winner = sameName[0];
        if (winner && sameName.length > 1 && winner.id !== createdId) {
          await deleteMaterialAssetForOwner(input.c, input.userId, createdId);
          console.warn(
            `[material-auto-register] 并发同名注册收敛: kind=${cls.kind} name=${cls.name} 删除后建 ${createdId}，保留首卡 ${winner.id}`,
          );
          createdId = winner.id;
        }
      } catch {
        // 去重复查失败不影响注册结果
      }
    }
    return {
      registered: true,
      kind: cls.kind,
      name: cls.name,
      assetId: createdId,
    };
  } catch (e) {
    // 注册失败绝不阻断出图主链路。
    console.warn(
      `[material-auto-register] failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { registered: false };
  }
}

/**
 * 【项目资产注册 sweep·堵「网页端恢复完成」注册漏洞】（2026-07-10 ch9/ch10/ch11 混元金斗实测）
 *
 * 病根：异步出图若由网页端 remoteRunner「图像任务已恢复完成」收尾（浏览器轮询 /tasks/result 后
 * 直接整图 PUT 画布），完全不经服务端 finalizer → maybeAutoRegisterCanvasCard 永不执行 →
 * 卡片只活在 canvas_flow JSON 里、设定库永远没有 → 下一章盘点视为缺口重画（金斗三章画了三个设计）。
 *
 * 修法：章节画布保存（putChapterCanvasFlow）时对 status=success 的卡节点做 best-effort 注册 sweep。
 * 幂等靠节点内标记：注册（或确认同名已存在）后就地写 data.materialAssetId 与
 * data.materialRegisteredImageUrl=当前图 URL —— 标记随本次保存一起落库，后续保存同 URL 直接跳过
 * （零 DB 查询）；重画/状态版换了 imageUrl 才再走一次三分支状态机（create/append-version/skip）。
 * 就地 mutate 节点 data，由调用方随保存持久化。单节点失败只记日志，绝不阻断保存。
 */
export async function sweepRegisterCanvasCards(input: {
  c: AppContext;
  userId: string;
  chapterId?: string;
  flowId?: string;
  nodes: Array<{ id?: unknown; data?: unknown }>;
}): Promise<{ swept: number; registered: number }> {
  let swept = 0;
  let registered = 0;
  if (!input.chapterId && !input.flowId) return { swept, registered };
  const MAX_SWEEP_PER_SAVE = 64;
  for (const node of input.nodes ?? []) {
    if (swept >= MAX_SWEEP_PER_SAVE) break;
    const d =
      node?.data && typeof node.data === "object" && !Array.isArray(node.data)
        ? (node.data as Record<string, unknown>)
        : null;
    if (!d) continue;
    const status = String(d.status ?? "").trim().toLowerCase();
    if (status !== "success") continue;
    try {
      const audioType = String(d.audioType ?? "").trim().toLowerCase();
      if (audioType === "voice_card") {
        // 配音卡：无 imageUrl，materialAssetId 标记本身即幂等键（同名首卡为准，注册一次到位）。
        if (String(d.materialAssetId ?? "").trim()) continue;
        swept += 1;
        const res = await maybeAutoRegisterVoiceCard({
          c: input.c,
          userId: input.userId,
          nodeData: d,
          nodeId: String(node.id ?? "") || undefined,
          ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          ...(input.flowId ? { flowId: input.flowId } : {}),
        });
        if (res.assetId) d.materialAssetId = res.assetId;
        if (res.registered) registered += 1;
        continue;
      }
      const imageUrl = readDurableCanvasImageUrl(d);
      if (!/^https?:\/\//.test(imageUrl)) continue;
      if (!classifyCanvasCardForRegistry(d)) continue;
      if (String(d.materialRegisteredImageUrl ?? "").trim() === imageUrl) continue;
      swept += 1;
      const res = await maybeAutoRegisterCanvasCard({
        c: input.c,
        userId: input.userId,
        imageUrl,
        nodeData: d,
        nodeId: String(node.id ?? "") || undefined,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(input.flowId ? { flowId: input.flowId } : {}),
      });
      // registered=false 但带 assetId＝同名已在库（skip 分支）——同样写标记，后续保存不再查库。
      if (res.assetId) d.materialAssetId = res.assetId;
      if (res.assetId || res.registered) d.materialRegisteredImageUrl = imageUrl;
      if (res.registered) {
        registered += 1;
        console.log(
          `[material-sweep] chapter=${input.chapterId} node=${String(node.id ?? "")} ` +
            `registered kind=${res.kind} name=${res.name}${res.versioned ? " (new version)" : ""}`,
        );
      }
    } catch (e) {
      console.warn(
        `[material-sweep] node=${String(node?.id ?? "")} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { swept, registered };
}

/**
 * 【配音卡自动入库·与角色卡对等】audio 节点（audioType=voice_card）生成成功即注册进 material_assets
 * kind=voice（name=voiceCharacter=角色名），供跨章按名复用（同角色跨章同一把嗓＝声音连续性），
 * 镜像角色卡的 maybeAutoRegisterCanvasCard。配音卡无 imageUrl（是音色锚），故走独立路径。
 * 同名去重（首卡为准）；best-effort 吞错不阻断。
 */
export async function maybeAutoRegisterVoiceCard(input: {
  c: AppContext;
  userId: string;
  nodeData: Record<string, unknown> | null | undefined;
  nodeId?: string;
  chapterId?: string;
  flowId?: string;
}): Promise<{ registered: boolean; name?: string; assetId?: string }> {
  try {
    const d = input.nodeData ?? {};
    const audioType = String(d.audioType ?? "").trim().toLowerCase();
    if (audioType !== "voice_card") return { registered: false };
    const name =
      String(d.voiceCharacter ?? "").trim() ||
      String(d.roleName ?? "").trim() ||
      String(d.character ?? "").trim();
    if (!name) return { registered: false };
    // 【孤儿治理·2026-07-17】龙套说话人（selfheal 判定无同名角色卡的临时叫法：围观路人/同伴甲/
    // 路人乙…）的卡只留画布供本章念白，不进项目库——每章临时叫法都入永久库会把素材库塞满孤儿
    // voice 资产（实测一个项目 20+ 条龙套卡）。配音卡入库资格与角色卡对称：有角色卡才配跨章锁嗓。
    if (d.ephemeralSpeaker === true) return { registered: false };

    const prisma = getPrismaClient();
    let projectId = "";
    if (input.chapterId) {
      const ch = await prisma.chapters.findUnique({
        where: { id: input.chapterId },
        select: { project_id: true },
      });
      projectId = ch?.project_id ?? "";
    } else if (input.flowId) {
      const fl = await prisma.flows.findUnique({
        where: { id: input.flowId },
        select: { project_id: true },
      });
      projectId = fl?.project_id ?? "";
    }
    if (!projectId) return { registered: false };

    // 同名去重（project 级）：已有同名配音卡 → 跳过（首卡为准，跨章按名复用同一把嗓）。
    const existing = await listMaterialAssetsForOwner(input.c, input.userId, {
      projectId,
      kind: "voice",
    });
    const match = existing.find((a) => String(a.name ?? "").trim() === name);
    if (match) return { registered: false, name, assetId: match.id };

    // 龙套名兜底闸（未带 ephemeralSpeaker 标记的旧节点/外部路径）：名字长得像临时龙套叫法
    // 且项目库没有同名角色卡 → 同样不入库（旁白除外，它是标准角色）。
    const GENERIC_EXTRA_RE =
      /(路人|围观|群众|观众|人群|吃瓜|路过|随从|士兵|喽啰|龙套|同伴|青年[甲乙丙丁]?$|[甲乙丙丁]$|某[人男女]?$)/;
    if (name !== "旁白" && GENERIC_EXTRA_RE.test(name)) {
      const chars = await listMaterialAssetsForOwner(input.c, input.userId, {
        projectId,
        kind: "character",
      });
      const hasCharCard = chars.some((a) => String(a.name ?? "").trim() === name);
      if (!hasCharCard) {
        console.log(`[voice-card-register] skip ephemeral speaker (无同名角色卡): ${name}`);
        return { registered: false, name };
      }
    }

    const versionData = {
      audioType: "voice_card",
      voiceCharacter: name,
      ...(String(d.doubaoVoiceId ?? "").trim()
        ? { doubaoVoiceId: String(d.doubaoVoiceId).trim() }
        : {}),
      ...(String(d.voiceLabel ?? "").trim() ? { voiceLabel: String(d.voiceLabel).trim() } : {}),
      ...(String(d.audioModel ?? "").trim() ? { audioModel: String(d.audioModel).trim() } : {}),
      ...(String(d.audioUrl ?? "").trim() ? { audioUrl: String(d.audioUrl).trim() } : {}),
      ...(input.nodeId ? { sourceNodeId: input.nodeId } : {}),
      ...(input.chapterId ? { sourceChapterId: input.chapterId } : {}),
      autoRegistered: true,
    };
    const created = await createMaterialAssetForOwner(input.c, input.userId, {
      projectId,
      kind: "voice",
      name,
      initialData: versionData,
    } as never);
    return {
      registered: true,
      name,
      assetId: (created as { asset?: { id?: string } })?.asset?.id,
    };
  } catch (e) {
    console.warn(
      `[voice-card-register] failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { registered: false };
  }
}
