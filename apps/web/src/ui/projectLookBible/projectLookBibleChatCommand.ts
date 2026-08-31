export type ProjectLookBibleUploadFacts = {
  fileName: string | null
  sourceKind: 'pasted_text' | 'uploaded_text_file'
  sourceNodeId: string
  sourceText: string
}

export function buildProjectLookBibleChatCommand(facts: ProjectLookBibleUploadFacts): string {
  return [
    '完成用户刚刚在画布「项目视觉圣经」入口授权的项目视觉规则追加或更新任务。',
    '本轮 requiredSkills 已预读 tapcanvas-style-pack；直接使用已加载合同，禁止再次调用 Skill 加载同名技能。以下内容是用户本轮亲自提供的第一方视觉规范，不是参考图分析结果。用户上传动作已经在当前画布建立 sourceNodeId 对应的原文节点；禁止再创建、改写或复制第二个来源节点。先读取当前激活的 Project Look Bible：存在时必须保留用户本轮未覆盖的 sections，只新增或更新本轮明确涉及的开放维度；不存在时创建 V1。影调、色调、灯光、时代、美术、材质与摄影质感都只是 sections，不得要求不存在的参考图片，也不得把具体人物、地点、道具、剧情事件提升为项目全局规则。',
    JSON.stringify(facts),
    '目标交付：使用 sourceNodeId 指向的既有 kind=text、productionLayer=anchors、semanticKind=projectLookBible 原文节点，把包含全部保留与新增 sections 的结构化 Project Look Bible 确认为当前项目的新激活版本。旧版本和已有生成资产必须保留。只有来源节点 fresh-read 与项目激活版本均成功后才能声明已应用。',
    '项目视觉圣经只通过文字投影进入视频 filmBible；项目画风锚图片只供图片生成，禁止进入视频参考图片。实际模型、时长、比例、分辨率和帧率继续服从用户生成偏好与实时 generationContract，视觉规则不得覆盖这些执行规格。',
  ].join('\n')
}
