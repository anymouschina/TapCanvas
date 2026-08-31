import type {
	CodexDeliveryEvidence,
	CodexTaskState,
} from "@tapcanvas/codex-task-protocol";
import type { WorkerEnv } from "../../types";
import { requireCodexQueueStore } from "./codex-queue-store";
import type { CodexRemoteBuildJobData } from "./codex-remote-build-queue";
import { openCodexRemoteBuildSpec } from "./codex-remote-build-envelope";
import {
	assertCodexRemoteBuilderConfigured,
	resolveCodexVercelCredentials,
} from "./codex-remote-builder-config";
import {
	codexSourceObjectKey,
	createCodexSourceDownloadUrl,
	deleteCodexSourceObject,
	verifyCodexSourceObject,
} from "./codex-source-storage";
import {
	CodexRemoteCodeFailure,
	CodexRemoteInfrastructureFailure,
	CodexRemoteUnclassifiedFailure,
	runVercelSandboxBuild,
} from "./codex-vercel-sandbox-runner";

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function evidenceWithBuild(
	base: CodexDeliveryEvidence,
	input: {
		executionId: string | null;
		commands: NonNullable<CodexDeliveryEvidence["build"]>["commands"];
	},
): CodexDeliveryEvidence {
	return {
		...base,
		build: input.executionId
			? {
					executor: "vercel-sandbox",
					executionId: input.executionId,
					commands: input.commands,
				}
			: null,
	};
}

export async function executeCodexRemoteBuildJob(
	data: CodexRemoteBuildJobData,
	env: WorkerEnv,
): Promise<void> {
	assertCodexRemoteBuilderConfigured(env);
	const store = requireCodexQueueStore();
	const current = await store.getTask(data.userId, data.taskId);
	if (!current) throw new Error("Codex remote build task no longer exists");
	if (current.state !== "remote_build_queued") {
		throw new Error(
			`Codex remote build expected remote_build_queued, got ${current.state}`,
		);
	}
	const spec = openCodexRemoteBuildSpec(env, data.sealedSpec);
	if (
		current.bridgeId !== data.bridgeId ||
		current.workspaceConfigFingerprint !==
			spec.configFingerprint
	) {
		throw new Error("Codex remote build task/config scope mismatch");
	}
	const expectedObjectKey = codexSourceObjectKey({
		userId: data.userId,
		taskId: data.taskId,
		sourceSha256: data.sourceSha256,
	});
	if (data.objectKey !== expectedObjectKey) {
		throw new Error("Codex remote build source object is outside task scope");
	}

	const lease = {
		bridgeId: data.bridgeId,
		workerInstanceId: data.workerInstanceId,
		leaseId: data.leaseId,
	};
	const sourceEvidence = {
		sha256: data.sourceSha256,
		archiveBytes: data.archiveBytes,
	};
	const baseEvidence: CodexDeliveryEvidence = {
		...current.deliveryEvidence,
		source: sourceEvidence,
	};
	let sourceDeleted = false;

	const update = async (input: {
		state: CodexTaskState;
		code: string;
		message: string;
		deliveryEvidence: CodexDeliveryEvidence;
	}) =>
		store.updateTaskFromWorker({
			userId: data.userId,
			taskId: data.taskId,
			...lease,
			...input,
			nowIso: new Date().toISOString(),
		});

	try {
		await verifyCodexSourceObject({
			env,
			objectKey: data.objectKey,
			sourceSha256: data.sourceSha256,
			archiveBytes: data.archiveBytes,
		});
		const sourceUrl = await createCodexSourceDownloadUrl({
			env,
			objectKey: data.objectKey,
		});
		await update({
			state: "remote_build_running",
			code: "remote_build_started",
			message: "Vercel Sandbox 已领取源码；安装、测试、构建与预览将在远端隔离环境执行。",
			deliveryEvidence: baseEvidence,
		});

		try {
			const result = await runVercelSandboxBuild({
				taskId: data.taskId,
				previewId: current.previewId,
				sourceUrl,
				spec,
				credentials: resolveCodexVercelCredentials(env),
				onSourceSeeded: async () => {
					await deleteCodexSourceObject({
						env,
						objectKey: data.objectKey,
					});
					sourceDeleted = true;
				},
			});
			await update({
				state: "succeeded",
				code: "remote_build_succeeded",
				message: "Codex 修改已通过远程测试、构建与隔离预览验收。",
				deliveryEvidence: {
					...baseEvidence,
					build: {
						executor: "vercel-sandbox",
						executionId: result.executionId,
						commands: result.commands,
					},
					preview: result.preview,
				},
			});
		} catch (error: unknown) {
			if (error instanceof CodexRemoteCodeFailure) {
				await update({
					state: "remote_build_failed_code",
					code: "remote_build_code_failure",
					message: error.message,
					deliveryEvidence: evidenceWithBuild(
						baseEvidence,
						error.partial,
					),
				});
				return;
			}
			if (error instanceof CodexRemoteInfrastructureFailure) {
				await update({
					state: "remote_build_failed_infrastructure",
					code: "remote_build_infrastructure_failure",
					message: error.message,
					deliveryEvidence: evidenceWithBuild(
						baseEvidence,
						error.partial,
					),
				});
				return;
			}
			const partial =
				error instanceof CodexRemoteUnclassifiedFailure
					? error.partial
					: { executionId: null, commands: [] };
			await update({
				state: "failed",
				code: "remote_build_unclassified_failure",
				message: `远程构建失败且无法可靠归类为第三方基础设施故障，禁止自动开放本机 fallback：${message(error)}`,
				deliveryEvidence: evidenceWithBuild(baseEvidence, partial),
			});
		}
	} catch (error: unknown) {
		const latest = await store.getTask(data.userId, data.taskId);
		if (
			latest?.state === "remote_build_queued" ||
			latest?.state === "remote_build_running"
		) {
			await update({
				state: "failed",
				code: "remote_build_preflight_unclassified_failure",
				message: `远程构建前置校验失败，且没有足够证据归类为第三方 Sandbox 基础设施故障，禁止开放本机 fallback：${message(error)}`,
				deliveryEvidence: {
					...latest.deliveryEvidence,
					source: sourceEvidence,
				},
			});
			return;
		}
		throw error;
	} finally {
		if (!sourceDeleted) {
			await deleteCodexSourceObject({
				env,
				objectKey: data.objectKey,
			}).catch((error: unknown) => {
				console.error(
					"[codex-remote-builder] private source cleanup failed",
					JSON.stringify({
						taskId: data.taskId,
						objectKey: data.objectKey,
						error: message(error),
					}),
				);
			});
		}
	}
}
