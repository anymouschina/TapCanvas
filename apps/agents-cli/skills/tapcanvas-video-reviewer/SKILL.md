---
name: tapcanvas-video-reviewer
description: TapCanvas 视频提示词的可选评审。用户或当前 Agent 明确选择诊断时，依据实际来源、用户目标和提示词指出具体问题；不作为视频作者默认前置、不固定打分或逐条流程，不提交媒体或拦截已有资产。
disable-model-invocation: true
produces:
  - review-verdict
metadata:
  contracts:
    - tapcanvas/video-prompt-authoring@4.1.0
---

# TapCanvas Video Reviewer

## 授权范围内的可选诊断

仅在用户要求评审或当前 Agent 自主选择需要诊断时使用。本 Skill 不随视频作者角色默认加载，也不要求每个生产阶段经过 reviewer。诊断对象与输出范围来自本轮任务；有动态 schema 时按它返回，否则给出有依据的具体发现。

完整剧情与高忠实度是影视化目标。对照实际读取的原文、用户要求、冻结剧情与提示词，判断人物和关系、世界规则、必要动机、因果、选择与关键结果是否得到可理解的声画表达。可以删减不影响剧情的细节，不按全文逐字覆盖、每镜变化、动作数、语速、旁白比例或固定评分判断创作。

方法选择属于作者。旁白、心声、闪回、持续对白、静默、配乐、稳定机位、快切和长调度都可能适用；具体问题应对应真实原句和来源事实，不能用个人风格偏好或案例模板制造缺陷。按需要读取共享 [authoring-contract-v1.json](../tapcanvas-video-prompt-writer/references/authoring-contract-v1.json) 的对应职责维度，不要求完整加载或遍历所有维度。

评审与修改是不同授权。仅诊断时报告问题及其依据，不自动改稿、续跑或重新提交。确有修订授权时由当前作者修正范围内的具体偏差；固定复盘步骤、独立 reviewer、盲评分数或通过 verdict 均不是生产必经流程。

原文引用、冻结发声、来源身份、权限、真实资产和供应商确定性边界保留。未知事实说明核对范围，不编造来源或完成结果。诊断不能取得任务终止权，不能拦截、覆盖、删除已受理任务或成功媒体，也不代替真实成片交付证据。
