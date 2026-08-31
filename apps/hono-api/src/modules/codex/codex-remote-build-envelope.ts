import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
} from "node:crypto";
import type { CodexRemoteBuildSpec } from "@tapcanvas/codex-task-protocol";
import type { WorkerEnv } from "../../types";
import { CodexRemoteBuildSpecSchema } from "./codex.schemas";

type SealedEnvelope = {
	version: 1;
	iv: string;
	authTag: string;
	ciphertext: string;
};

function resolveKey(env: WorkerEnv): Buffer {
	const raw =
		typeof env.CODEX_REMOTE_BUILD_ENVELOPE_KEY === "string"
			? env.CODEX_REMOTE_BUILD_ENVELOPE_KEY.trim()
			: "";
	if (!raw) {
		throw new Error("CODEX_REMOTE_BUILD_ENVELOPE_KEY is required");
	}
	const key = Buffer.from(raw, "base64");
	if (key.length !== 32) {
		throw new Error(
			"CODEX_REMOTE_BUILD_ENVELOPE_KEY must be a base64-encoded 32-byte key",
		);
	}
	return key;
}

export function sealCodexRemoteBuildSpec(
	env: WorkerEnv,
	spec: CodexRemoteBuildSpec,
): string {
	const parsed = CodexRemoteBuildSpecSchema.parse(spec);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", resolveKey(env), iv);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(parsed), "utf8"),
		cipher.final(),
	]);
	const envelope: SealedEnvelope = {
		version: 1,
		iv: iv.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};
	return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function openCodexRemoteBuildSpec(
	env: WorkerEnv,
	value: string,
): CodexRemoteBuildSpec {
	let envelope: SealedEnvelope;
	try {
		envelope = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as SealedEnvelope;
	} catch {
		throw new Error("Codex remote build envelope is malformed");
	}
	if (
		envelope.version !== 1 ||
		typeof envelope.iv !== "string" ||
		typeof envelope.authTag !== "string" ||
		typeof envelope.ciphertext !== "string"
	) {
		throw new Error("Codex remote build envelope has an invalid shape");
	}
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			resolveKey(env),
			Buffer.from(envelope.iv, "base64"),
		);
		decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
		const cleartext = Buffer.concat([
			decipher.update(Buffer.from(envelope.ciphertext, "base64")),
			decipher.final(),
		]).toString("utf8");
		return CodexRemoteBuildSpecSchema.parse(
			JSON.parse(cleartext) as unknown,
		);
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : String(error);
		throw new Error(`Codex remote build envelope cannot be opened: ${message}`);
	}
}
