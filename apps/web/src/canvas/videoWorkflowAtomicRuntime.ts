import { authoredSourceUnitLedgerSchema } from '../../../../packages/schemas/source-unit-ledger/index.mjs'
import { chapterBeatPlanSchema, chapterAssetPlanSchema, clipDesignSchema } from '../../../../packages/schemas/video-authoring-stages/schema.mjs'
import { clipProductionPacketSchema } from '../../../../packages/schemas/clip-production-packet/index.mjs'
import { chapterClipSegmentationSchema } from '../../../../packages/schemas/video-clip-segmentation/index.mjs'
import { chapterSequenceSchema } from '../../../../packages/schemas/chapter-sequence/index.mjs'
import {
  resolveWorkflowExecutorPortArtifactContract,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
  WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
  type WorkflowAtomicNodeSpecV1,
} from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS } from './videoWorkflowDefinitionConstants'
import type { VideoAtomicNodeDefinition } from './videoWorkflowDefinitionTypes'

export function atomicSpec(definition: VideoAtomicNodeDefinition): WorkflowAtomicNodeSpecV1 {
  const portArtifactContract = definition.executorRef
    ? resolveWorkflowExecutorPortArtifactContract(
      definition.executorRef,
      definition.runtimeData?.workflowPipeline === undefined
        ? undefined
        : { workflowPipeline: definition.runtimeData.workflowPipeline },
    )
    : null
  const resolvePortArtifactTypes = (
    direction: 'input' | 'output',
    ports: readonly string[],
    registered: Readonly<Record<string, readonly string[]>>,
    declared: Readonly<Record<string, readonly string[]>> | undefined,
  ): Readonly<Record<string, readonly string[]>> => {
    const result = Object.fromEntries(ports.flatMap((port) => (
      registered[port] ? [[port, registered[port]] as const] : []
    ))) as Record<string, readonly string[]>
    for (const [port, artifactTypes] of Object.entries(declared ?? {})) {
      if (!ports.includes(port)) {
        throw new Error(`Workflow node ${definition.nodeId} declares an unknown ${direction} artifact port ${port}`)
      }
      if (artifactTypes.length === 0 || artifactTypes.some((artifactType) => !artifactType.trim())
        || new Set(artifactTypes).size !== artifactTypes.length) {
        throw new Error(`Workflow node ${definition.nodeId} declares an invalid ${direction} artifact contract for ${port}`)
      }
      const registeredTypes = registered[port]
      if (registeredTypes && (registeredTypes.length !== artifactTypes.length
        || registeredTypes.some((artifactType, index) => artifactType !== artifactTypes[index]))) {
        throw new Error(`Workflow node ${definition.nodeId} ${direction} artifact contract for ${port} disagrees with its executor`)
      }
      result[port] = artifactTypes
    }
    return result
  }
  const inputArtifactTypes = resolvePortArtifactTypes(
    'input',
    definition.inputPorts,
    portArtifactContract?.inputArtifactTypes ?? {},
    definition.inputArtifactTypes,
  )
  const outputArtifactTypes = resolvePortArtifactTypes(
    'output',
    definition.outputPorts,
    portArtifactContract?.outputArtifactTypes ?? {},
    definition.outputArtifactTypes,
  )
  return {
    version: 1,
    category: definition.category,
    operation: definition.operation,
    executorRef: definition.executorRef,
    executionMode: definition.executionMode,
    inputPorts: definition.inputPorts,
    ...(definition.optionalInputPorts ? { optionalInputPorts: definition.optionalInputPorts } : {}),
    ...(definition.selectiveOutputPorts ? { selectiveOutputPorts: definition.selectiveOutputPorts } : {}),
    outputPorts: definition.outputPorts,
    ...(Object.keys(inputArtifactTypes).length > 0 ? { inputArtifactTypes } : {}),
    ...(Object.keys(outputArtifactTypes).length > 0 ? { outputArtifactTypes } : {}),
  }
}

