import { describe, expect, it } from "vitest";
import {
  classifyCanvasCardForRegistry,
  decideAutoRegisterAction,
  projectCardContractForMaterial,
  readDurableCanvasImageUrl,
  readCanvasCardStateMarker,
  withMaterialRegistrationMarker,
} from "./material-auto-register";

describe("projectCardContractForMaterial", () => {
  it("preserves the canonical prop identity, board, function, and state contracts", () => {
    expect(
      projectCardContractForMaterial(
        {
          propAssetRole: "state_variant",
          propProfileVersion: "prop-card/v1",
          propAnchors: ["三道平行刻痕"],
          prohibitedPropDrift: ["匙齿缺口不可消失"],
          propBoardSpec: { version: "prop-board/v1", viewRoles: ["hero", "side"] },
          propFunctionSpec: {
            version: "prop-function/v1",
            physicalEnvelope: "略长于普通门钥匙",
          },
          materialIdentity: {
            mode: "state",
            canonicalName: "旧铜钥匙",
            canonicalAssetId: "asset-key-1",
            stateKey: "bent",
            stateDescription: "匙杆轻微弯曲",
          },
        },
        "prop",
      ),
    ).toEqual({
      referenceType: "prop",
      propAssetRole: "state_variant",
      propProfileVersion: "prop-card/v1",
      propAnchors: ["三道平行刻痕"],
      prohibitedPropDrift: ["匙齿缺口不可消失"],
      propBoardSpec: { version: "prop-board/v1", viewRoles: ["hero", "side"] },
      propFunctionSpec: {
        version: "prop-function/v1",
        physicalEnvelope: "略长于普通门钥匙",
      },
      materialIdentity: {
        mode: "state",
        canonicalName: "旧铜钥匙",
        canonicalAssetId: "asset-key-1",
        stateKey: "bent",
        stateDescription: "匙杆轻微弯曲",
      },
    });
  });
});

describe("readDurableCanvasImageUrl", () => {
  it("prefers the primary image result when direct imageUrl is absent", () => {
    expect(
      readDurableCanvasImageUrl({
        imagePrimaryIndex: 1,
        imageResults: [
          { url: "https://example.com/first.png" },
          { url: "https://example.com/primary.png" },
        ],
      }),
    ).toBe("https://example.com/primary.png");
  });

  it("prefers direct imageUrl when both durable forms exist", () => {
    expect(
      readDurableCanvasImageUrl({
        imageUrl: "https://example.com/direct.png",
        imageResults: [{ url: "https://example.com/result.png" }],
      }),
    ).toBe("https://example.com/direct.png");
  });
});

describe("withMaterialRegistrationMarker", () => {
  it("persists the image registration marker so the chapter sweep stays idempotent", () => {
    const original = { status: "success", imageUrl: "https://example.com/card.png" };
    expect(
      withMaterialRegistrationMarker({
        nodeData: original,
        imageUrl: "https://example.com/card.png",
        registration: { registered: true, assetId: "asset-1" },
      }),
    ).toEqual({
      status: "success",
      imageUrl: "https://example.com/card.png",
      materialAssetId: "asset-1",
      materialRegisteredImageUrl: "https://example.com/card.png",
    });
    expect(original).toEqual({
      status: "success",
      imageUrl: "https://example.com/card.png",
    });
  });

  it("does not mark a failed registration", () => {
    const original = { status: "success" };
    expect(
      withMaterialRegistrationMarker({
        nodeData: original,
        imageUrl: "https://example.com/card.png",
        registration: { registered: false },
      }),
    ).toBe(original);
  });
});

