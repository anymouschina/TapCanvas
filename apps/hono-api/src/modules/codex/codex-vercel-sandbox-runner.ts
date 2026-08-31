import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import type {
	CodexCommandEvidence,
	CodexRemoteBuildSpec,
} from "@tapcanvas/codex-task-protocol";
import type { CodexVercelCredentials } from "./codex-remote-builder-config";

const LOG_BUFFER_BYTES = 256 * 1024;
const LOG_TAIL_LENGTH = 16_000;

class BoundedLogWriter extends Writable {
	private value = "";

	override _write(
		chunk: Buffer | string,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void,
	): void {
		const next = `${this.value}${String(chunk)}`;
		const buffer = Buffer.from(next);
		this.value =
			buffer.length <= LOG_BUFFER_BYTES
				? next
				: buffer
						.subarray(buffer.length - LOG_BUFFER_BYTES)
						.toString("utf8");
		callback();
	}

	text(): string {
		return this.value;
	}
}

type PartialBuildResult = {
	executionId: string | null;
	commands: CodexCommandEvidence[];
};

export class CodexRemoteCodeFailure extends Error {
	constructor(
		message: string,
		readonly partial: PartialBuildResult,
	) {
		super(message);
		this.name = "CodexRemoteCodeFailure";
	}
}

export class CodexRemoteInfrastructureFailure extends Error {
	constructor(
		message: string,
		readonly partial: PartialBuildResult,
	) {
		super(message);
		this.name = "CodexRemoteInfrastructureFailure";
	}
}