export function videoNodeRuntimeData(definition: VideoAtomicNodeDefinition): Record<string, unknown> {
  const runtimeNodeId = definition.runtimeTemplateNodeId ?? definition.nodeId
  if (definition.nodeId === 'clip-media-pipeline') {
    return { workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 1 } }
  }
  if (definition.nodeId === 'clip-segmentation-agent') {
    return {
      workflowInstruction: '读取冻结 delivery-contract 中完整 authoritativeSources 原文，并依据其中明确的供应商合法时长边界，把所有来源按 UTF-16 偏移连续、无重无漏地分配给 1 到 80 个 Clip。只输出 protocolVersion 与 clips；每个 Clip 只包含 durationSeconds 和 sourceRanges，范围连续且不拆分 Unicode 代理项。不要总结、删改或创作原文，不做视觉设计、资产规划或视频提示词。本节点不需要 Skill 或知识检索。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: ['protocolVersion', 'clips'],
        jsonSchema: chapterClipSegmentationSchema,
      },
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-clip-segmentation/v1',
      workflowAgentDeliveryRequirement: '覆盖全部冻结来源的合法 Clip 分段 JSON；结构提交不符合合同时保留原始候选与精确错误，并由同一作者在执行链内修订。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentStructuredOutputTokenBudget: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentProjectContextPromptMode: 'identity_only',
      workflowAgentPromptMode: 'compact_structured',
      workflowAgentFailurePolicy: 'repair_with_correction',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'none',
      workflowRequiredSkills: [],
      workflowKnowledgeRetrieval: false,
      workflowSkillRetrieval: false,
      workflowExecutionInspection: false,
    }
  }
  if (definition.nodeId === 'chapter-sequence-agent') {
    return {
      workflowInstruction: '使用已预载的 tapcanvas-screenwriter 与 tapcanvas-video-authoring-stages Skill，读取冻结 delivery-contract 的完整原文和本项 clip-segment 的精确 Clip 身份、时长与来源范围。只为本项 Clip 提交 clips 数组中的唯一对象：给出起止关键帧、进入因果、不可逆结果、交接状态和本段时间内的事件；结合完整原文保持与相邻来源段的状态连续。需要发声的原文仅提交真实 sourceRanges、speaker、delivery 和本段时间窗，正文由执行器从冻结原文逐字投影；不要复写、补造或删除对白。静默段可以有空 speechEvents 或 storyEvents。只提交 tapcanvas.chapter-sequence/v1 结构，保持 clipId、clipIndex、durationSeconds、sourceRanges 与本项冻结输入完全相同。结构错误依据精确路径在同一执行链内修订，保留原始证据。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(chapterSequenceSchema.properties as object),
        jsonSchema: chapterSequenceSchema,
      },
      workflowAgentOutputArtifactType: 'tapcanvas.chapter-sequence/v1',
      workflowAgentDeliveryRequirement: '交付唯一冻结 Clip 的连续性与对白来源结构；保留精确身份、时长、来源范围和相邻段交接事实，结构错误同链修订。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentStructuredOutputTokenBudget: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'repair_with_correction',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowAgentToolPolicy: 'none',
      workflowRequiredSkills: ['tapcanvas-screenwriter', 'tapcanvas-video-authoring-stages'],
      workflowKnowledgeRetrieval: false,
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 4 },
    }
  }
  if (definition.nodeId === 'clip-production-agent') {
    return {
      workflowInstruction: '依据已冻结 chapter-assets.objectRegistry 的精确 objectId、身份事实、现有资产选择和图像计划，以及 clip-sequence 的本段起止状态、相邻段交接、事件时间轴和逐字投影对白，为收到的每个 clip-segment 独立创作完整可执行视频提示词。实际入镜的同一对象跨 Clip 必须引用同一个 registryObjectId；assetId 与 state 区分同一对象的不同画面状态，不得因 Clip 不同重复创造人物或场景身份。每个 assetIntent 只选择章级 registryObjectId 和与其一致的 imageSource：章级 reuse 只提交 {mode:"reuse",registryAssetIndex}，索引从该对象 imageSource.assetIds 零起；章级 generate 只提交 {mode:"generate"}。共享图片身份、语义名称、参考职责、卡片元数据和生图提示词都由宿主从冻结章级计划原样投影，逐 Clip 不再重写 assetId、state、generationSpec 或长已有资产 ID；局部服装、动作与画面状态写进本段视频提示词。按冻结 delivery-contract 填写 imageModelKey、imageAspectRatio、imageSize，不猜模型参数。blockingPlan 明确本段可见人物、地标、机位与构图；使用 backgroundPlanIndex 从冻结章级 backgroundPlans 零起选择背景，不抄写 backgroundObjectId。它是空间调度事实，不冒充已生成的站位图。通过同媒体视频案例候选回执按需读取正文；零命中或检索失败记录证据后继续原创，不伪称引用。protocolVersion、clipId、clipIndex、durationSeconds、sourceRanges 必须保留冻结值；clipFacts.sequenceClipId 必须填写本段冻结 clipId。依据供应商能力与创作需求选择明确支持的 videoInputMode；只提交 firstFrameAssetIndex（没有首帧时 null）和 referenceAssetIndices，从本 packet 的 assetIntents 零起选择；宿主派生 assetId 与 state，不重复抄写。image_to_video 的首帧索引必须同时包含在引用索引中；reference_to_video 必须提供引用；text_to_video 不得虚构图像依赖。模型参数只继承本轮显式选择或账号偏好与实时目录，不猜默认值或切换模型。提交前核对本 Clip 引用的图像身份均在冻结章级注册表中，节点与媒体阶段随后解析真实 URL；不得假称已生成资产或改写来源范围。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        allowedFields: Object.keys(clipProductionPacketSchema.properties as object),
        jsonSchema: clipProductionPacketSchema,
      },
      workflowAgentOutputArtifactType: 'tapcanvas.clip-production-packet/v1',
      workflowAgentDeliveryRequirement: '交付唯一符合 packet schema 的 Clip 生产包；所有媒体模式与资产身份都显式声明，结构错误同链修订并保留证据。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentStructuredOutputTokenBudget: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowAgentFailurePolicy: 'repair_with_correction',
      workflowAgentExecutionPolicy: 'multi_inference',
      workflowPromptExampleMediaType: 'video',
      workflowKnowledgeRetrieval: true,
      workflowRequiredSkills: ['tapcanvas-video-prompt-writer', 'tapcanvas-dialogue-drama', 'tapcanvas-video-authoring-stages'],
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 16 },
    }
  }
  if (definition.nodeId === 'clip-asset-image-generate') {
    return {
      workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 16 },
      workflowImageReferenceAssetBindings: [],
    }
  }
  if (definition.nodeId === 'clip-production-project') {
    return {
      workflowDeliveryRequirement: '按 exact assetId/state 将图像生成回执绑定到对应 Clip；保留 packet.videoPrompt 原文、videoInputMode、首帧/参考资产身份、来源范围、时长与 Clip 顺序，并为显式 image_to_video/reference_to_video 策略解析真实图片 URL；reference_to_video 还必须由供应商能力合同明确支持。',
      workflowDeliveryArtifactType: 'tapcanvas.prompt-package/v2',
    }
  }
  const stageSchema = definition.nodeId === 'source-units-agent' ? authoredSourceUnitLedgerSchema
    : definition.nodeId === 'beat-sheet-agent' ? chapterBeatPlanSchema
    : definition.nodeId === 'chapter-assets-agent' ? chapterAssetPlanSchema
      : definition.nodeId === 'clip-design-agent' ? clipDesignSchema : null
  if (stageSchema) {
    const properties = stageSchema.properties as Record<string, unknown>
    const clipDesignInputInstruction = definition.nodeId === 'clip-design-agent'
      ? '只设计本节点收到的 clip-design-inputs 集合，逐项保留冻结 clipIndex 与 clipId；不得补写未传入的 Clip。'
      : ''
    return {
      workflowInstruction: ['执行 tapcanvas-video-authoring-stages Skill 中与本节点 output artifact 对应的职责，只交付本节点 schema 中的字段；冻结上游事实和精确身份不改写，完整章节来源不得截短。', clipDesignInputInstruction].filter(Boolean).join(' '),
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: { allowedFields: Object.keys(properties), jsonSchema: stageSchema },
      workflowAgentDeliveryRequirement: '交付本节点声明的结构化产物；局部错误在同一节点内修复，不重写其它阶段产物。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowRequiredSkills: ['tapcanvas-video-authoring-stages'],
      ...(definition.nodeId === 'chapter-assets-agent' ? {
        workflowAgentFailurePolicy: 'repair_with_correction',
        workflowAgentExecutionPolicy: 'multi_inference',
        workflowAgentToolPolicy: 'none',
      } : {}),
      ...(definition.nodeId === 'clip-design-agent' ? { workflowAtomicSpec: { ...atomicSpec(definition), itemConcurrency: 16 } } : {}),
    }
  }

  if (runtimeNodeId === 'text-expansion-agent') {
    return {
      workflowInstruction: '读取 canvas-facts.authoritativeSources 的完整正文。你是成片流程中的可选文本处理步骤：如果正文已经足够完整，原样返回；如果存在明显缺失，补足必要的连续动作、因果、人物选择与可拍结果。不得改变原有人物、事件、对白事实，不得输出提纲、分析、Markdown 或质检报告，只返回最终可供 BeatSheet 改编的正文。',
      workflowAgentOutputArtifactType: 'tapcanvas.text/v1',
      workflowAgentOutputEncoding: 'plain_text',
      workflowAgentDeliveryRequirement: '交付一份非空正文；输入完整时保持原文，确需处理时仅在同一链内完成必要扩写。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      // 前置扩写产出的是交给 BeatSheet 的可拍正文，不是小说散文：owner 是编剧 skill。
      // 绑回 writing-expert 会让该节点退化成小说补全，与 Skill 自身声明的边界冲突。
      workflowRequiredSkills: ['tapcanvas-screenwriter'],
    }
  }
  if (definition.nodeId === 'launch-beat-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-dramatic-adapter 及其运行时合同，以冻结 delivery-contract、generationContract、canvasFacts.authoritativeSources 和项目素材快照为输入。本节点只负责首 Clip，按冻结交付范围提交唯一 beat，并在 blockingPlans 中为该 Clip 冻结俯视空间调度：角色站位、朝向、走位、场景地标、机位、轴线和关键帧构图合同；归一化坐标使用 [x,y]，原点左上。逐段视觉依赖提取、资产复用、连续性与创作自检按该 Skill 及其 references 执行；节点不维护另一套创作方法。只提交运行时 schema 要求的严格 JSON，宿主派生字段以实际 schema 为准。结构性拒因沿同一逻辑任务回灌 Agent 修订，保留来源和精确资产身份，不由本地代码猜绑或改写语义。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        contractName: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME,
        contractVersion: WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION,
        requiredStringFields: ['sourceId', 'sourceFingerprint', 'protocolVersion'],
        requiredObjectFields: ['sourceCoveragePlan', 'chapterArc', 'sequenceControlPlan'],
        requiredNonEmptyStringPaths: ['sequenceControlPlan.segments[].transitionFromPrevious', 'sequenceControlPlan.segments[].transitionToNext', 'blockingPlans[].backgroundPlan.assetId', 'blockingPlans[].backgroundPlan.displayName', 'blockingPlans[].backgroundPlan.prompt', 'blockingPlans[].backgroundPlan.negativePrompt'],
        requiredArrayFields: ['objectRegistry', 'assetPlans', 'blockingPlans', 'beats'],
        arrayItemRequiredStringFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'referenceRole', 'identityInvariant'],
          assetPlans: ['role'],
          blockingPlans: ['title', 'sceneName'],
          beats: ['startKeyframe', 'endKeyframe', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext'],
        },
        arrayItemRequiredStringArrayFields: { objectRegistry: ['referenceImageNodeIds'] },
        arrayItemRequiredNonEmptyStringArrayFields: { assetPlans: ['identityAnchors', 'prohibitedDrift'] },
        arrayItemAllowedFields: {
          objectRegistry: ['objectId', 'kind', 'name', 'physicalIdentityKey', 'referenceImageNodeIds', 'referenceAssetIds', 'referenceRole', 'forbiddenTransfer', 'identityInvariant', 'scale'],
          assetPlans: ['role', 'prompt', 'negativePrompt', 'identityBoardSpec', 'sceneCard', 'identityAnchors', 'prohibitedDrift'],
          blockingPlans: ['clipIndex', 'title', 'sceneName', 'durationSeconds', 'backgroundPlan', 'bg', 'width', 'height', 'landmarks', 'characters', 'camera', 'axisLine', 'compositionContract'],
          beats: ['clipId', 'clipIndex', 'durationSeconds', 'sourceSpan', 'narrativeIntent', 'visualIntent', 'dominantFunction', 'causalEntry', 'irreversibleResult', 'handoffToNext', 'startKeyframe', 'endKeyframe', 'exitState', 'characters', 'speakers', 'narrativeAudioPlan', 'dialoguePaceRate', 'storyEvents', 'objectStates'],
        },
        allowedFields: ['sourceId', 'sourceFingerprint', 'protocolVersion', 'sourceCoveragePlan', 'sourceFidelityAudit', 'chapterArc', 'sequenceControlPlan', 'objectRegistry', 'assetPlans', 'blockingPlans', 'beats'],
      },
      workflowAgentDeliveryRequirement: '交付唯一、可解析且 beats 恰好一项的首 Clip Keyframe BeatSheet；clipIndex=0，来源身份、首段对白、事件相位、人物唯一身体身份、对象状态和交接状态均可追溯。',
      workflowAgentDefinitionId: 'writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
		workflowRequiredSkills: ['tapcanvas-dramatic-adapter', 'tapcanvas-scene-card'],
    }
  }
  if (runtimeNodeId === 'asset-coverage') {
    return {}
  }
  if (runtimeNodeId === 'asset-fan-out') {
    return {}
  }
  if (runtimeNodeId === 'asset-image-generate' || runtimeNodeId === 'background-image-generate') {
    return {
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
      },
      workflowImageReferenceAssetBindings: [],
    }
  }
  if (runtimeNodeId === 'clip-fan-out') {
    return { workflowCollectionItemIdField: 'clipId' }
  }
  if (runtimeNodeId === 'clip-writer-agent') {
    return {
      workflowInstruction: '执行已预载的 tapcanvas-video-prompt-writer 及其 authoring contract，以冻结 clip-context、spokenScript、sequenceContext、generationContract 与 assetObjectContracts 为输入。镜头、对白、对象身份和同链创作自检均由该 Skill 统一定义，本节点不复制创作规则。只提交运行时 schema 要求的最终 JSON；结构性拒因沿同一逻辑任务回灌 writer 修订，保留冻结来源。宿主只执行确定性投影、真实引用解析与镜头内声音展示，不代写创作内容，不手工修订已提交产物。',
      workflowAgentOutputEncoding: 'json_object',
      workflowAgentJsonObjectContract: {
        requiredArrayFields: ['clips'],
        allowedFields: ['clips', 'selfQaNote', 'creativeReview', 'sourceFidelityAudit'],
        itemRequiredNonEmptyArrayFields: ['shots'],
      },
      workflowAgentDeliveryRequirement: '一次性交付一个符合当前 runtime JSON contract 的完整 clips 信封；创作语义由 tapcanvas-video-prompt-writer 在提交前自行验收，宿主不以第二套提示词或返回纠偏覆盖。',
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentMaxOutputTokens: VIDEO_WORKFLOW_STRUCTURED_AGENT_MAX_OUTPUT_TOKENS,
      workflowPromptExampleMediaType: 'video',
		// 对白戏扩展与父 Skill 一起预加载：人声密度（静默镜比例、连续人声上限、旁白额度）
		// 是 writer 写 shots 时必须当场做的取舍。此前它只作为 optional extension 可见、
		// 由 agent 自行决定是否加载，实测整章交付里三个 Agent 节点的 loadedKnowledgeSources
		// 全为空、也没有一个加载该扩展，于是逐字搬原文对白、满轨人声。
		// 规则仍由 Skill 持有，节点只声明依赖，不复制创作方法。
		workflowRequiredSkills: ['tapcanvas-video-prompt-writer', 'tapcanvas-dialogue-drama'],
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
        inputAlignment: {
          strategy: 'keyed_join',
          primaryPort: 'clip-contexts',
          primaryKeyPath: 'beat.clipId',
          candidateKeyPath: 'assetPlan.consumerClipIds',
          candidatePorts: ['asset-bindings'],
        },
      },
    }
  }
  if (runtimeNodeId === 'prompt-package') {
    return {
      workflowDeliveryRequirement: '持久化完整逐 Clip 提示词包；每个动态 Clip 都有稳定 itemId、原始顺序、来源谱系、合法语义时长、冻结参与者、逐字退出态、完整对白守恒、精确说话人绑定、资产角色结构和 embedded_authoring 复盘证据，以及由唯一 renderer 生成的非空纯执行提示词。provider prompt 只包含自然视听语言、真实 @图N 参考令牌、对白、镜头时间/动作/摄影/光线/材质/声音与结束状态；不得包含 AUDIO/ENTRY+REFERENCES/SHOTS/EXIT、VISUAL_ONLY/SFX_ONLY、SpeechEvent/SpokenText/VoiceManifest、canonical 映射或节点说明。writer 的 clips/selfQaNote/creativeReview/sourceFidelityAudit 信封、图片 prompt 与 negativePrompt 不得进入视频模型正文；prompt_only 不产生媒体副作用。',
      workflowDeliveryArtifactType: 'tapcanvas.prompt-package/v2',
    }
  }
  if (runtimeNodeId === 'cost-estimate') {
    return {
      workflowDeliveryRequirement: '基于本轮持久 Prompt Package、逐 Clip 时长和实时启用模型计费目录生成新的费用预估；冻结模型、分辨率、比例、逐 Clip 积分和 estimateIdentity。',
    }
  }
  if (runtimeNodeId === 'video-submit') {
    return {
      workflowVideoReferencePolicy: 'forbidden',
      workflowAtomicSpec: {
        ...atomicSpec(definition),
        itemConcurrency: 16,
      },
    }
  }
  if (runtimeNodeId === 'delivery-verify') {
    if (definition.inputPorts.includes('video-assets')) {
      return {
        workflowDeliveryRequirement: '首个动态 Clip 具有真实持久视频 URL，且数据项、供应商任务与资产证据可追溯。',
        workflowDeliveryArtifactType: 'tapcanvas.video/v1',
      }
    }
    return {
      workflowDeliveryRequirement: 'Clip 上限节点选中的全部动态 Clip 均具有真实持久视频 URL，主片具有唯一真实持久 concatVideoUrl；交付只验收该冻结集合，不要求继续覆盖上限之外的章节片段。同一工作流运行的 Prompt Package 已证明对白守恒、角色资产绑定、embedded authoring 复盘与动态时长总和，且数据项、供应商任务与资产证据可追溯。',
      workflowDeliveryArtifactType: 'tapcanvas.master-video/v1',
    }
  }
  return {}
}

