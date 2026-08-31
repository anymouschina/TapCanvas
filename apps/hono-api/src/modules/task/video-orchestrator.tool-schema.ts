import {
	STORYBOARD_FACT_STATUSES,
	STORYBOARD_FACT_VISIBILITIES,
	STORYBOARD_SECRET_BLOCKED_CHANNELS,
} from "../../../../../packages/schemas/storyboard-director-protocol";

export type ToolJsonSchema = {
  type?: string;
  const?: unknown;
  enum?: readonly unknown[];
  description?: string;
  properties?: Record<string, ToolJsonSchema>;
  items?: ToolJsonSchema;
  required?: readonly string[];
  oneOf?: readonly ToolJsonSchema[];
  additionalProperties?: boolean | ToolJsonSchema;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  uniqueItems?: boolean;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

const nonEmptyString = (description: string): ToolJsonSchema => ({
  type: "string",
  minLength: 1,
  description,
});

const temporalContextSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    timelineId: nonEmptyString("稳定时间线 ID。"),
    stateScope: nonEmptyString(
      "状态继承作用域；使用 characterStateVersions 且未显式提交 visualStateRefs 时，必须逐字等于 visualStateTimeline 中覆盖当前 clip 的对应 interval.stateScope。",
    ),
    presentation: {
      type: "string",
      enum: ["current", "memory", "anticipation", "parallel", "subjective"],
      description: "当前时间表现层。",
    },
    relationToPrevious: {
      type: "string",
      enum: ["opening", "continuous", "enter_memory", "continue_memory", "return_from_memory", "parallel_cut", "time_jump"],
      description: "与上一 clip 的时间关系。",
    },
    transitionCue: nonEmptyString("转场提示。"),
    returnAnchor: nonEmptyString("返回锚点。"),
  },
  required: ["timelineId", "stateScope", "presentation", "relationToPrevious"],
};

const sceneStateSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subscene: nonEmptyString("具体空间。"),
    interiorExterior: {
      type: "string",
      enum: ["interior", "exterior", "mixed"],
    },
    timeOfDay: nonEmptyString("事实时段。"),
    lighting: nonEmptyString("光线入口。"),
    spatialAnchor: nonEmptyString("空间锚点。"),
    stateIn: nonEmptyString("场景进入态。"),
    stateOut: nonEmptyString("场景退出态。"),
  },
  required: ["subscene", "interiorExterior", "timeOfDay", "lighting", "spatialAnchor", "stateIn", "stateOut"],
};

const characterStateVersionSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stateId: nonEmptyString(
      "状态版本 ID；必须逐字等于 visualStateTimeline 中覆盖当前 clip 的 interval.stateVersionId，不是 stateKey。",
    ),
    visualState: nonEmptyString("必须可见的人物状态。"),
    stateIn: nonEmptyString("人物进入态。"),
    stateOut: nonEmptyString("人物退出态。"),
  },
  required: ["stateId", "visualState", "stateIn", "stateOut"],
};

const visualStateFactSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: nonEmptyString("agents 冻结的稳定事实键；Hono 只做逐字对账，不解释语义。"),
    value: nonEmptyString("该事实键在当前状态或边界的稳定值。"),
  },
  required: ["key", "value"],
};

const continuityBoundarySchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stateScope: nonEmptyString("当前入口或出口的状态作用域。"),
    facts: {
      type: "array",
      items: visualStateFactSchema,
      description: "姿态、肢体占用、接触、持物与空间等瞬时事实；key 在同一边界内唯一。",
    },
  },
  required: ["stateScope", "facts"],
};

const beatContinuityLedgerSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    inheritsPreviousExit: {
      type: "boolean",
      description: "由 agents 裁决本 clip 入口是否逐字继承上一 clip 出口；runtime 不从文案猜测。",
    },
    entry: continuityBoundarySchema,
    exit: continuityBoundarySchema,
  },
  required: ["inheritsPreviousExit", "entry", "exit"],
};

const visualStateTimelineSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "integer", const: 1 },
    intervals: {
      type: "array",
      description: "角色持久视觉状态的非重叠生效区间；一个状态版本只声明一次。",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterName: nonEmptyString("canonical 角色名。"),
          stateScope: nonEmptyString("与 temporalContext.stateScope 相同的状态作用域。"),
          stateVersionId: nonEmptyString("稳定视觉状态版本 ID。"),
          stateKey: nonEmptyString("状态锚卡使用的稳定 stateKey。"),
          startClipIndex: { type: "integer", minimum: 0 },
          endClipIndex: { type: "integer", minimum: 0 },
          visualFacts: {
            type: "array",
            items: visualStateFactSchema,
            description: "体态、年龄、孕态、伤势、妆造等在整个区间持续生效的结构化事实。",
          },
          anchorPolicy: {
            type: "string",
            enum: ["identity", "state_specific"],
            description: "identity 复用基准身份锚；state_specific 要求该 stateKey 的独立状态锚图。",
          },
          anchorNodeId: nonEmptyString("已存在的真实状态锚图节点 ID；缺失时资产 DAG 按状态版本补齐。"),
        },
        required: [
          "characterName",
          "stateScope",
          "stateVersionId",
          "stateKey",
          "startClipIndex",
          "endClipIndex",
          "visualFacts",
          "anchorPolicy",
        ],
      },
    },
  },
  required: ["version", "intervals"],
};

