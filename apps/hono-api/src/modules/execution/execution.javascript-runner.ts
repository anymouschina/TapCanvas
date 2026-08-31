import type { WorkerEnv } from "../../types";

type JavascriptRunResult = Readonly<{
	output: unknown;
	durationMs: number;
}>;

const CHILD_SOURCE = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction("input", "\"use strict\";\n" + payload.code);
  const output = await execute(payload.input);
  process.stdout.write(JSON.stringify({ ok: true, output }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function runLocalWorkflowJavascript(
	env: WorkerEnv,
	request: Readonly<{ code: string; input: unknown }>,
): Promise<JavascriptRunResult> {
	if (String(env.WORKFLOW_LOCAL_JAVASCRIPT_ENABLED ?? "").trim().toLowerCase() !== "true") {
		throw new Error("Local JavaScript executor is disabled; set WORKFLOW_LOCAL_JAVASCRIPT_ENABLED=true only for trusted administrator scripts");
	}
	const processRef = (globalThis as { process?: { execPath?: string } }).process;
	if (!processRef?.execPath) {
		throw new Error("Local JavaScript executor requires the self-hosted Node runtime");
	}
	const { spawn } = await import("node:child_process");
	const startedAt = Date.now();
	const child = spawn(processRef.execPath, ["--input-type=module", "--eval", CHILD_SOURCE], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {},
	});
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	child.stdin.end(JSON.stringify({ code: request.code, input: request.input }));
	const exitCode = await new Promise<number | null>((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("Local JavaScript execution exceeded 5 seconds and was terminated"));
		}, 5_000);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			resolve(code);
		});
	});
	const rawOutput = Buffer.concat(stdout).toString("utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawOutput) as unknown;
	} catch {
		const detail = Buffer.concat(stderr).toString("utf8").trim();
		throw new Error(detail || `Local JavaScript process returned invalid JSON (exit=${String(exitCode)})`);
	}
	if (!isRecord(parsed) || parsed.ok !== true) {
		const message = isRecord(parsed) && typeof parsed.error === "string"
			? parsed.error
			: `Local JavaScript process failed (exit=${String(exitCode)})`;
		throw new Error(message);
	}
	return { output: parsed.output ?? null, durationMs: Date.now() - startedAt };
}
