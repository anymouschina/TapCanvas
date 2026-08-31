import type { ToolExecutionSemantics } from "../ai/tool-schemas";

export type ShotCriticRemoteToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execution?: ToolExecutionSemantics;
};

export const buildShotTableCriticRemoteTool = (): ShotCriticRemoteToolDefinition => ({
	name: "tapcanvas_shot_table_critic",
	description:
		"可选的独立导演评审/诊断工具，必须显式选择 reviewMode。text_storyboard 审完整文本分镜表：传 shotTable，可附 sourceMaterial 与 reviewContract。video_clips 审实际出片 clips：带 runId 时读取服务端 durable executable plan；无 runId 时必须传当前 clips、filmBible、generationContract。两种模式禁止混用参数。返回 pass、affectedClipIndexes、issues 与 topFixes；分数、pass、missing 与建议都只作诊断证据，不阻断视频生产。",
	parameters: {
		type: "object",
		properties: {
			reviewMode: {
				type: "string",
				enum: ["text_storyboard", "video_clips"],
				description:
					"必填。text_storyboard=文本分镜表独立评审；video_clips=出片结构化 clips 评审。",
			},
			shotTable: {
				type: "string",
				description:
					"reviewMode=text_storyboard 必填：准备交付的完整分镜表正文，必须与最终输出同一份，不接受概括版。",
			},
			sourceMaterial: {
				type: "string",
				description:
					"reviewMode=text_storyboard 的来源真相：剧本原文或视频事实提取全文。单独调用时可省；携带 reviewContract 时必填。提供后 critic 才审剧情、对白、镜头边界与时间码忠实度。",
			},
			reviewContract: {
				type: "object",
				additionalProperties: false,
				description:
					"reviewMode=text_storyboard 可选的结构化硬合同；视频分析/剧本转分镜宿主会在 prompt 中给出完整值，必须原样传入。",
				properties: {
					version: { type: "integer", enum: [1] },
					reviewMode: { type: "string", enum: ["text_storyboard"] },
					skillKey: { type: "string", enum: ["tapcanvas-storyboard-expert"] },
					sourceKind: { type: "string", enum: ["script", "video_evidence"] },
					columns: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								key: { type: "string" },
								label: { type: "string" },
								scope: { type: "string", enum: ["shot", "timeline"] },
							},
							required: ["key", "label", "scope"],
						},
					},
					sourceLocks: {
						type: "object",
						additionalProperties: false,
						properties: {
							plot: { type: "string", enum: ["locked"] },
							dialogueTextAndOrder: { type: "string", enum: ["locked"] },
							existingShotStructure: { type: "string", enum: ["preserve_when_present"] },
							observedVideoCutsAndTiming: { type: "string", enum: ["locked", "not_applicable"] },
						},
						required: [
							"plot",
							"dialogueTextAndOrder",
							"existingShotStructure",
							"observedVideoCutsAndTiming",
						],
					},
					pacingLimits: {
						type: "object",
						additionalProperties: false,
						properties: {
							targetBeatSeconds: { type: "number", enum: [15] },
							maximumTimelineSegmentSeconds: { type: "number", enum: [3] },
							maximumChineseDialogueCharactersPerSegment: { type: "number", enum: [8] },
							maximumEnglishWordsPerSecond: { type: "number", enum: [3] },
						},
						required: [
							"targetBeatSeconds",
							"maximumTimelineSegmentSeconds",
							"maximumChineseDialogueCharactersPerSegment",
							"maximumEnglishWordsPerSecond",
						],
					},
					delivery: {
						type: "object",
						additionalProperties: false,
						properties: {
							music: { type: "string", enum: ["disabled"] },
							subtitles: { type: "string", enum: ["disabled"] },
						},
						required: ["music", "subtitles"],
					},
				},
				required: [
					"version",
					"reviewMode",
					"skillKey",
					"sourceKind",
					"columns",
					"sourceLocks",
					"pacingLimits",
					"delivery",
				],
			},
			runId: {
				type: "string",
				description:
					"可传 video_orchestrate 使用的同一 runId。服务端按它读取哈希有效的 durable executable plan clips 作为受审文本；shotTable/clips 参数此时可省、给了也被忽略。",
			},
			brief: {
				type: "string",
				description: "可选：题材/风格简述，帮助评审判断节奏与镜头语言是否契合。",
			},
			clips: {
				type: "array",
				description:
					"无 runId 的 writer/散跑评审必填：最终准备交付的结构化 clips JSON。critic 直接由它确定性渲染受审镜头表，禁止另写概括版。带 runId 时忽略并改读服务端哈希有效的 durable executable plan clips。",
				items: { type: "object", additionalProperties: true },
			},
			filmBible: {
				type: "object",
				additionalProperties: true,
				description: "无 runId 时必填：当前 Run 的 filmBible，供同源渲染最终提示词；带 runId 时服务端读取持久化值。",
			},
			generationContract: {
				type: "object",
				additionalProperties: false,
				description: "无 runId 时必填：从 writer 任务书原样传入的视频生成合同。",
				properties: {
					videoModel: { type: "string" },
					durationOptions: { type: "array", items: { type: "number" } },
					maxDurationSeconds: { type: "number" },
					referenceImagePolicy: {
						type: "object",
						additionalProperties: false,
						properties: {
							countUnit: { type: "string", enum: ["unique_url"] },
							maximumTotalImages: { type: "integer" },
							maximumBusinessImages: { type: "integer" },
						},
						required: [
							"countUnit",
							"maximumTotalImages",
							"maximumBusinessImages",
						],
					},
					referenceAudioPolicy: {
						type: "object",
						additionalProperties: false,
						properties: {
							minimumDurationSeconds: { type: "number" },
							maximumDurationSeconds: { type: "number" },
						},
						required: ["minimumDurationSeconds", "maximumDurationSeconds"],
					},
				},
				required: [
					"videoModel",
					"durationOptions",
					"maxDurationSeconds",
					"referenceImagePolicy",
					"referenceAudioPolicy",
				],
			},
		},
		required: ["reviewMode"],
		additionalProperties: false,
	},
});