const stringArray = (description: string, minItems = 0): ToolJsonSchema => ({
  type: "array",
  items: nonEmptyString(description),
  ...(minItems > 0 ? { minItems } : {}),
  description,
});

const storyPointSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chapter: { type: "integer", minimum: 1 },
    sequence: { type: "integer", minimum: 0 },
  },
  required: ["chapter", "sequence"],
};

const storyFactsContextSchema: ToolJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", const: "book_ledger" },
        bookId: nonEmptyString("当前授权 book 的真实 ID。"),
        ledgerRevision: { type: "integer", minimum: 0 },
        effectiveAt: storyPointSchema,
        consumedFactIds: stringArray("本次实际消费的 Story Facts factId。"),
        consumedContextKeys: { type: "array", items: { type: "string" }, maxItems: 0 },
      },
      required: ["mode", "bookId", "ledgerRevision", "effectiveAt", "consumedFactIds", "consumedContextKeys"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", const: "task_context" },
        sourceLabel: nonEmptyString("本次独立任务上下文的事实来源标签；不要伪造 book 或 factId。"),
        bookId: { type: "null" },
        ledgerRevision: { type: "null" },
        effectiveAt: { type: "null" },
        consumedFactIds: { type: "array", items: { type: "string" }, maxItems: 0 },
        consumedContextKeys: stringArray(
          "本次序列可使用的任务上下文键；storyFactLocks 的 task_context bindings 必须是其子集，不要求逐拍重复全部键。章节原文追溯由 sourceCoveragePlan 独立保证。",
        ),
      },
      required: ["mode", "sourceLabel", "bookId", "ledgerRevision", "effectiveAt", "consumedFactIds", "consumedContextKeys"],
    },
  ],
  description:
    "事实来源合同：有真实章节账本时使用 book_ledger；独立任务（如 standalone 双人打斗）使用 task_context。必须完整提交对应分支的全部字段。",
};

const storyFactBindingBaseProperties = {
	category: nonEmptyString("事实类别，例如 character、scene、prop 或 task_context。"),
	status: { type: "string", enum: STORYBOARD_FACT_STATUSES },
};

const visibleFactVisibilities = STORYBOARD_FACT_VISIBILITIES.filter(
	(visibility) => visibility !== "hidden",
);

const storyFactBindingSchema: ToolJsonSchema = {
	oneOf: [
		{
			type: "object",
			additionalProperties: false,
			properties: {
				...storyFactBindingBaseProperties,
				source: { type: "string", const: "story_fact" },
				factId: nonEmptyString("book_ledger 的真实 Story Fact factId。"),
				visibility: { type: "string", enum: visibleFactVisibilities },
				directive: nonEmptyString("该事实在本镜中如何被可见地使用。"),
			},
			required: ["source", "factId", "category", "status", "visibility", "directive"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				...storyFactBindingBaseProperties,
				source: { type: "string", const: "story_fact" },
				factId: nonEmptyString("book_ledger 的真实 Story Fact factId。"),
				visibility: { type: "string", const: "hidden" },
			},
			required: ["source", "factId", "category", "status", "visibility"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				...storyFactBindingBaseProperties,
				source: { type: "string", const: "task_context" },
				contextKey: nonEmptyString("独立任务上下文中的真实 contextKey。"),
				sourceLabel: nonEmptyString("独立任务事实来源标签，必须与 storyFactsContext.sourceLabel 一致。"),
				visibility: { type: "string", enum: visibleFactVisibilities },
				directive: nonEmptyString("该事实在本镜中如何被可见地使用。"),
			},
			required: ["source", "contextKey", "sourceLabel", "category", "status", "visibility", "directive"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				...storyFactBindingBaseProperties,
				source: { type: "string", const: "task_context" },
				contextKey: nonEmptyString("独立任务上下文中的真实 contextKey。"),
				visibility: { type: "string", const: "hidden" },
			},
			required: ["source", "contextKey", "category", "status", "visibility"],
		},
	],
	description:
		"visibility 只能是 objective、viewpoint_only 或 hidden；不存在 visible 这个值。hidden binding 必须在 revealGuards 提供对应门禁。",
};

const storyFactRevealGuardSchema: ToolJsonSchema = {
	oneOf: [
		{
			type: "object",
			additionalProperties: false,
			properties: {
				source: { type: "string", const: "story_fact" },
				factId: nonEmptyString("与 hidden story_fact binding 对应的 factId。"),
				notBefore: storyPointSchema,
				blockedChannels: {
					type: "array",
					items: { type: "string", enum: STORYBOARD_SECRET_BLOCKED_CHANNELS },
					uniqueItems: true,
					minItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
					maxItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
				},
			},
			required: ["source", "factId", "notBefore", "blockedChannels"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				source: { type: "string", const: "task_context" },
				contextKey: nonEmptyString("与 hidden task_context binding 对应的 contextKey。"),
				notBeforeShotId: { oneOf: [nonEmptyString("后续镜头的 shot ID。"), { type: "null" }] },
				blockedChannels: {
					type: "array",
					items: { type: "string", enum: STORYBOARD_SECRET_BLOCKED_CHANNELS },
					uniqueItems: true,
					minItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
					maxItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
				},
			},
			required: ["source", "contextKey", "notBeforeShotId", "blockedChannels"],
		},
	],
};

