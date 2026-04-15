---
name: tapcanvas-demo-patterns
description: 把 assets/demo 提炼成运行时可用的视觉连续性方法论：先锁资产/角色/场景/镜头语义，再做扩镜与视频。
---

# TapCanvas Demo Patterns

## 来源边界

- 本 skill 已把 `assets/demo` 与对应分析文件的共性规律压缩成运行时方法论。
- 运行时直接使用本 skill，不直接把 `assets/demo` / `ai-metadata` 当作知识源读取。
- 你只能把这里的方法与本轮实时证据结合使用，不能把 demo 个案细节当成当前项目事实。

## 核心原则

1. 先锁锚点，再写 prompt；prompt 只是表达层，不是事实来源。
2. 图像层先成为连续性 authority，视频层只承担受约束的运动补完。
3. 一次只改一个大变量；不要把角色、场景、机位、光线、动作同时改写。
4. chapter-grounded 生产前，必须先盘点并区分：
   - 角色锚点：角色卡、三视图、`@角色名` 命中结果、章节已确认角色图
   - 场景锚点：权威基底帧、scene/prop reference、selectedReference.referenceBindings、上一组 `tailFrameUrl`
   - 镜头语义锚点：构图、景别、主体比例、朝向、拍摄语法、动作节拍
   - 连续性锚点：章节正文、source bundle、continuity checkpoint
5. 若只有角色卡而没有稳定场景锚点，不得直接批量生成多张图或多段视频；先建立权威基底帧。
6. 关键帧数量、镜头数量与视频段数不预设固定模板；应由主代理基于章节证据、连续性边界与当前目标自行决定。

## 资产锁定法

### 1. Freeze-all-except-one

- 明确声明“除一个变量外，其余全部保持不变”。
- 适用：
  - 改机位
  - 反打
  - 轻微道具变化
  - 背景清理

### 2. 先锁拍摄语法

- 先说明是谁在拍、从哪里拍、镜头是否固定、景别是什么，再谈风格或戏剧升级。
- 不要只写“电影感/震撼/高级感”。

### 3. 镜头语义先于风格迁移

- 若是跨风格改编，必须先冻结：
  - 构图
  - 主体比例
  - 朝向
  - 光影逻辑
  - 动作意图
- 风格迁移稳定后，才允许天气、眼部、道具、局部表情等微调。

### 4. 视频只继承，不重发明

- 视频 prompt 必须继承已锁定关键帧的：
  - 角色身份
  - 场景拓扑
  - 光线/时间
  - 镜头路径
  - 允许动作
- 视频里必须同时写：
  - 允许发生什么
  - 禁止发生什么

## chapter-grounded 生产顺序

1. 先读 `tapcanvas_storyboard_source_bundle_get`
2. 再读 `tapcanvas_storyboard_continuity_get`
3. 再读 `tapcanvas_flow_get` 或当前节点 bundle，确认当前画布状态
4. 列出：
   - confirmed facts
   - locked anchors
   - missing anchors
5. 判断当前属于：
   - `start_new_scene`
   - `continue_from_confirmed_anchor`
   - `repair_continuity`
   - `expand_locked_keyframe`
   - `prepare_video_from_locked_frames`
6. 若无权威基底帧，先创建/规划基底帧
7. 再做单变量扩镜
8. 选稳定关键帧后，再进入视频

## 结构化落板契约

- 当你要用 `tapcanvas_flow_patch` 创建或改写 chapter-grounded 的视觉节点时，本轮每一个相关视觉节点都必须在同一轮同步写入结构化 `data.productionMetadata`；禁止先落节点、下一轮再补 metadata。
- `productionMetadata` 推荐挂在 companion `text` / `storyboardScript` 节点，或显式 patch 到当前章节脚本节点；不要把它埋成只存在于自然语言说明里的隐含判断。

推荐结构：

```json
{
  "chapterGrounded": true,
  "lockedAnchors": {
    "character": ["..."],
    "scene": ["..."],
    "shot": ["..."],
    "continuity": ["..."],
    "missing": ["..."]
  },
  "authorityBaseFrame": {
    "status": "planned | confirmed",
    "source": "selected_reference | tail_frame | existing_flow_anchor | generate_first",
    "reason": "..."
  }
}
```

- `lockedAnchors` 不是装饰字段；至少要把角色、场景、镜头、连续性、缺口分开写清。
- 若本轮要立即执行真实基底帧，`authorityBaseFrame.status` 可以先是 `planned`，但执行态仍应停在“基底帧计划 + 单张 image-like 基底帧节点”。
- 若本轮只是先搭建待执行图谱，可以在 `planned` 下先落 `group + script + pending/needs_confirmation` 的关键帧/视频占位节点，但必须把 `lockedAnchors.missing` 明确写出“基底帧待确认”，且不能把这些节点描述成已出图或已出视频。
- 只要本轮开始落回真实多图/视频结果，或把批量视觉结果写成已执行状态，`authorityBaseFrame.status` 就必须已经是 `confirmed`。

## 多代理分工

- `research`
  - 提取章节事实、角色状态、连续性义务、可用锚点
  - 明确哪些只是 diagnostics，不能当 source of truth
- `writer`
  - 用已确认锚点起草节点、关键帧 prompt、视频 prompt
