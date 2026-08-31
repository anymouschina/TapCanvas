import { z } from "zod";
import {
	CODEX_BUILD_EXECUTORS,
	CODEX_FALLBACK_POLICIES,
	CODEX_TASK_MESSAGE_STATES,
	CODEX_TASK_PROTOCOL_VERSION,
	CODEX_TASK_STATES,
	CODEX_TURN_OUTCOMES,
	type CodexBridgeHeartbeat,
	type CodexBridgeSummary,
	type CodexBuildCommandSet,
	type CodexCanvasContext,
	type CodexCanvasContextSnapshot,
	type CodexCanvasScope,
	type CodexCommandEvidence,
	type CodexDeliveryEvidence,
	type CodexDeliveryVerification,
	type CodexExpectedDelivery,
	type CodexFallbackDecision,
	type CodexPairingExchangeRequest,
	type CodexPairingExchangeResponse,
	type CodexPairingSession,
	type CodexPreviewResolution,
	type CodexRemoteBuildRequest,
	type CodexRemoteBuildResponse,
	type CodexRemoteBuildSpec,
	type CodexSourceUploadRequest,
	type CodexSourceUploadResponse,
	type CodexSourceDiscardRequest,
	type CodexTask,
	type CodexTaskClaimRequest,
	type CodexTaskClaimResponse,
	type CodexTaskEvent,
	type CodexTaskLeaseHeartbeat,
	type CodexTaskMessage,
	type CodexTaskMessageAckRequest,
	type CodexTaskMessageClaimRequest,
	type CodexTaskMessageClaimResponse,
	type CodexTaskMessageListResponse,
	type CodexTaskWorkerUpdate,
	type CodexWorkspaceSummary,
	type CreateCodexTaskMessageRequest,
	type CreateCodexTaskMessageResponse,
	type CreateCodexTaskRequest,
	type CreateCodexTaskResponse,
} from "@tapcanvas/codex-task-protocol";

export const CodexTaskStateSchema = z.enum(CODEX_TASK_STATES);
export const CodexBuildExecutorSchema = z.enum(CODEX_BUILD_EXECUTORS);
export const CodexFallbackPolicySchema = z.enum(CODEX_FALLBACK_POLICIES);
export const CodexTurnOutcomeSchema = z.enum(CODEX_TURN_OUTCOMES);
export const CodexTaskMessageStateSchema = z.enum(CODEX_TASK_MESSAGE_STATES);

export const CodexWorkspaceSummarySchema: z.ZodType<CodexWorkspaceSummary> =
	z.object({
		id: z.string().trim().min(1).max(80),
		label: z.string().trim().min(1).max(120),
		configFingerprint: z.string().trim().min(16).max(128),
		remoteBuildConfigured: z.boolean(),
		localDockerConfigured: z.boolean(),
	});

export const CodexBridgeHeartbeatSchema: z.ZodType<CodexBridgeHeartbeat> =
	z.object({
		protocolVersion: z.literal(CODEX_TASK_PROTOCOL_VERSION),
		bridgeId: z.string().trim().min(8).max(120),
		workerInstanceId: z.string().trim().min(8).max(120),
		name: z.string().trim().min(1).max(120),
		workerVersion: z.string().trim().min(1).max(40),
		codexVersion: z.string().trim().min(1).max(80),
		workspaces: z.array(CodexWorkspaceSummarySchema).min(1).max(64),
	});

export const CodexBridgeSummarySchema: z.ZodType<CodexBridgeSummary> =
	CodexBridgeHeartbeatSchema.and(
		z.object({
			status: z.enum(["online", "offline"]),
			lastSeenAt: z.string().datetime(),
			activeTaskId: z.string().trim().min(1).nullable(),
		}),
	);

const CodexCanvasScopeShape = {
		projectId: z.string().trim().min(1).max(120),
		flowId: z.string().trim().min(1).max(120).nullable(),
		chapterId: z.string().trim().min(1).max(120).nullable(),
		canvasRevision: z.number().int().nonnegative().nullable(),
		selectedNodeIds: z
			.array(z.string().trim().min(1).max(160))
			.max(100),
	} as const;

function rejectAmbiguousCanvasScope(
	value: CodexCanvasScope,
	ctx: z.RefinementCtx,
): void {
	if (value.flowId && value.chapterId) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "flowId 与 chapterId 不能同时存在",
			path: ["chapterId"],
		});
	}
	const hasCanvas = Boolean(value.flowId || value.chapterId);
	if (hasCanvas && value.canvasRevision === null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "flow/chapter 画布必须携带已确认的 canvasRevision",
			path: ["canvasRevision"],
		});
	}
	if (!hasCanvas && value.canvasRevision !== null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "项目级作用域不能携带 canvasRevision",
			path: ["canvasRevision"],
		});
	}
	if (!hasCanvas && value.selectedNodeIds.length > 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "项目级作用域没有画布，不能携带 selectedNodeIds",
			path: ["selectedNodeIds"],
		});
	}
}