const storyFactLocksSchema: ToolJsonSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
    effectiveAt: {
      oneOf: [storyPointSchema, { type: "null" }],
      description: "book_ledger 镜头的事实时间点；task_context 必须为 null。",
    },
	bindings: {
			type: "array",
			items: storyFactBindingSchema,
			description:
				"本拍明确消费的额外 Story Fact 或 task context 绑定；无额外消费时传空数组。章节原文追溯由 runtime sourceCoveragePlan 与 canonical source markers 独立保证，不需要逐拍重复绑定。",
		},
		revealGuards: {
			type: "array",
			items: storyFactRevealGuardSchema,
      description: "与 hidden binding 一一对应的揭示门禁；无门禁时传空数组。",
    },
  },
  required: ["effectiveAt", "bindings", "revealGuards"],
};

const narrativeBlockSchema: ToolJsonSchema = {
  oneOf: [
    nonEmptyString("叙事合同文本"),
    stringArray("叙事合同文本数组", 1),
    {
      type: "object",
      additionalProperties: true,
      description: "仅允许字符串叶子的结构化叙事合同；服务端会确定性折叠为文本。",
    },
  ],
};

export const assetObjectContractSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["character", "scene", "prop", "vfx", "palette", "composition"],
      description: "资产对象类别；角色、场景、道具、VFX、色卡和构图锚使用同一份状态合同。",
    },
    name: nonEmptyString("canonical 资产对象名；VFX 也必须使用明确名称。"),
    physicalIdentityKey: {
      oneOf: [
        nonEmptyString(
          "角色的稳定物理肉身身份键；同一肉身的不同人格、附身者或称谓必须逐字复用同一个 key，独立肉身不得共用。",
        ),
        { type: "null" },
      ],
      description:
        "kind=character 时必须是 Agent 在首稿中填写的非空稳定物理身份键；scene/prop/vfx/palette/composition 必须传 null。该字段属于结构化身份协议，不从角色名称或提示词正文推断。",
    },
    referenceImageNodeIds: {
      type: "array",
      items: nonEmptyString("承担当前 referenceRole 的真实单格图片节点 id。"),
      description:
        "逐图绑定参考职责；preflight 可显式提交空数组，表示该对象尚无真实图片锚，后续资产 DAG 必须在进入 provider 前补齐或显式失败。多视图身份包绑定多个独立单格节点，禁止绑定多格设计板。",
    },
    referenceAssetIds: {
      type: "array",
      maxItems: 1,
      items: nonEmptyString("tapcanvas_material_assets_list 返回的完整稳定 referenceAssetId。"),
      description:
        "agents 明确选择的同项目跨画布 canonical 图片资产；语义复用由 agents 决定，服务端只做项目归属、类别、真实图片与拒绝状态校验，再物化到当前章节。当前章节节点继续使用 referenceImageNodeIds。",
    },
    referenceRole: {
      type: "string",
      enum: ["none", "identity", "wardrobe", "prop", "environment", "palette", "composition", "vfx"],
      description:
        "该对象在本 clip 的视觉参考职责。纯文生视频、无需生成或绑定参考图时必须显式填写 none；none 仍保留 canonical 对象与运动事实，但不会进入 authoring 生图 DAG。其余值声明真实参考职责，其中 identity/wardrobe/environment 即使引用数组暂为空也要求 authoring 在视频提交前补齐真实图片。",
    },
  },
  required: [
    "kind",
    "name",
    "physicalIdentityKey",
    "referenceImageNodeIds",
    "referenceRole",
  ],
};

