# 高能超自然动作扩展的来源回执

这份回执只用于离线治理和 provenance，不是运行时模板，也不构成完成门槛。

| sourceId | 来源 | 可迁移方法 | 禁止迁移 |
|---|---|---|---|
| `muapi-storyboard-driven-action` | [Generative Media Skills · ai-fight-scene](https://github.com/samuraigpt/generative-media-skills/blob/main/library/motion/ai-fight-scene/SKILL.md) | 角色/环境锚定、先做动作预演再进入图生视频、用连续状态检查动作接力 | 固定 4×4 镜头配额、第三方角色、固定供应商参数 |
| `seedance-action-director-density` | [Higgsfield Seedance Fight Scenes](https://github.com/beshuaxian/higgsfield-seedance2-jineng/blob/main/skills/05-fight-scenes/SKILL.md) | 目标—动作—反作用编舞、摄影机与节奏同步、声音作为接触反馈 | 固定招式清单、品牌/作品复刻、把节奏词当硬闸 |

## 合同映射

两份来源只映射到现有 `tapcanvas/video-prompt-authoring@3.7.0` 维度：

- `action_causality_physics`：动作目标、接触、反作用、能力生命周期。
- `camera_composition_and_lens`：空间锚、环绕与复合轨迹、切点动机。
- `continuity_and_exit_state`：上一拍状态交接、动作中切、跨 Clip 低熵接口。
- `sound_and_narrative_legibility`：物理声源、声桥、能力与材质反馈。
- `asset_roles_and_identity`：角色卡、场景卡、造型和能力参考的职责边界。

没有新增 S/B 标准、权重、镜头数、字数或分数。