export const CodexCanvasScopeSchema: z.ZodType<CodexCanvasScope> = z
	.object(CodexCanvasScopeShape)
	.superRefine(rejectAmbiguousCanvasScope);

export const CodexCanvasContextSchema: z.ZodType<CodexCanvasContext> = z
	.object({
		...CodexCanvasScopeShape,
		snapshotId: z.string().trim().min(8).max(120),
		selectedNodeKinds: z
			.array(z.string().trim().min(1).max(80))
			.max(100),
		projectName: z.string().trim().min(1).max(240),
		flowName: z.string().trim().min(1).max(240).nullable(),
		nodeCount: z.number().int().nonnegative(),
		edgeCount: z.number().int().nonnegative(),
		sha256: z.string().trim().length(64),
		createdAt: z.string().datetime(),
	})
	.superRefine(rejectAmbiguousCanvasScope);

export const CodexCanvasContextSnapshotSchema: z.ZodType<CodexCanvasContextSnapshot> =
	CodexCanvasContextSchema.and(
		z.object({
			graph: z.object({
				nodes: z.array(z.unknown()),
				edges: z.array(z.unknown()),
				viewport: z
					.object({
						x: z.number().finite(),
						y: z.number().finite(),
						zoom: z.number().finite().positive(),
					})
					.nullable(),
			}),
			selectedNodes: z.array(z.unknown()).max(100),
		}),
	);

const CodexExpectedDeliveryCriterionSchema = z.enum([
	"codex_turn",
	"tests",
	"build",
	"preview",
]);

export const CodexExpectedDeliverySchema: z.ZodType<CodexExpectedDelivery> =
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("workspace_change_with_verified_preview"),
			workspaceId: z.string().trim().min(1).max(80),
			requiredEvidence: z
				.array(CodexExpectedDeliveryCriterionSchema)
				.length(4),
		}),
		z.object({
			kind: z.literal("codex_response"),
			workspaceId: z.string().trim().min(1).max(80),
			requiredEvidence: z.tuple([z.literal("codex_turn")]),
		}),
	]);

export const CodexCommandEvidenceSchema: z.ZodType<CodexCommandEvidence> =
	z.object({
		name: z.enum(["install", "test", "build", "preview"]),
		executor: CodexBuildExecutorSchema,
		exitCode: z.number().int(),
		startedAt: z.string().datetime(),
		completedAt: z.string().datetime(),
		logSha256: z.string().trim().length(64),
		logTail: z.string().max(16_000),
	});

export const CodexDeliveryEvidenceSchema: z.ZodType<CodexDeliveryEvidence> =
	z.object({
		source: z
			.object({
				sha256: z.string().trim().length(64),
				archiveBytes: z.number().int().nonnegative(),
			})
			.nullable(),
		codex: z
			.object({
				threadId: z.string().trim().min(1),
				turnId: z.string().trim().min(1),
				status: z.enum(["completed", "failed", "interrupted"]),
				outcome: CodexTurnOutcomeSchema,
				changedFiles: z
					.array(z.string().trim().min(1).max(500))
					.max(500),
				summary: z.string().max(16_000),
			})
			.nullable(),
		build: z
			.object({
				executor: CodexBuildExecutorSchema,
				executionId: z.string().trim().min(1).max(200),
				commands: z.array(CodexCommandEvidenceSchema).max(8),
			})
			.nullable(),
		preview: z
			.object({
				previewId: z.string().trim().min(16).max(160),
				url: z.string().url(),
				expiresAt: z.string().datetime(),
				isolatedOrigin: z.literal(true),
			})
			.nullable(),
	});

export const CodexDeliveryVerificationSchema: z.ZodType<CodexDeliveryVerification> =
	z.object({
		status: z.enum(["pending", "satisfied", "failed"]),
		checkedAt: z.string().datetime().nullable(),
		missingCriteria: z.array(CodexExpectedDeliveryCriterionSchema),
		rationale: z.string().max(2_000),
	});

export const CodexTaskEventSchema: z.ZodType<CodexTaskEvent> = z.object({
	id: z.string().trim().min(8).max(120),
	taskId: z.string().trim().min(8).max(120),
	at: z.string().datetime(),
	state: CodexTaskStateSchema,
	code: z.string().trim().min(1).max(120),
	message: z.string().max(8_000),
});