export const beatSheetDraftBeatSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    clipIndex: { type: "integer", minimum: 0, description: "从 0 连续递增。" },
    logline: nonEmptyString("本拍发生什么以及唯一变化终点。"),
    sceneName: nonEmptyString(
      "本拍的 canonical 主场景，必须逐字命中一个 kind=scene 的 assetObjectContracts.name；当回忆/转场声明多个场景对象时由 agents 显式选择承载主要动作的场景。",
    ),
    startKeyframe: nonEmptyString("当前 clip 的起始画面事实。"),
    endKeyframe: nonEmptyString("当前 clip 的结束画面事实。"),
    exitState: nonEmptyString("结束时人物、姿态、视线、道具、伤况与光线状态。"),
    storyFactLocks: storyFactLocksSchema,
    // 弧线、情绪、期待债务、受众体验与节奏裁决属于 agents-cli 的
    // 创作过程，不是媒体提交协议。它们不进入 authoring operation schema，
    // 因而也不能因为漏填或枚举偏差阻断真实结果。
    durationBudget: {
      type: "number",
      minimum: 1,
      description:
        "本拍预算秒数；必须精确命中服务端为 meta.videoModel 冻结的 generationContract.durationOptions，禁止按固定上限猜测。",
    },
    // 角色、场景、道具与 VFX 名称由 assetObjectContracts 的 kind/name
    // 确定性投影；说话人由 dialogueScript 确定性投影。禁止让模型重复填
    // 两份集合，再用集合相等闸门阻断同一个已授权结果。
    blockingFrameNodeId: nonEmptyString(
      "俯视站位节点 id；仅 spatialBlocking=true 时必填。仅作为空间事实来源，不作为视频首帧。",
    ),
    spatialBlocking: {
      type: "boolean",
      description:
        "由 agents 根据当前 clip 的真实空间依赖显式判断。需要锁定相对站位、轴线、走位或场景拓扑时设为 true，并绑定 blockingFrameNodeId；角色数量本身不触发该门禁。",
    },
    storyboardImageNodeId: nonEmptyString(
      "可选关键帧图片节点 id。单状态可使用普通 image/imageEdit/storyboardImage；确需表达连续变化时，一张图可按时间顺序承载 2～3 个状态。禁止整章母板、通用设计板或站位图。",
    ),
    storyboardFrameCount: {
      type: "integer",
      minimum: 1,
      maximum: 3,
      description: "可选关键帧图片承载的状态数量；仅提交 storyboardImageNodeId 时填写，范围 1～3。",
    },
    videoReferenceNodeIds: {
      type: "array",
      items: nonEmptyString("按本镜真实需要精选的视频资产节点 id。"),
      description:
        "核心人物可保留独立角色卡；次要人物优先合成群像图；只选决定性关键帧/场景/武器/道具/VFX 锚。入口 schema 不声明固定数量；与可选 storyboardImageNodeId、对象合同真实图片合并去重后，仅由当前实时 generationContract.referenceImagePolicy.maximumBusinessImages 校验供应商硬上限。站位图、整章母板和资产生成血缘禁止进入。",
    },
    continuityMode: {
      type: "string",
      enum: ["editorial_cut", "bridge_frames", "reference_video"],
      description:
        "agents 对本 clip 与上一 clip 剪辑缝的语义裁决。clip0 必须 editorial_cut；bridge_frames 由上一 clip.lastFrameImageNodeId 与本 clip.storyboardImageNodeId 共用同一节点闭合；reference_video 等待上一段真实成片。后端只校验和执行，不从 prompt 猜测。",
    },
    lastFrameImageNodeId: nonEmptyString(
      "仅当下一 clip.continuityMode=bridge_frames 时填写的真实桥接尾帧；必须与下一 clip.storyboardImageNodeId 完全相同。",
    ),
    assetObjectContracts: {
      type: "array",
      items: assetObjectContractSchema,
      minItems: 1,
      description:
        "本 clip 使用的全部角色/场景/道具/VFX 对象合同。静态事实供关键帧，运动三元组供视频提示词。",
    },
    temporalContext: temporalContextSchema,
    sceneState: sceneStateSchema,
    characterStates: {
      type: "object",
      additionalProperties: nonEmptyString(
        "角色状态锚 stateKey；当对应 visualStateTimeline interval.anchorPolicy=state_specific 时，必须逐字等于该 interval.stateKey。",
      ),
      description:
        "按 canonical 角色名选择当前 clip 的状态锚。characterStateVersions 引用了 anchorPolicy=state_specific 的区间时，同一角色必须同时在此填写 interval.stateKey；stateKey 与 stateVersionId 是不同字段，不得互换。",
    },
    characterStateVersions: {
      type: "object",
      additionalProperties: characterStateVersionSchema,
      description:
        "按 canonical 角色名冻结的逐 clip 可见状态。每个 stateId 必须逐字引用覆盖当前 clip 的 visualStateTimeline.interval.stateVersionId；不得填写 stateKey。若 temporalContext.stateScope 不同，则同时提交对应 visualStateRefs 显式绑定版本。",
    },
    visualStateRefs: {
      type: "object",
      additionalProperties: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: nonEmptyString("visualStateTimeline 中覆盖当前 clip 的 stateVersionId。"),
      },
      description: "当前 clip 实际使用的状态版本；跨多个回忆/现实子阶段时可为同一角色引用多个版本。",
    },
    continuityLedger: beatContinuityLedgerSchema,
    timeJumpNote: nonEmptyString("本拍相对上一拍的叙事时间跳跃。"),
    dialogueScript: {
      type: "array",
      description:
        "当前原文跨度内全部可发声文本，按原文顺序逐条提交；动作、神态、环境和镜头描述不得进入。无可发声文本时传 []。",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lineId: nonEmptyString("当前 beat 内稳定且唯一的台词行 ID。"),
          speakerName: nonEmptyString("canonical 说话人；runtime 将从全部 dialogueScript 行确定性投影 speakerNames。"),
          text: nonEmptyString("原文逐字台词正文；禁止摘要、改写或转述。"),
          delivery: {
            type: "string",
            enum: ["on_screen", "off_screen", "voice_over"],
            description: "仅按原文真实发声方式声明；不得把动作或画面描述改成 voice_over。",
          },
        },
        required: ["lineId", "speakerName", "text", "delivery"],
      },
    },
    narrativeAudioPlan: {
      type: "object",
      additionalProperties: false,
      description:
        "agents 对当前 clip 叙事可读性的语义裁决。它不替代、不改写 dialogueScript；只有确实需要源事实支撑的旁白/内心 VO 时才在 lines 中编写，纯视觉同样是合法裁决。Hono 只校验结构，不评价该创作选择。",
      properties: {
        strategy: {
          type: "string",
          enum: ["visual_only", "source_speech_only", "source_grounded_voice", "mixed"],
        },
        rationale: nonEmptyString("为何采用或不采用额外叙事音频；供同链 writer/reviewer 复盘。"),
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              lineId: nonEmptyString("当前 beat 内与 dialogueScript 不重复的稳定人声行 ID。"),
              speakerName: nonEmptyString("canonical 说话人或纯声音通道名。"),
              text: nonEmptyString("agents 编写、受当前源事实约束的旁白或内心 VO 正文。"),
              delivery: {
                type: "string",
                enum: ["on_screen", "off_screen", "voice_over"],
              },
              afterSourceLineId: {
                oneOf: [
                  nonEmptyString("本行紧跟其后的 dialogueScript lineId。"),
                  { type: "null" },
                ],
                description:
                  "本行在完整人声时间轴中的位置；null 表示位于第一条原文人声之前，否则必须引用当前 beat 的 dialogueScript lineId。同一锚点按 lines 数组顺序执行。",
              },
              sourceEvidence: {
                type: "array",
                items: nonEmptyString("支撑本行的源事实/源单元标识；后端只透传，不做语义匹配。"),
              },
              narrativeFunction: nonEmptyString("该行承担的观众理解功能，例如方向、因果、内心或转场。"),
            },
            required: ["lineId", "speakerName", "text", "afterSourceLineId", "sourceEvidence"],
          },
        },
      },
      required: ["strategy", "rationale", "lines"],
    },
    dialoguePaceRate: {
      type: "number",
      minimum: 0.1,
      maximum: 6,
      description:
        "单位为汉字/秒，不是比例、密度或倍速。当前 beat 存在原文对白、旁白、内心声或新增 narrativeAudioPlan 人声时必填；必须由 BeatSheet Agent 根据本行真实说话情境明确选择，宿主没有默认语速，只验证正数与物理上限 6。全部人声正文必须能在 durationBudget 内逐字说完。",
    },
    enterStateNote: nonEmptyString("可选进入态补充；默认承接上一拍 exitState。"),
  },
  required: [
    "clipIndex",
    "logline",
    "sceneName",
    "durationBudget",
    "dialogueScript",
    "videoReferenceNodeIds",
    "continuityMode",
    "continuityLedger",
    "assetObjectContracts",
  ],
};