describe("classifyCanvasCardForRegistry", () => {
  it("character-card/v3 机器合同识别为 character", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "character",
        roleName: "方源",
        characterProfileVersion: "character-card/v3",
        label: "角色卡｜方源",
      }),
    ).toEqual({ kind: "character", name: "方源" });
  });
  it("scene-card/v1 机器合同识别为 scene，旧 label-only 路径被删除", () => {
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "场景卡｜花酒秘洞与影壁" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "CH48 场景锚·暴雨官道" })).toBeNull();
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "卫生所",
        sceneProfileVersion: "scene-card/v1",
        label: "卫生所｜场景卡",
      }),
    ).toEqual({ kind: "scene", name: "卫生所" });
  });
  it("显式 propName 优先于展示 label", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "prop",
        propName: "离婚报告",
        label: "离婚报告｜道具卡",
      }),
    ).toEqual({ kind: "prop", name: "离婚报告" });
  });
  it("分镜帧/视频/普通图不注册", () => {
    expect(classifyCanvasCardForRegistry({ kind: "storyboardImage", label: "Storyboard clip 2" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "video", label: "场景卡｜x" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "Generated Image" })).toBeNull();
    expect(classifyCanvasCardForRegistry(undefined)).toBeNull();
  });
  it("imageEdit 产出的设定卡也注册（2026-07-17 ch1 实测：编辑是衍生角色卡的正统路径，此前全成孤儿）", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "imageEdit",
        referenceType: "character",
        roleName: "同伴甲",
        characterProfileVersion: "character-card/v3",
        label: "角色卡｜同伴甲·街头青年·v3",
      }),
    ).toEqual({ kind: "character", name: "同伴甲" });
    expect(
      classifyCanvasCardForRegistry({ kind: "imageEdit", label: "群像图｜街角围观小年轻·v3c", roleName: "阿诺" }),
    ).toEqual({ kind: "ensemble", name: "街角围观小年轻" });
  });
  it("镜头帧类节点即使误带 roleName 也不注册（关键帧/分镜/站位图不是设定卡）", () => {
    expect(classifyCanvasCardForRegistry({ kind: "imageEdit", roleName: "林七夜", label: "关键帧｜镜5-6·挑油荒诞剪影落幅" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", roleName: "阿诺", label: "分镜设计板｜街角揭晓·6镜·v3" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", roleName: "阿诺", label: "俯视底图｜都市街角十字路口" })).toBeNull();
  });
  it("版本号后缀剥离（命名铁律：版本号进 name 即裂成每版一个新资产）", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "都市街角十字路口·v3",
        sceneProfileVersion: "scene-card/v1",
        label: "场景卡｜都市街角十字路口·v3",
      }),
    ).toEqual({ kind: "scene", name: "都市街角十字路口" });
  });
  it("姿态图识别为 pose（2026-07-16 用户拍板·类比群像图）：label 前缀 / referenceType，且优先于 roleName", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "姿态图｜林七夜·盲杖扁担挑双油桶" }),
    ).toEqual({ kind: "pose", name: "林七夜·盲杖扁担挑双油桶" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "pose",
        roleName: "林七夜",
        label: "扛油过马路",
      }),
    ).toEqual({ kind: "pose", name: "扛油过马路" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "姿势图：孟川·倒骑巨骨" }),
    ).toEqual({ kind: "pose", name: "孟川·倒骑巨骨" });
  });
  it("表情图归 pose 类目（2026-07-16 用户拍板：情绪变化也是资产，脸部形态锚与姿态图同族）", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "表情图｜林七夜·怒吼" }),
    ).toEqual({ kind: "pose", name: "林七夜·怒吼" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        roleName: "林七夜",
        label: "情绪图：林七夜·嘴角微笑",
      }),
    ).toEqual({ kind: "pose", name: "林七夜·嘴角微笑" });
  });
  it("结构化 scene contract 优先于误带 roleName", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "大殿",
        sceneProfileVersion: "scene-card/v1",
        roleName: "贾金生",
        label: "场景卡｜大殿",
      }),
    ).toEqual({ kind: "scene", name: "大殿" });
  });
  it("旧角色 label-only 识别路径被删除", () => {
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "角色卡｜夏繁星" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "身份板：傅南爵" })).toBeNull();
  });
  it("角色和场景必须携带 canonical 名与唯一 profileVersion", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "character",
        roleName: "赤枭",
        characterProfileVersion: "character-card/v3",
        label: "角色·赤枭",
      }),
    ).toEqual({ kind: "character", name: "赤枭" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "废墟庭院",
        sceneProfileVersion: "scene-card/v1",
        label: "场景·废墟庭院",
      }),
    ).toEqual({ kind: "scene", name: "废墟庭院" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "prop",
        label: "道具·断钢巨剑",
      }),
    ).toEqual({ kind: "prop", name: "断钢巨剑" });
  });
  it("裸「角色卡」无名字不注册（宁漏勿误）", () => {
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "角色卡" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "角色卡｜ " })).toBeNull();
  });
  it("道具卡/道具锚/道具参考标签识别为 prop 并剥前缀（根治道具飘：道具从此入库可复用）", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "道具卡｜山羊头骨面具" }),
    ).toEqual({ kind: "prop", name: "山羊头骨面具" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "道具锚·繁纹座钟" }),
    ).toEqual({ kind: "prop", name: "繁纹座钟" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "道具参考：钨丝吊灯" }),
    ).toEqual({ kind: "prop", name: "钨丝吊灯" });
  });
  it("referenceType=prop 显式标记识别为 prop", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", referenceType: "prop", label: "座钟" }),
    ).toEqual({ kind: "prop", name: "座钟" });
  });
  it("裸「道具卡」无名字不注册（宁漏勿误）", () => {
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "道具卡" })).toBeNull();
    expect(classifyCanvasCardForRegistry({ kind: "image", label: "道具卡｜ " })).toBeNull();
  });
  it("道具标签优先于 roleName（ch10 混元金斗实测：agent 给道具卡顺手写 roleName → 曾被误分类成角色）", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", roleName: "混元金斗", label: "道具卡｜混元金斗" }),
    ).toEqual({ kind: "prop", name: "混元金斗" });
  });
  it("道具状态使用 materialIdentity.canonicalName，不从展示标签裂出第二件资产", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "imageEdit",
        referenceType: "prop",
        label: "道具卡｜混元金斗清光",
        materialIdentity: {
          mode: "state",
          canonicalName: "混元金斗",
          canonicalAssetId: "asset-1",
          stateKey: "clear-light",
          stateDescription: "斗身释放清光",
        },
      }),
    ).toEqual({ kind: "prop", name: "混元金斗" });
  });
  it("法宝/灵宝/法器/武器/技能等器物别名一并归 prop（ch11 法宝卡实测）", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "法宝卡·混元金斗" }),
    ).toEqual({ kind: "prop", name: "混元金斗" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "武器卡｜弑神枪残体" }),
    ).toEqual({ kind: "prop", name: "弑神枪残体" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "技能卡：九转玄功第二转" }),
    ).toEqual({ kind: "prop", name: "九转玄功第二转" });
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "灵宝锚·混沌钟" }),
    ).toEqual({ kind: "prop", name: "混沌钟" });
  });
  it("怪物与妖兽同样必须走 character-card/v3 机器合同", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "character",
        roleName: "三头骷髅巨兽",
        characterProfileVersion: "character-card/v3",
        label: "怪物卡｜三头骷髅巨兽",
      }),
    ).toEqual({ kind: "character", name: "三头骷髅巨兽" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "character",
        roleName: "玄武",
        characterProfileVersion: "character-card/v3",
        label: "妖兽卡·玄武",
      }),
    ).toEqual({ kind: "character", name: "玄武" });
  });
  it("名字尾部章节标记统一剥掉（命名铁律：章节号永不进 name，防每章裂新资产）", () => {
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "道具卡｜极品先天灵宝·混元金斗(ch9)" }),
    ).toEqual({ kind: "prop", name: "极品先天灵宝·混元金斗" });
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "殿内祭坛·混元金斗悬浮（第9章）",
        sceneProfileVersion: "scene-card/v1",
        label: "场景卡｜殿内祭坛·混元金斗悬浮（第9章）",
      }),
    ).toEqual({ kind: "scene", name: "殿内祭坛·混元金斗悬浮" });
    // 非章节标记的括号后缀不动（状态语义靠 stateKey，名字兜底保留）。
    expect(
      classifyCanvasCardForRegistry({ kind: "image", label: "道具卡｜混元金斗（残缺）" }),
    ).toEqual({ kind: "prop", name: "混元金斗（残缺）" });
  });
  it("referenceType=scene 机器字段识别为 scene", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "scene",
        sceneName: "祭坛残殿",
        sceneProfileVersion: "scene-card/v1",
        label: "场景卡｜祭坛残殿",
      }),
    ).toEqual({ kind: "scene", name: "祭坛残殿" });
  });
  it("角色状态版卡仍归并回 roleName（label 带状态后缀不裂新资产）", () => {
    expect(
      classifyCanvasCardForRegistry({
        kind: "image",
        referenceType: "character",
        roleName: "孟川",
        characterProfileVersion: "character-card/v3",
        label: "角色卡·孟川（受伤态）",
        stateKey: "meng-wounded",
      }),
    ).toEqual({ kind: "character", name: "孟川" });
  });
});