export const CodexTaskSchema: z.ZodType<CodexTask> = z.object({
	protocolVersion: z.literal(CODEX_TASK_PROTOCOL_VERSION),
	id: z.string().trim().min(8).max(120),
	sessionId: z.string().trim().min(8).max(120),
	parentTaskId: z.string().trim().min(8).max(120).nullable(),
	turnSequence: z.number().int().positive(),
	resumeThreadId: z.string().trim().min(1).max(500).nullable(),
	userId: z.string().trim().min(1).max(160),
	bridgeId: z.string().trim().min(8).max(120),
	workspaceId: z.string().trim().min(1).max(80),
	workspaceConfigFingerprint: z.string().trim().length(64),
	goal: z.string().trim().min(1).max(30_000),
	context: CodexCanvasContextSchema,
	fallbackPolicy: CodexFallbackPolicySchema,
	state: CodexTaskStateSchema,
	previewId: z.string().trim().min(16).max(160),
	idempotencyKey: z.string().trim().min(8).max(200),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	terminalAt: z.string().datetime().nullable(),
	lastMessage: z.string().max(8_000),
	expectedDelivery: CodexExpectedDeliverySchema,
	deliveryEvidence: CodexDeliveryEvidenceSchema,
	deliveryVerification: CodexDeliveryVerificationSchema,
});

export const CreateCodexTaskRequestSchema: z.ZodType<CreateCodexTaskRequest> =
	z.object({
		bridgeId: z.string().trim().min(8).max(120),
		workspaceId: z.string().trim().min(1).max(80),
		sessionId: z.string().trim().min(8).max(120).nullable(),
		parentTaskId: z.string().trim().min(8).max(120).nullable(),
		goal: z.string().trim().min(1).max(30_000),
		context: CodexCanvasScopeSchema,
		fallbackPolicy: CodexFallbackPolicySchema,
		idempotencyKey: z.string().trim().min(8).max(200),
	}).superRefine((value, ctx) => {
		if (Boolean(value.sessionId) === Boolean(value.parentTaskId)) return;
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "sessionId 与 parentTaskId 必须同时提供或同时为空",
			path: value.sessionId ? ["parentTaskId"] : ["sessionId"],
		});
	});

export const CreateCodexTaskResponseSchema: z.ZodType<CreateCodexTaskResponse> =
	z.object({
		task: CodexTaskSchema,
		deduplicated: z.boolean(),
		queuePosition: z.number().int().positive().nullable(),
	});

export const CodexTaskListResponseSchema = z.object({
	items: z.array(CodexTaskSchema),
});

export const CodexBridgeListResponseSchema = z.object({
	items: z.array(CodexBridgeSummarySchema),
});

export const CodexTaskClaimRequestSchema: z.ZodType<CodexTaskClaimRequest> =
	z.object({
		bridgeId: z.string().trim().min(8).max(120),
		workerInstanceId: z.string().trim().min(8).max(120),
	});

export const CodexTaskClaimResponseSchema: z.ZodType<CodexTaskClaimResponse> =
	z.object({
		task: CodexTaskSchema.nullable(),
		contextSnapshot: CodexCanvasContextSnapshotSchema.nullable(),
		leaseId: z.string().trim().min(16).max(160).nullable(),
		leaseExpiresAt: z.string().datetime().nullable(),
	});

export const CodexTaskLeaseHeartbeatSchema: z.ZodType<CodexTaskLeaseHeartbeat> =
	z.object({
		bridgeId: z.string().trim().min(8).max(120),
		workerInstanceId: z.string().trim().min(8).max(120),
		leaseId: z.string().trim().min(16).max(160),
	});

export const CodexTaskWorkerUpdateSchema: z.ZodType<CodexTaskWorkerUpdate> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({
			state: CodexTaskStateSchema,
			code: z.string().trim().min(1).max(120),
			message: z.string().max(8_000),
			expectedDelivery: CodexExpectedDeliverySchema.optional(),
			deliveryEvidence: CodexDeliveryEvidenceSchema.optional(),
		}),
	);

export const CodexTaskMessageSchema: z.ZodType<CodexTaskMessage> = z.object({
	id: z.string().trim().min(8).max(120),
	taskId: z.string().trim().min(8).max(120),
	sessionId: z.string().trim().min(8).max(120),
	text: z.string().trim().min(1).max(30_000),
	state: CodexTaskMessageStateSchema,
	idempotencyKey: z.string().trim().min(8).max(200),
	createdAt: z.string().datetime(),
	deliveredAt: z.string().datetime().nullable(),
	detail: z.string().max(2_000),
});

export const CreateCodexTaskMessageRequestSchema: z.ZodType<CreateCodexTaskMessageRequest> =
	z.object({
		text: z.string().trim().min(1).max(30_000),
		idempotencyKey: z.string().trim().min(8).max(200),
	});

export const CreateCodexTaskMessageResponseSchema: z.ZodType<CreateCodexTaskMessageResponse> =
	z.object({
		message: CodexTaskMessageSchema,
		deduplicated: z.boolean(),
	});