const propMaterialIdentitySchema: ToolJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", const: "base" },
        canonicalName: nonEmptyString("道具 canonical 名，必须与 manifest name 一致。"),
      },
      required: ["mode", "canonicalName"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", const: "state" },
        canonicalName: nonEmptyString("道具 canonical 名，必须与 manifest name 一致。"),
        canonicalAssetId: nonEmptyString("项目内既有 canonical 道具资产 id。"),
        stateKey: nonEmptyString("道具状态键。"),
        stateDescription: nonEmptyString("道具在本状态下的客观物理变化。"),
      },
      required: ["mode", "canonicalName", "canonicalAssetId", "stateKey", "stateDescription"],
    },
  ],
};

const castManifestEntrySchema: ToolJsonSchema = {
  oneOf: [
    ...(["character", "scene"] as const).map((kind): ToolJsonSchema => ({
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: kind },
        name: nonEmptyString("canonical 资产名。"),
        states: stringArray("角色或场景状态键。"),
        firstClipIndex: { type: "integer", minimum: 0 },
      },
      required: ["kind", "name"],
    })),
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: "prop" },
        name: nonEmptyString("canonical 道具名。"),
        states: stringArray("道具状态键。"),
        firstClipIndex: { type: "integer", minimum: 0 },
        materialIdentity: propMaterialIdentitySchema,
      },
      required: ["kind", "name", "materialIdentity"],
    },
  ],
};

const sourceSpeechLedgerSchema: ToolJsonSchema = {
	type: "array",
	description:
		"agents 在切 beat 前语义清点的章级原文发声台账。按原文顺序逐条记录明确对白/OS/VO；动作、行为、神态、环境和画面说明不得进入。无可发声文本时传 []。服务端只做逐字定位与结构回拼，不解释正文语义。",
	items: {
		type: "object",
		additionalProperties: false,
		properties: {
			lineId: nonEmptyString("章级稳定且唯一的发声行 ID；重切 beat 不得改变。"),
			speakerName: nonEmptyString("canonical 说话人。"),
			text: nonEmptyString("原文逐字发声正文。"),
			sourceMarker: nonEmptyString("按原文顺序可逐字定位、且完整包含该行 text 的来源片段。"),
		},
		required: ["lineId", "speakerName", "text", "sourceMarker"],
	},
};

const sourceSpeechLedgerSelectionSchema: ToolJsonSchema = {
	type: "array",
	description:
		"agents 在切 beat 前语义清点的章级原文发声台账。只提交语义字段；runtime 按章节真源顺序定位 text，并生成逐字 sourceMarker。动作、行为、神态、环境和画面说明不得进入。无可发声文本时传 []。",
	items: {
		type: "object",
		additionalProperties: false,
		properties: {
			lineId: nonEmptyString("章级稳定且唯一的发声行 ID；重切 beat 不得改变。"),
			speakerName: nonEmptyString("canonical 说话人。"),
			text: nonEmptyString("原文发声正文；runtime 会从当前章节真源冻结逐字版本。"),
		},
		required: ["lineId", "speakerName", "text"],
	},
};