describe("readCanvasCardStateMarker", () => {
  it("stateDescription/stateKey 任一非空即为状态更新卡", () => {
    expect(
      readCanvasCardStateMarker({ stateDescription: "左臂重伤缠绷带", stateKey: "injured-arm" }),
    ).toEqual({ stateDescription: "左臂重伤缠绷带", stateKey: "injured-arm" });
    expect(readCanvasCardStateMarker({ stateKey: "wedding-dress" })).toEqual({
      stateDescription: "",
      stateKey: "wedding-dress",
    });
  });
  it("无状态标记返回 null（空串/缺字段都算无）", () => {
    expect(readCanvasCardStateMarker({ roleName: "方源" })).toBeNull();
    expect(readCanvasCardStateMarker({ stateDescription: "  ", stateKey: "" })).toBeNull();
    expect(readCanvasCardStateMarker(undefined)).toBeNull();
  });
});

describe("decideAutoRegisterAction（多剧集三分支）", () => {
  it("分支①：双 scope 无同名 → create（现状逐字）", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: null,
        ownerMatchAssetId: null,
        hasStateMarker: false,
      }),
    ).toEqual({ action: "create" });
  });
  it("分支②：同名命中 + 状态标记 → 追加版本到原资产", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "asset-1",
        ownerMatchAssetId: null,
        hasStateMarker: true,
      }),
    ).toEqual({ action: "append-version", targetAssetId: "asset-1" });
  });
  it("分支②：owner 回退命中也追加到原资产（不在当前项目裂第二个同名资产）", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: null,
        ownerMatchAssetId: "owner-asset-9",
        hasStateMarker: true,
      }),
    ).toEqual({ action: "append-version", targetAssetId: "owner-asset-9" });
  });
  it("project 命中优先于 owner 命中", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "proj-asset",
        ownerMatchAssetId: "owner-asset",
        hasStateMarker: true,
      }),
    ).toEqual({ action: "append-version", targetAssetId: "proj-asset" });
  });
  it("同项目同名卡从无 provenance 迁移到当前画风时追加版本，保留历史", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "asset-legacy",
        ownerMatchAssetId: null,
        hasStateMarker: false,
        newStyleFingerprint: "sha256:current",
        projectMatchStyleFingerprint: null,
      }),
    ).toEqual({ action: "append-version", targetAssetId: "asset-legacy" });
  });
  it("同项目同名卡画风指纹变化时追加版本，指纹相同则保持首卡", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "asset-1",
        ownerMatchAssetId: null,
        hasStateMarker: false,
        newStyleFingerprint: "sha256:new",
        projectMatchStyleFingerprint: "sha256:old",
      }),
    ).toEqual({ action: "append-version", targetAssetId: "asset-1" });
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "asset-1",
        ownerMatchAssetId: null,
        hasStateMarker: false,
        newStyleFingerprint: "sha256:same",
        projectMatchStyleFingerprint: "sha256:same",
      }),
    ).toEqual({ action: "skip", reason: "duplicate-no-state" });
  });
  it("分支③：同名命中无状态标记 → skip（首卡为准，现状逐字）", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: "asset-1",
        ownerMatchAssetId: null,
        hasStateMarker: false,
      }),
    ).toEqual({ action: "skip", reason: "duplicate-no-state" });
  });
  it("修洞（2026-07-18 斩神2）：仅 owner 级跨项目同名 + 无状态标记 → create（项目级隔离，不挡新项目首卡）", () => {
    expect(
      decideAutoRegisterAction({
        projectMatchAssetId: null,
        ownerMatchAssetId: "old-project-asset",
        hasStateMarker: false,
      }),
    ).toEqual({ action: "create" });
  });
});