export class CodexRemoteUnclassifiedFailure extends Error {
	constructor(
		message: string,
		readonly partial: PartialBuildResult,
	) {
		super(message);
		this.name = "CodexRemoteUnclassifiedFailure";
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function redactEnvironment(
	text: string,
	environment: Record<string, string>,
): string {
	let redacted = text;
	const values = [...new Set(Object.values(environment))]
		.filter((value) => value.length > 0)
		.sort((left, right) => right.length - left.length);
	for (const value of values) {
		redacted = redacted.split(value).join("[REDACTED]");
	}
	return redacted;
}

function commandEvidence(input: {
	name: CodexCommandEvidence["name"];
	exitCode: number;
	startedAt: string;
	completedAt: string;
	log: string;
	environment: Record<string, string>;
}): CodexCommandEvidence {
	const log = redactEnvironment(input.log, input.environment);
	return {
		name: input.name,
		executor: "vercel-sandbox",
		exitCode: input.exitCode,
		startedAt: input.startedAt,
		completedAt: input.completedAt,
		logSha256: sha256(log),
		logTail: log.slice(-LOG_TAIL_LENGTH),
	};
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runCommand(input: {
	sandbox: Sandbox;
	name: "install" | "test" | "build";
	argv: string[];
	spec: CodexRemoteBuildSpec;
	commands: CodexCommandEvidence[];
}): Promise<void> {
	const startedAt = new Date().toISOString();
	const output = new BoundedLogWriter();
	let result;
	try {
		result = await input.sandbox.runCommand({
			cmd: input.argv[0],
			args: input.argv.slice(1),
			cwd: input.sandbox.cwd,
			env: input.spec.environment,
			stdout: output,
			stderr: output,
			timeoutMs: input.spec.timeoutMs,
		});
	} catch (error: unknown) {
		throw new CodexRemoteUnclassifiedFailure(
			`Vercel Sandbox ${input.name} command transport failed without a trustworthy code/infrastructure classification: ${errorText(error)}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
	const evidence = commandEvidence({
		name: input.name,
		exitCode: result.exitCode,
		startedAt,
		completedAt: new Date().toISOString(),
		log: output.text(),
		environment: input.spec.environment,
	});
	input.commands.push(evidence);
	if (result.exitCode !== 0) {
		throw new CodexRemoteCodeFailure(
			`${input.name} command exited with code ${result.exitCode}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
}

async function requireOutputDirectory(input: {
	sandbox: Sandbox;
	spec: CodexRemoteBuildSpec;
	commands: CodexCommandEvidence[];
}): Promise<void> {
	let result;
	try {
		result = await input.sandbox.runCommand({
			cmd: "test",
			args: ["-d", input.spec.outputDirectory],
			cwd: input.sandbox.cwd,
			timeoutMs: 10_000,
		});
	} catch (error: unknown) {
		throw new CodexRemoteUnclassifiedFailure(
			`Cannot verify build output directory: ${errorText(error)}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
	if (result.exitCode !== 0) {
		throw new CodexRemoteCodeFailure(
			`Build completed but outputDirectory does not exist: ${input.spec.outputDirectory}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
}

async function waitForPreview(input: {
	sandbox: Sandbox;
	spec: CodexRemoteBuildSpec;
	commands: CodexCommandEvidence[];
}): Promise<{
	url: string;
	expiresAt: string;
}> {
	const startedAt = new Date().toISOString();
	const output = new BoundedLogWriter();
	let command;
	try {
		command = await input.sandbox.runCommand({
			cmd: input.spec.commands.preview[0],
			args: input.spec.commands.preview.slice(1),
			cwd: input.sandbox.cwd,
			env: input.spec.environment,
			stdout: output,
			stderr: output,
			timeoutMs: input.spec.timeoutMs,
			detached: true,
		});
	} catch (error: unknown) {
		throw new CodexRemoteUnclassifiedFailure(
			`Cannot start preview command: ${errorText(error)}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}

	const domain = input.sandbox.domain(input.spec.previewPort);
	const readyUrl = new URL(input.spec.previewReadyPath, domain).toString();
	const deadline = Date.now() + input.spec.previewReadyTimeoutMs;
	let lastHttpStatus: number | null = null;
	let lastNetworkError = "";

	const exited = command.wait().then((result) => ({
		kind: "exited" as const,
		exitCode: result.exitCode,
	}));
	const ready = (async () => {
		while (Date.now() < deadline) {
			try {
				const response = await fetch(readyUrl, {
					method: "GET",
					redirect: "follow",
					signal: AbortSignal.timeout(10_000),
				});
				lastHttpStatus = response.status;
				if (response.ok) return { kind: "ready" as const };
			} catch (error: unknown) {
				lastNetworkError = errorText(error);
			}
			await new Promise((resolve) => setTimeout(resolve, 750));
		}
		return { kind: "timeout" as const };
	})();

	const outcome = await Promise.race([ready, exited]);
	if (outcome.kind === "exited") {
		const evidence = commandEvidence({
			name: "preview",
			exitCode: outcome.exitCode,
			startedAt,
			completedAt: new Date().toISOString(),
			log: output.text(),
			environment: input.spec.environment,
		});
		input.commands.push(evidence);
		throw new CodexRemoteCodeFailure(
			`Preview command exited before readiness with code ${outcome.exitCode}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
	if (outcome.kind === "timeout") {
		const evidence = commandEvidence({
			name: "preview",
			exitCode: -1,
			startedAt,
			completedAt: new Date().toISOString(),
			log: `${output.text()}\nlastHttpStatus=${String(lastHttpStatus)}\nlastNetworkError=${lastNetworkError}`,
			environment: input.spec.environment,
		});
		input.commands.push(evidence);
		const detail =
			lastHttpStatus !== null
				? `last HTTP status ${lastHttpStatus}`
				: `provider route was unreachable: ${lastNetworkError || "no response"}`;
		const Failure =
			lastHttpStatus !== null
				? CodexRemoteCodeFailure
				: CodexRemoteInfrastructureFailure;
		throw new Failure(
			`Preview did not become ready within ${input.spec.previewReadyTimeoutMs}ms; ${detail}`,
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}

	input.commands.push(
		commandEvidence({
			name: "preview",
			exitCode: 0,
			startedAt,
			completedAt: new Date().toISOString(),
			log: output.text(),
			environment: input.spec.environment,
		}),
	);
	const expiresAt = input.sandbox.expiresAt?.toISOString();
	if (!expiresAt) {
		throw new CodexRemoteInfrastructureFailure(
			"Vercel Sandbox did not expose a preview expiration time",
			{
				executionId: input.sandbox.name,
				commands: input.commands,
			},
		);
	}
	return { url: domain, expiresAt };
}

export async function runVercelSandboxBuild(input: {
	taskId: string;
	previewId: string;
	sourceUrl: string;
	spec: CodexRemoteBuildSpec;
	credentials: CodexVercelCredentials;
	onSourceSeeded: () => Promise<void>;
}): Promise<{
	executionId: string;
	commands: CodexCommandEvidence[];
	preview: {
		previewId: string;
		url: string;
		expiresAt: string;
		isolatedOrigin: true;
	};
}> {
	const commands: CodexCommandEvidence[] = [];
	let sandbox: (Sandbox & AsyncDisposable) | null = null;
	let keepSandbox = false;
	try {
		try {
			sandbox = await Sandbox.create({
				...input.credentials,
				name: `tc-${input.taskId}`,
				source: {
					type: "tarball",
					url: input.sourceUrl,
				},
				resources: { vcpus: input.spec.vcpus },
				ports: [input.spec.previewPort],
				runtime: input.spec.runtime,
				timeout: input.spec.timeoutMs,
				persistent: false,
				tags: {
					product: "tapcanvas",
					task: input.taskId.slice(0, 64),
				},
			});
		} catch (error: unknown) {
			throw new CodexRemoteInfrastructureFailure(
				`Vercel Sandbox creation failed: ${errorText(error)}`,
				{ executionId: null, commands },
			);
		}

		await input.onSourceSeeded();
		await runCommand({
			sandbox,
			name: "install",
			argv: input.spec.commands.install,
			spec: input.spec,
			commands,
		});
		await runCommand({
			sandbox,
			name: "test",
			argv: input.spec.commands.test,
			spec: input.spec,
			commands,
		});
		await runCommand({
			sandbox,
			name: "build",
			argv: input.spec.commands.build,
			spec: input.spec,
			commands,
		});
		await requireOutputDirectory({ sandbox, spec: input.spec, commands });
		const preview = await waitForPreview({
			sandbox,
			spec: input.spec,
			commands,
		});
		keepSandbox = true;
		return {
			executionId: sandbox.name,
			commands,
			preview: {
				previewId: input.previewId,
				url: preview.url,
				expiresAt: preview.expiresAt,
				isolatedOrigin: true,
			},
		};
	} finally {
		if (sandbox && !keepSandbox) {
			await sandbox.stop().catch((error: unknown) => {
				console.error(
					"[codex-remote-builder] failed to stop sandbox",
					errorText(error),
				);
			});
		}
	}
}
