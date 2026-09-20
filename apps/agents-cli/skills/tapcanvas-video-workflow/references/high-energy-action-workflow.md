# 高能超自然动作工作流扩展

本文件是 `tapcanvas-video-workflow` 的领域编排说明，不是新的工作流、route、模型选择器或质量门禁。它把用户明确的“日漫/超能力都市/校园战斗/15 秒高燃”等目标交给现有 Workflow IR 和逐 Clip writer。

## 依赖顺序

```text
用户交付合同
→ 真实角色卡/场景卡/道具与能力资产 URL
→ BeatSheet 的冻结事件、状态链、时长合同
→ video-prompt-writer
   → combat-action-expansion-standard
   → tapcanvas-high-energy-action（按需）
→ embedded reviewer 复盘并在同链修订
→ 真实视频提交与 delivery evidence
```

领域扩展只能消费上游真实事实，不能创建角色、能力、场景或“潮流战力”新设定。没有真实前置资产 URL 时，按工作流现有前置资产合同补跑上游节点；不要把 prompt、planned metadata、占位状态或连线当成可执行图片。

## 单 Clip 编排

1. 冻结用户给出的画幅、目标时长、是否需要对白/音乐/字幕、是否要跨 Clip 接力以及开放/收束状态。用户说“15 秒”时将其记录为当前 Clip 的 duration contract；不把 15 秒写成所有动作的固定镜头模板。
2. BeatSheet 只保留可验证的冲突事实：人物位置、能力来源和上限、可见目标、受力结果、环境边界、动作后状态。造型与能力的关系写入 `filmBible`/角色卡可见字段，不由 writer 临时发明。
3. writer 依据事件完成和状态交接分配 shots。高燃表现优先使用功能镜头快切、环绕/复合运镜、局部能力主形和物理声音；每一项都必须能回指动作信息，不以堆词代替动作。
4. 不是终镜时，末镜以开放运动交棒：动作仍向画外延伸，保留单一方向、遮挡或亮度锚、声桥和下一段可独立重建的起幅。终镜则只完成父任务冻结的结果，不统一追加定格。
5. reviewer 在同一 writer 上下文内复用现有维度复盘：事实/资产、动作因果、镜头执行、连续性、时长和声画可读性。发现缺口直接回灌修订；质量诊断不阻塞已受理媒体，也不创建额外 reviewer agent。

## 资产与交付证据

- 角色卡锁身份、服装和造型结构；能力参考图锁能力主形/材质；场景卡锁空座町/校园/都市空间锚。不同职责的图不互相替代。
- 若使用故事板或关键帧，只把真实 URL 和明确 `referenceRole` 交给 provider；多宫格设计板不是视频参考帧，除非父合同明确声明其作用。
- 交付仍以 `expectedDelivery → deliveryEvidence → deliveryVerification` 为准。prompt、估价、accepted_async 或节点文字不能冒充视频 URL；已生成视频只追加诊断和版本，不被复盘拦截或回滚。

