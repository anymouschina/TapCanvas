import { createHash, randomBytes } from "node:crypto";
import type IORedis from "ioredis";
import { getSharedRedis } from "../../platform/redis-shared";
import { CodexQueueUnavailableError } from "./codex-queue-store";

const PAIRING_TTL_SECONDS = 10 * 60;
const PAIRING_RATE_LIMIT_SECONDS = 2;

type StoredPairing = {
	userId: string;
	userToken: string;
	createdAt: string;
	expiresAt: string;
};

const CREATE_PAIRING_SCRIPT = `
local rate_ok = redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2])
if not rate_ok then
  return { "rate_limited" }
end
local previous_hash = redis.call("GET", KEYS[2])
if previous_hash then
  redis.call("DEL", ARGV[3] .. previous_hash)
end
redis.call("SET", KEYS[2], ARGV[4], "EX", ARGV[5])
redis.call("SET", KEYS[3], ARGV[6], "EX", ARGV[5])
return { "created" }
`;

const CONSUME_PAIRING_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return { "missing" }
end
redis.call("DEL", KEYS[1])
local pairing = cjson.decode(raw)
local current_hash = redis.call("GET", ARGV[1] .. pairing.userToken)
if current_hash == ARGV[2] then
  redis.call("DEL", ARGV[1] .. pairing.userToken)
end
return { "consumed", raw }
`;

function token(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseEval(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Codex pairing Redis script returned a non-array response");
	}
	return value.map((item) => String(item));
}

export class CodexPairingRateLimitError extends Error {
	constructor() {
		super("Codex pairing 创建过于频繁");
		this.name = "CodexPairingRateLimitError";
	}
}

export class CodexPairingStore {
	constructor(private readonly redis: IORedis) {}

	private pairingKey(codeHash: string): string {
		return `tapcanvas:codex:pairing:${codeHash}`;
	}

	private userPairingKey(userId: string): string {
		return `${this.userPairingPrefix()}${token(userId)}`;
	}

	private userPairingPrefix(): string {
		return "tapcanvas:codex:pairing:user:";
	}

	private userRateKey(userId: string): string {
		return `tapcanvas:codex:pairing:rate:${token(userId)}`;
	}

	async create(userId: string, now: Date): Promise<{
		pairingCode: string;
		expiresAt: string;
	}> {
		const pairingCode = randomBytes(48).toString("base64url");
		const codeHash = token(pairingCode);
		const expiresAt = new Date(
			now.getTime() + PAIRING_TTL_SECONDS * 1_000,
		).toISOString();
		const stored: StoredPairing = {
			userId,
			userToken: token(userId),
			createdAt: now.toISOString(),
			expiresAt,
		};
		const result = parseEval(
			await this.redis.eval(
				CREATE_PAIRING_SCRIPT,
				3,
				this.userRateKey(userId),
				this.userPairingKey(userId),
				this.pairingKey(codeHash),
				now.toISOString(),
				String(PAIRING_RATE_LIMIT_SECONDS),
				"tapcanvas:codex:pairing:",
				codeHash,
				String(PAIRING_TTL_SECONDS),
				JSON.stringify(stored),
			),
		);
		if (result[0] === "rate_limited") {
			throw new CodexPairingRateLimitError();
		}
		if (result[0] !== "created") {
			throw new Error(`Unknown Codex pairing create result: ${result.join(",")}`);
		}
		return { pairingCode, expiresAt };
	}

	async consume(pairingCode: string): Promise<StoredPairing | null> {
		const codeHash = token(pairingCode);
		const result = parseEval(
			await this.redis.eval(
				CONSUME_PAIRING_SCRIPT,
				1,
				this.pairingKey(codeHash),
				this.userPairingPrefix(),
				codeHash,
			),
		);
		if (result[0] === "missing") return null;
		if (result[0] !== "consumed") {
			throw new Error(`Unknown Codex pairing consume result: ${result.join(",")}`);
		}
		const parsed = JSON.parse(result[1] || "{}") as unknown;
		if (!parsed || typeof parsed !== "object") {
			throw new Error("Stored Codex pairing is invalid");
		}
		const record = parsed as Record<string, unknown>;
		if (
			typeof record.userId !== "string" ||
			typeof record.userToken !== "string" ||
			typeof record.createdAt !== "string" ||
			typeof record.expiresAt !== "string"
		) {
			throw new Error("Stored Codex pairing is missing required fields");
		}
		return {
			userId: record.userId,
			userToken: record.userToken,
			createdAt: record.createdAt,
			expiresAt: record.expiresAt,
		};
	}
}

let pairingStoreOverride: CodexPairingStore | null = null;

export function setCodexPairingStoreForTests(
	store: CodexPairingStore | null,
): void {
	pairingStoreOverride = store;
}

export function requireCodexPairingStore(): CodexPairingStore {
	if (pairingStoreOverride) return pairingStoreOverride;
	const redis = getSharedRedis();
	if (!redis) {
		throw new CodexQueueUnavailableError(
			"Codex pairing is unavailable because REDIS_URL is not configured",
		);
	}
	return new CodexPairingStore(redis);
}