export const CodexTaskMessageListResponseSchema: z.ZodType<CodexTaskMessageListResponse> =
	z.object({ items: z.array(CodexTaskMessageSchema).max(100) });

export const CodexTaskMessageClaimRequestSchema: z.ZodType<CodexTaskMessageClaimRequest> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({ limit: z.number().int().min(1).max(20) }),
	);

export const CodexTaskMessageClaimResponseSchema: z.ZodType<CodexTaskMessageClaimResponse> =
	z.object({ items: z.array(CodexTaskMessageSchema).max(20) });

export const CodexTaskMessageAckRequestSchema: z.ZodType<CodexTaskMessageAckRequest> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({
			messageId: z.string().trim().min(8).max(120),
				state: z.enum(["delivered", "rejected", "unknown"]),
			detail: z.string().max(2_000),
		}),
	);

const CodexArgvSchema = z
	.array(z.string().trim().min(1).max(2_000))
	.min(1)
	.max(64);

export const CodexBuildCommandSetSchema: z.ZodType<CodexBuildCommandSet> =
	z.object({
		install: CodexArgvSchema,
		test: CodexArgvSchema,
		build: CodexArgvSchema,
		preview: CodexArgvSchema,
	});

export const CodexRemoteBuildSpecSchema: z.ZodType<CodexRemoteBuildSpec> =
	z.object({
		configFingerprint: z.string().trim().length(64),
		runtime: z.enum(["node22", "node24", "node26"]),
		timeoutMs: z.number().int().min(60_000).max(86_400_000),
		vcpus: z.number().int().min(1).max(8),
		commands: CodexBuildCommandSetSchema,
		outputDirectory: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.refine(
				(value) =>
					!value.startsWith("/") &&
					value !== ".." &&
					!value.startsWith("../"),
				"outputDirectory must stay inside the workspace",
			),
		previewPort: z.number().int().min(1_024).max(65_535),
		previewReadyPath: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.startsWith("/"),
		previewReadyTimeoutMs: z.number().int().min(5_000).max(300_000),
		environment: z.record(
			z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
			z.string().max(100_000),
		),
	});

export const CodexSourceUploadRequestSchema: z.ZodType<CodexSourceUploadRequest> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({
			sourceSha256: z.string().trim().length(64),
			archiveBytes: z.number().int().positive().max(250 * 1024 * 1024),
		}),
	);

export const CodexSourceUploadResponseSchema: z.ZodType<CodexSourceUploadResponse> =
	z.object({
		uploadUrl: z.string().url(),
		objectKey: z.string().trim().min(1).max(1_000),
		expiresAt: z.string().datetime(),
		requiredHeaders: z.object({
			"content-type": z.literal("application/gzip"),
			"x-amz-meta-sha256": z.string().trim().length(64),
		}),
	});

export const CodexSourceDiscardRequestSchema: z.ZodType<CodexSourceDiscardRequest> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({
			sourceSha256: z.string().trim().length(64),
			objectKey: z.string().trim().min(1).max(1_000),
		}),
	);

export const CodexRemoteBuildRequestSchema: z.ZodType<CodexRemoteBuildRequest> =
	CodexTaskLeaseHeartbeatSchema.and(
		z.object({
			sourceSha256: z.string().trim().length(64),
			archiveBytes: z.number().int().positive().max(250 * 1024 * 1024),
			objectKey: z.string().trim().min(1).max(1_000),
			spec: CodexRemoteBuildSpecSchema,
		}),
	);

export const CodexRemoteBuildResponseSchema: z.ZodType<CodexRemoteBuildResponse> =
	z.object({
		buildId: z.string().trim().min(8).max(160),
		state: z.literal("queued"),
	});

export const CodexFallbackDecisionSchema: z.ZodType<CodexFallbackDecision> =
	z.object({
		decision: z.enum(["approve", "decline"]),
	});

export const CodexPreviewResolutionSchema: z.ZodType<CodexPreviewResolution> =
	z.object({
		previewId: z.string().trim().min(16).max(160),
		taskId: z.string().trim().min(8).max(120),
		url: z.string().url(),
		expiresAt: z.string().datetime(),
		isolatedOrigin: z.literal(true),
	});

export const CodexPairingSessionSchema: z.ZodType<CodexPairingSession> =
	z.object({
		pairingCode: z.string().trim().min(32).max(256),
		expiresAt: z.string().datetime(),
	});

export const CodexPairingExchangeRequestSchema: z.ZodType<CodexPairingExchangeRequest> =
	z.object({
		pairingCode: z.string().trim().min(32).max(256),
		deviceName: z.string().trim().min(1).max(120),
	});

export const CodexPairingExchangeResponseSchema: z.ZodType<CodexPairingExchangeResponse> =
	z.object({
		apiKey: z.string().trim().min(32).max(2_000),
		pairedAt: z.string().datetime(),
	});