export const sourceCoveragePlanSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "在编写深层 beats 前冻结的来源证据：spans 声明每个 clip 承载的连续原文区间，speechLedger 持久化 agents 语义清点的章级可发声文本；两者都不替代 beat 的创作内容。full_chapter 必须首尾相接覆盖完整章节并逐条回拼发声台账。",
  properties: {
    spans: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clipIndex: { type: "integer", minimum: 0 },
          sourceStartMarker: nonEmptyString("当前跨度开头至少 6 个实义字符的原文逐字片段。"),
          sourceEndMarker: nonEmptyString("当前跨度结尾至少 6 个实义字符的原文逐字片段。"),
		  sourceStartOffset: {
			type: "integer",
			minimum: 0,
			description: "runtime 生成的归一化原文起点；模型不得填写。",
		  },
		  sourceEndOffset: {
			type: "integer",
			minimum: 1,
			description: "runtime 生成的归一化原文终点；模型不得填写。",
		  },
        },
		required: ["clipIndex", "sourceStartMarker", "sourceEndMarker", "sourceStartOffset", "sourceEndOffset"],
      },
    },
	speechLedger: sourceSpeechLedgerSchema,
  },
  required: ["spans", "speechLedger"],
};

/**
 * Agent-facing semantic choice. The receipt supplies the stable unit catalog;
 * Hono compiles these IDs into the canonical offset/marker plan above.
 */
export const sourceCoverageSelectionSchema: ToolJsonSchema = {
	type: "object",
	additionalProperties: false,
	description:
		"从 preflight receipt.sourceUnitCatalog 选择每个 clip 的结束 unit。endUnitIds 必须按原文递增且数量等于 expectedBeatCount；full_chapter 最后一项必须是目录最后 unit，bounded_duration 还必须提交授权范围的 startUnitId。精确起点、offset 与逐字 marker 由 runtime 生成。",
	properties: {
		startUnitId: nonEmptyString(
			"仅 bounded_duration 必填：从 receipt.sourceUnitCatalog 选择授权局部范围的起始 unit；full_chapter 必须省略。",
		),
		endUnitIds: {
			type: "array",
			minItems: 1,
			uniqueItems: true,
			items: nonEmptyString("receipt.sourceUnitCatalog 中的真实 unitId。"),
		},
		speechLedger: sourceSpeechLedgerSelectionSchema,
	},
	required: ["endUnitIds", "speechLedger"],
};

const videoFinishingRequestSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "video_enhance" },
    modelKey: nonEmptyString(
      "必须逐字复制 enabledVideoFinishingModels 中当前启用的 modelKey。",
    ),
    toolVersion: nonEmptyString("必须精确命中该模型 parameters.tool_version.options。"),
    scene: nonEmptyString("必须精确命中该模型 parameters.scene.options。"),
    resolution: nonEmptyString("必须精确命中该模型 parameters.resolution.options。"),
    fps: {
      type: "number",
      minimum: 0.01,
      description: "可选目标帧率；必须位于实时 parameters.fps 的 min/max 内。",
    },
  },
  required: ["kind", "modelKey", "toolVersion", "scene", "resolution"],
  description:
    "可选商业母版后期请求。只在 agents 根据用户交付意图明确选择时提交；服务端不补模型、档位、场景、分辨率或帧率默认值。",
};

const videoSpeechAuditRequestSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "video_speech_audit" },
    modelKey: nonEmptyString(
      "必须逐字复制 enabledVideoAnalysisModels 中当前启用的 canonical modelKey。",
    ),
    fps: {
      type: "number",
      minimum: 0.1,
      maximum: 8,
      description: "逐片段审计采样帧率；必须位于实时视频理解执行边界内。",
    },
  },
  required: ["kind", "modelKey", "fps"],
  description:
    "可选商用成片人声审计请求。转录模型不会收到期望台词；生成后逐片段核验真实发声，且不删除或覆盖已生成资产。",
};

