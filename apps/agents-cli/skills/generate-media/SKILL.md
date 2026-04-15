---
name: generate-media
description: 短剧媒体生成技能。基于已生成作品目录与视觉风格生成角色卡、场景/道具参考图与分镜图，维护 ref_index 与 media_index。涉及 TapCanvas `/public/draw`、`/public/tasks/result` 的实际接口请求时，必须统一通过 `tapcanvas-api` skill 执行，而不是在本 skill 内维护另一套 API 配置。
---

# Generate Media (TapCanvas Public API)

## Goal

将短剧/小说分镜生产链路中的“角色卡与分镜图”从简化版本升级为可复用的生产素材，且统一走 TapCanvas 公共接口：

- 图像生成：通过 `tapcanvas-api` 调用 `/public/draw`
- 任务轮询：通过 `tapcanvas-api` 调用 `/public/tasks/result`

禁止直接在技能内耦合三方 SDK（如 google-genai）；模型选择通过 `extras.modelAlias` 完成。

## Required Inputs

- 项目与作品标识：`projectId`、`bookId`
- 目标章节或集数范围：`chapter` 或 `start/end`
- 视觉风格：`assets.styleBible`（`styleLocked`、`consistencyRules`、`negativeDirectives`、`referenceImages`）
- 角色/场景/道具元数据：`chapters[].characters/props/scenes/locations`
- 已有角色卡：`assets.roleCards`（用于一致性参考）

## Output Contract

必须产出并回填以下结构（无兜底）：

1. `roleCards`: 每角色至少 1 张主参考图（可选多视角合成）
1.5 `visualRefs`:
   - `category=scene_prop`：每章节至少 1 张“场景+道具”参考图（默认单张 3x3 九宫格，最多 9 个元素）
   - `category=spell_fx`：涉及法术/特效时至少 1 张特效参考图
2. `storyboardChunks`: 每组镜头输出 `frameUrls` 与 `tailFrameUrl`
3. `ref_index` 与 `media_index`（按 book 维度）
4. 若任一步骤关键输入缺失，直接失败并返回可追踪错误

## Workflow

0. 触发判定（先判定再生成）
   - 非强制全量生成。仅当资产满足“可复用/需持久化”条件时触发生图。
   - 推荐判定：同名角色/场景/道具在跨章节复现（>=2 章）或被上游显式标记为长期锚点。
   - 未命中持久化条件时，不应为了凑齐素材而生成新图。

1. 风格锁定检查  
   - 若缺少已确认角色卡，不再中断流程；进入自动补齐阶段。

2. 角色卡生成（Phase 1）  
   - 以角色档案 + 章节阶段信息生成结构化 prompt。  
   - 使用 `tapcanvas-api` 调 `/public/draw` 的 `kind=image_edit|text_to_image`（按是否有参考图决定）。  
   - 将结果写回 `assets.roleCards`，状态置为 `generated`。
   - 分镜流程内若发现缺失角色卡，仅对“持久化候选角色”自动补齐，不要求用户先手工生成。

3. 场景/道具参考图（Phase 1B/1C）  
   - 从章节聚合 `scenes/props`，优先一次生成“单张 3x3 九宫格（9格）”参考图。  
   - 每格对应 1 个场景/道具元素，使用格位标签（1-9）与元素名建立映射。  
   - 结果写入 `assets.visualRefs`（`category=scene_prop`），供分镜与视频参考。
   - 元数据必须包含：`layout=3x3`、`cellLabels`（如 `#1:窗边木桌`）。  
   - 分镜流程内若缺少 scene_prop，仅在命中“持久化候选场景/道具”时自动补齐。

3.5 法术技能/特效参考图（Phase 1D）
   - 从章节冲突/动作节点提取法术或特效线索，生成稳定特效参考图。
   - 结果写入 `assets.visualRefs`（`category=spell_fx`）。

4. 分镜图生成（Phase 2）  
   - 按组（4/9）处理镜头，首镜必须注入上一组 `tailFrameUrl`。  
   - 每镜头都需注入角色参考图 + 场景道具参考图；涉及特效时再注入特效参考图。  
   - 参考图必须标注（角色名/场景道具名/特效名），并把引用 ID 回写到 `storyboardChunks`。  
   - 任何镜头未返回图片即失败，不允许模板兜底。
   - 在生成前，优先调用 `tapcanvas_storyboard_continuity_get` 校验上一组 `tailFrameUrl`、显式 chunk checkpoint、角色卡、视觉参考与 style bible 是否齐备。
   - `recentShots / storyboard history` 仅用于诊断，不得替代 chunk checkpoint 或 tail frame 作为续写边界。

5. 索引维护  
   - 更新 `storyboardChunks`、`media_index`、`ref_index`。  
   - 记录 `updatedAt/updatedBy`，保证可追溯。

## Prompt Rules

- 强制角色一致性：发型、脸型、服装、道具、年龄感不得漂移。
- 强制风格一致性：禁止跨美术体系切换。
- 分镜图必须明确镜头编号、构图重点、运动/机位语义。
- 出现多人场景时，必须标注角色映射关系（角色名 -> 参考图序号）。

## Failure Policy

- 关键输入缺失：`throw`（不降级、不补模板）
- 任务失败：记录 `taskId/vendor/status/error` 后终止当前批次
- 数量不一致（计划镜头数 != 成功输出数）：直接失败

## Notes

- 模型默认可使用 `nano-banana-pro`，也允许 `gemini-*image*` 别名；统一由 `tapcanvas-api -> /public/draw` 路由到供应商。
- 若需要轮询，必须通过 `tapcanvas-api` 调用 `/public/tasks/result`，不要假设同步返回结果。
