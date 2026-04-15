# Chapter Range 与跨章节一致性 Checklist

更新时间：2026-04-01（年龄/状态连续性门禁已补齐）  
范围：`apps/web/src/ui/chat`、`apps/hono-api/src/modules/task/task.agents-bridge.ts`、`apps/web/src/runner/remoteRunner.ts`

## 现状结论（先记录）

- [x] 当前对话链路仅支持**单 chapterId**语义，不支持 `chapterStart/chapterEnd` 区间执行。
  - 证据：
    - `task.agents-bridge.ts` 仅有 `extractExplicitChapterIdFromPrompt(...)`，提取单个 `第X章`。
    - `PublicChatRequestDto` 仅定义 `bookId/chapterId`，无 range 字段。
- [x] 当前已存在跨章节一致性基础能力，但仍是“单章注入优先”。
  - 证据：
    - mention 角色绑定注入：`resolveMentionRoleAssetInputs(...)`
    - 章节连续性注入：`resolveChapterContinuityAssetInputs(...)`
    - 尾帧延续：从 `assets.storyboardChunks[].tailFrameUrl` 注入 `context` 参考
    - 高风险诊断：`chapter_grounded_reference_binding_missing` / `chapter_grounded_character_binding_missing`

## P0（必须完成）

- [ ] **P0-1 协议升级：支持 chapter range 入参**
  - 目标：`/public/chat` 与前端请求支持 `chapterStart/chapterEnd`，并与 `chapterId` 互斥校验。
  - 验收标准：
    - 用户输入“第三章到第四章”可解析为 `chapterStart=3, chapterEnd=4`。
    - 反向区间（start > end）显式报错，不兜底交换。

- [ ] **P0-2 scope 解析升级：从“单章”改为“窗口”**
  - 目标：agents-bridge 从 `bookId + chapter range` 解析有效章节窗口，并在 diagnosticContext 回传。
  - 验收标准：
    - trace/meta 可见 `chapterWindow: { start, end }`。
    - 无 bookId 时不允许凭 range 盲跑，显式失败并指出缺口。

- [ ] **P0-3 连续性注入升级：按窗口逐章组装锚点**
  - 目标：对窗口内每章注入角色卡 + 尾帧 continuity，不再只注入单章。
  - 验收标准：
    - 每章都能拿到 `roleNameKeys` 与 `tailFrameUrl`（缺失则记录具体章节缺口）。
    - 允许部分章节失败但必须结构化返回章节级失败原因。

- [ ] **P0-4 执行门禁升级：跨章一致性硬约束**
  - 目标：当请求是 range 生产时，禁止“只给文本/只给 prompt”被判完成。
  - 验收标准：
    - 若仅生成 storyboard prompt 无图：`turnVerdict=failed`（含高优先级原因码）。
    - 若角色绑定丢失：命中 `chapter_grounded_character_binding_missing`。

- [x] **P0-5 提示词字段硬约束：角色/道具/场景/资产必须结构化落位**
  - 目标：章节可视节点在有锚点输入时，不允许只靠自然语言 prompt；必须在结构化字段中显式保留绑定。
  - 验收标准：
    - `structuredPrompt` 在 chapter-grounded 场景下除基础字段外，必须满足：
      - `referenceBindings` 非空（至少包含角色卡/道具/场景中已注入锚点）
      - `identityConstraints` 非空（存在角色绑定时必须有）
      - `environmentObjects` 非空（存在道具/场景锚点时必须有）
    - 节点数据必须持久化 `assetInputs`（含 `assetRefId/role/url`）与 `referenceImages`，不能只在 prompt 文案体现。
    - 不满足时 turn verdict 失败，并返回明确原因码（新增细粒度 diagnostic flag）。
  - 完成情况（2026-04-01）：
    - `task.agents-bridge.ts` 已新增失败码并进入 hard-failure：`image_prompt_spec_v2_reference_bindings_missing` / `image_prompt_spec_v2_identity_constraints_missing` / `image_prompt_spec_v2_environment_objects_missing`。
    - `buildImagePromptSpecGovernanceSummary(...)` 已在 chapter-grounded + anchor 输入场景强制校验上述字段，不满足直接失败。

- [x] **P0-6 年龄与状态连续性硬约束（新增）**
  - 目标：提示词生成与章节续写必须显式携带角色年龄与状态锚点，禁止跨章无因跳变。
  - 验收标准：
    - chapter continuity 注入时，角色卡元数据会透传 `ageDescription/stateDescription/stateKey` 到 `assetInputs.note` 与 prompt。
    - prompt 注入必须出现 `【角色年龄与状态连续性约束】`。
    - 章节角色缺少年龄/状态证据时，turn verdict 失败并给出 `chapter_grounded_character_state_missing`。
    - 存在角色状态证据但 `structuredPrompt.continuityConstraints` 为空时，turn verdict 失败并给出 `image_prompt_spec_v2_character_continuity_missing`。

## P1（高优）

- [ ] **P1-1 人物一致性：统一角色身份主键**
  - 目标：节点侧统一使用 `roleCardId + roleName + assetRefId` 作为角色身份锚，不允许只靠自然语言描述人物。
  - 验收标准：
    - 跨章节点均持久化 `assetInputs(role=character)` 或有显式角色参考边。
    - 回放任意章节生成请求，可追溯角色来源资产。

- [ ] **P1-2 道具一致性：道具资产显式建模**
  - 目标：道具不再混入普通 `reference`；增加可识别道具角色（建议 `role=product` + `assetRefId`）。
  - 验收标准：
    - 跨章同一道具可稳定复用同一 `assetRefId`。
    - 缺失道具锚点时给出章节级告警，不静默降级。

- [ ] **P1-3 分章结果回填：窗口产物写回可追溯元数据**
  - 目标：窗口执行后按章写回 `storyboardChunks`/章节产物索引，保证下一轮可续跑。
  - 验收标准：
    - 每章存在独立产物记录（时间、尾帧、关键锚点来源）。
    - 下一次从中间章续写可自动读取上一章尾帧。

## 验证清单（完成后打勾）

- [ ] 用“完成第三章到第四章的定格动画关键帧创作”实测，生成请求含 `chapterWindow`。
- [ ] chapter 3 与 chapter 4 的同名角色在结果里保持同一角色资产绑定（`assetRefId/roleCardId`）。
- [ ] chapter 3 与 chapter 4 的同一道具保持同一资产锚点（非仅 prompt 文案一致）。
- [ ] 任何章节缺锚点时显式失败并带章节号，不出现“整体成功但局部丢失”的伪成功。
- [x] chapter-grounded 提示词注入已包含“年龄/状态连续性约束”区块；缺少角色状态证据或缺少 continuityConstraints 时会显式失败。