export const beatSheetToolSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  description: "Keyframe BeatSheet v2：只提交整章分段事实；每个 clip 后续由独立 writer 一次完成。",
  properties: {
    version: { type: "integer", const: 2 },
    runId: nonEmptyString("必须与工具顶层 runId 完全一致。"),
    chapterId: nonEmptyString("当前章节 id。"),
    sourceCoveragePlan: sourceCoveragePlanSchema,
    visualStateTimeline: visualStateTimelineSchema,
    beats: { type: "array", items: beatSheetDraftBeatSchema, minItems: 1 },
    storyFactsContext: storyFactsContextSchema,
    filmBible: {
      type: "object",
      additionalProperties: false,
      properties: {
        directorTone: narrativeBlockSchema,
        visualBible: narrativeBlockSchema,
        emotionalArc: narrativeBlockSchema,
        characterArcs: narrativeBlockSchema,
        continuityBible: narrativeBlockSchema,
        atmosphereStrategy: narrativeBlockSchema,
        hardRules: narrativeBlockSchema,
        motifs: narrativeBlockSchema,
      },
    },
    adaptationStrategy: {
      type: "object",
      additionalProperties: false,
      properties: {
        reversals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              plantClipIndex: { type: "integer", minimum: 0 },
              revealClipIndex: { type: "integer", minimum: 0 },
              desc: nonEmptyString("原文已存在的预埋与揭晓关系；禁止新增原文没有的反转。"),
            },
            required: ["plantClipIndex", "revealClipIndex", "desc"],
          },
        },
        hook: nonEmptyString("仅记录原文结尾已经存在的悬念或未闭合事件；禁止为成片另造钩子。"),
      },
    },
    castManifest: {
      type: "array",
      items: castManifestEntrySchema,
      description: "角色、场景、道具的扁平 canonical 资产声明；voice 不属于 castManifest。",
    },
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        aspect: nonEmptyString("成片画幅。"),
        resolution: nonEmptyString("成片分辨率。"),
        videoModel: nonEmptyString(
          "当前启用视频模型目录中的 canonical modelKey。完整成片提交必须位于 beatSheet.meta.videoModel；禁止把展示名、渠道别名或工具顶层同名字段当作替代。",
        ),
        editingStyle: nonEmptyString("剪辑模式。"),
        filmGenre: nonEmptyString("题材与成片类型。"),
        targetDurationSeconds: {
          type: "number",
          minimum: 1,
          description:
            "仅 deliveryScope=bounded_duration 时提交，且必须来自用户明确指定并精确等于 beats[].durationBudget 总和；full_chapter 禁止提交，总时长由完整 beats 求和。",
        },
        language: nonEmptyString("对白与旁白语言。"),
        deliveryScope: {
          type: "string",
          enum: ["full_chapter", "bounded_duration"],
          description:
            "agents-cli 对用户授权范围的结构化裁决。full_chapter 必须用原文锚点覆盖完整章节；bounded_duration 只覆盖用户明确指定的时长范围。",
        },
        adaptationMode: {
          type: "string",
          enum: ["faithful", "creative"],
          description:
            "章级改编模式。faithful 只镜头化原文；creative 在保留核心人物、关系、世界规则、主线因果与关键结果的前提下，允许 BeatSheet Agent 同链新增桥段、对白、冲突、反转、视觉包装和商业化表达。必须来自用户明确选择，不能由服务端猜测。",
        },
        executionScope: {
          type: "string",
          enum: ["prompt_only", "media_delivery"],
          description:
            "显式执行边界。prompt_only 只运行 BeatSheet、clip writer、确定性装配并返回 Prompt Package，禁止资产检查、estimate、供应商提交、视频回收与拼接；media_delivery 才进入完整媒体生产。",
        },
        finishing: videoFinishingRequestSchema,
        speechAudit: videoSpeechAuditRequestSchema,
        learningProvenance: {
          type: "object",
          additionalProperties: false,
          properties: {
            queryToolCallId: nonEmptyString("由 agents-cli 运行时注入的 validated 查询调用 ID。"),
            queriedValidatedCandidateIds: {
              type: "array",
              items: nonEmptyString("本次 validated 查询实际返回的 candidate ID。"),
              uniqueItems: true,
            },
            adoptedCandidateIds: {
              type: "array",
              items: nonEmptyString("本次改编明确采用的 validated candidate ID；必须是查询结果子集。"),
              uniqueItems: true,
            },
          },
          required: ["adoptedCandidateIds"],
          description: "查询事实由 agents-cli 覆盖注入；模型只可声明 adoptedCandidateIds。",
        },
        userIntentContract: {
          type: "object",
          additionalProperties: true,
          description:
            "由 agents-cli 运行时在远程工具执行边界覆盖注入的 durable 用户语义合同；模型不得复制或改写。媒体模型与执行规格不在此合同重复声明：meta.videoModel 由服务端对实时目录验证并冻结 generationContract，Hono 不解释用户语义、不重排偏好。",
        },
      },
      required: ["aspect", "resolution", "videoModel", "deliveryScope", "executionScope"],
      description: "agentModel 与 agentApiStyle 由运行时注入，模型不得提交。",
    },
  },
  required: [
    "version",
    "runId",
    "beats",
    "storyFactsContext",
    "sourceCoveragePlan",
    "meta",
  ],
};

const beatSheetHeaderProperties = beatSheetToolSchema.properties ?? {};
const beatSheetMetaProperties = beatSheetHeaderProperties.meta?.properties ?? {};

/**
 * Exact operation schema for a revision-fenced header mutation.
 *
 * All already-authored sections may be persisted in one call. Only source
 * coverage plus executable aspect/resolution are required before beats; the
 * remaining creative metadata is optional and never blocks media production.
 */
export const beatSheetDraftHeaderPatchSchema: ToolJsonSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    storyFactsContext: beatSheetHeaderProperties.storyFactsContext ?? {},
    sourceCoveragePlan: sourceCoverageSelectionSchema,
    visualStateTimeline: beatSheetHeaderProperties.visualStateTimeline ?? {},
    filmBible: beatSheetHeaderProperties.filmBible ?? {},
    adaptationStrategy: beatSheetHeaderProperties.adaptationStrategy ?? {},
    castManifest: beatSheetHeaderProperties.castManifest ?? {},
    meta: {
      type: "object",
      minProperties: 1,
      additionalProperties: false,
      properties: Object.fromEntries(
        (["aspect", "resolution", "editingStyle", "filmGenre", "language"] as const)
          .map((field) => [field, beatSheetMetaProperties[field] ?? {}]),
      ),
    },
  },
  description:
	"revision-fenced header patch。可一次提交所有已完成 section；sourceCoveragePlan 只提交 {endUnitIds,speechLedger}，runtime 从 receipt.sourceUnitCatalog 生成无缺口精确跨度。filmBible/adaptationStrategy/castManifest/editingStyle/filmGenre/language 均为可选创作元数据，缺失只产生诊断，不阻止 beats 或媒体生产。",
};

