# 文戏与对白工作流扩展

本文件是 `tapcanvas-video-workflow` 的领域编排说明，不是新的 route、模型选择器或质量门禁。它把人物关系、对白和潜台词交给现有 Workflow IR 与逐 Clip writer。

## 依赖顺序

```text
用户交付合同
→ 真实角色卡/场景卡/道具与授权音频事实
→ BeatSheet 冻结关系、对白、信息差、状态链、时长合同
→ video-prompt-writer
   → dramatic-direction-contract
   → tapcanvas-dialogue-drama（按需）
→ embedded reviewer 同链复盘并修订
→ 配音/视频节点
→ 真实资产 URL 与 delivery evidence
```

## 单 Clip 编排

1. BeatSheet 先区分源事实、人物所知、观众所知和未确认推断；原文对白逐字进入 `dialogueScript`，是否需要 VO/OS 进入冻结的 `narrativeAudioPlan`。
2. writer 为每个话轮写 `objective → tactic → listener stimulus → visible response → changed relationship/state`。潜台词进入动作、视线、姿态、停顿和道具，不进入 SpeechEvent 正文。
3. shots 先建立 blocking 与轴线，再按信息功能选择远/中/近/特写。对白窗口保持可口型表演的稳定机位；急推、甩镜和大幅动作放在无口型窗口。
4. `speechEvents` 使用完整唯一事件承载每句冻结台词；镜头只引用可见表演，不能在 `action/notes/sound` 重复对白正文。时长服从 `generationContract`，不使用固定句数或镜头数。
5. 非终镜以未完成话轮、保留道具、视线方向、呼吸相位或环境声床形成 editorial handoff；终镜只完成父任务冻结的关系/状态结果，不强行加拥抱、离场或解释性旁白。

## 资产与音频事实

- 角色卡锁身份、服装与声口事实；场景卡锁空间锚和声学环境；道具卡锁归属、状态和接触关系；授权 voice anchor 才能作为声线参考。
- 对白、VO/OS、BGM、SFX 和环境声分别记录来源与时段。没有真实音频资产时可以由工作流的配音节点生成，但不能伪造 URL；接受异步回执不等于音频完成。
- reviewer 只复用 `dialogue_and_voice_performance`、`audience_narrative_legibility`、`camera_composition_and_lens`、`ensemble_performance_continuity`、`continuity_and_exit_state` 和 `sound_and_narrative_legibility`。诊断在同链回灌，已受理媒体不被拦截、回滚或丢弃。