function toDeepPartialPatchSchema(schema: ToolJsonSchema): ToolJsonSchema {
  if (schema.type !== "object") return schema;
  const properties = schema.properties
    ? Object.fromEntries(
        Object.entries(schema.properties).map(([field, propertySchema]) => [
          field,
          toDeepPartialPatchSchema(propertySchema),
        ]),
      )
    : undefined;
  return {
    ...schema,
    ...(properties ? { properties } : {}),
    required: undefined,
    ...(properties ? { minProperties: 1 } : {}),
  };
}

const beatPatchProperties = Object.fromEntries(
  Object.entries(beatSheetDraftBeatSchema.properties ?? {})
    .filter(([field]) => field !== "clipIndex")
    .map(([field, schema]) => [field, toDeepPartialPatchSchema(schema)]),
) as Record<string, ToolJsonSchema>;

/** Exact top-level partial update for a previously read beat node. */
export const beatSheetDraftBeatPatchSchema: ToolJsonSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: beatPatchProperties,
  description:
    "最近一次 preflight_get_beat 后的精确深层修订；不得提交不可变 clipIndex，只提交 verifier 明确指出的无效 JSON 路径。对象字段按路径深合并，数组整体替换，合并后的完整 beat 仍通过同一权威合同校验。",
};

/**
 * Public agent-facing request envelope for complete-film preflight.
 *
 * The detailed BeatSheet contract remains a server fact checked by
 * validateBeatSheet. Exposing the entire recursive contract in every tool
 * definition makes a single creative request pay for the same schema twice:
 * once in the Skill/reference and again in the provider tool surface. The
 * model therefore receives a shallow JSON object here and gets detailed
 * fields from the selected workflow Skill and the server's structured warning
 * facts. This is deliberately permissive at the transport boundary; it does
 * not weaken the authoring validator or paid execution checks.
 */
export const beatSheetExecutionEnvelopeSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Keyframe BeatSheet v2 的轻量章级外壳。preflight_begin 只提交不含 beats 的 header，逐拍内容通过 preflight_put_beat 独立写入，preflight_commit 汇编后执行完整结构校验。",
  properties: {
    version: { type: "integer", const: 2 },
    runId: nonEmptyString("稳定 runId；必须与工具请求级 runId 一致。"),
    chapterId: { type: "string", minLength: 1, description: "当前章节的真实 ID；standalone 可省略。" },
    sourceCoveragePlan: sourceCoveragePlanSchema,
    visualStateTimeline: visualStateTimelineSchema,
    storyFactsContext: storyFactsContextSchema,
    filmBible: { type: "object", additionalProperties: true },
    adaptationStrategy: { type: "object", additionalProperties: true },
    castManifest: { type: "array", items: { type: "object", additionalProperties: true } },
    beats: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
    meta: {
      type: "object",
      properties: {
        videoModel: nonEmptyString(
          "preflight 的确定性视频模型合同。必须使用当前启用目录返回的 canonical modelKey，例如 doubao-seedance-2.0。",
        ),
      },
      required: ["videoModel"],
      additionalProperties: true,
    },
  },
};

/**
 * Public `preflight_begin` starter node. Creative header sections stay out of
 * the starter so source-unit compilation can return a durable revision first;
 * one later revision-fenced patch may persist every section already authored.
 */
export const beatSheetDraftHeaderSchema: ToolJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Keyframe BeatSheet v2 的最小持久起点。这里只冻结事实身份、视频模型、交付范围，以及 agents 明确选择时的可选商业母版 finishing 请求；收到 sourceUnitCatalog 后，可用一次 revision-fenced preflight_patch_header 同时提交 sourceCoveragePlan、执行规格与所有已经形成的可选创作元数据。",
  properties: {
    version: { type: "integer", const: 2 },
    chapterId: { type: "string", minLength: 1, description: "当前章节的真实 ID；standalone 可省略。" },
    storyFactsContext: storyFactsContextSchema,
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        videoModel: nonEmptyString(
          "必须逐字复制 record_user_intent 已冻结的 enabledVideoModels canonical modelKey。",
        ),
        deliveryScope: {
          type: "string",
          enum: ["full_chapter", "bounded_duration"],
        },
        executionScope: {
          type: "string",
          enum: ["prompt_only", "media_delivery"],
          description: "本 run 的显式执行边界；创建 draft 后不可改写。",
        },
        finishing: videoFinishingRequestSchema,
        speechAudit: videoSpeechAuditRequestSchema,
      },
      required: ["videoModel", "deliveryScope", "executionScope"],
      description:
        "最小执行身份。generationContract、finishingContract、speechAuditContract 与 userIntentContract 由 runtime 注入；finishing 与 speechAudit 仅在 agents 已依据实时目录明确选择商用后期/成片人声审计时提交；aspect/resolution 在 beats 前补齐，其余创作 meta 可选。",
    },
  },
  required: ["version", "storyFactsContext", "meta"],
};
