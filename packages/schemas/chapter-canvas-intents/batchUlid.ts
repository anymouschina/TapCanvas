import { CHAPTER_CANVAS_INTENTS, type ChapterCanvasIntent } from "./index";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(now: number): string {
	let out = "";
	let rem = now;
	for (let i = TIME_LEN - 1; i >= 0; i--) {
		const mod = rem % 32;
		out = CROCKFORD[mod] + out;
		rem = Math.floor(rem / 32);
	}
	return out;
}

function encodeRandom(): string {
	let out = "";
	for (let i = 0; i < RAND_LEN; i++) {
		out += CROCKFORD[Math.floor(Math.random() * 32)];
	}
	return out;
}

export function generateBatchUlid(): string {
	return encodeTime(Date.now()) + encodeRandom();
}

export type AgentNodeIdParts = {
	intent: ChapterCanvasIntent;
	batchUlid: string;
	role: string;
};

export function buildAgentNodeId(parts: AgentNodeIdParts): string {
	return `agent-${parts.intent}-${parts.batchUlid}-${parts.role}`;
}

const AGENT_ID_RE =
	/^agent-([a-z_]+)-([0-9A-HJKMNP-TV-Z]{26})-(.+)$/;

export function parseAgentNodeId(id: string): AgentNodeIdParts | null {
	const m = AGENT_ID_RE.exec(id);
	if (!m) return null;
	const [, intent, batchUlid, role] = m;
	if (!(CHAPTER_CANVAS_INTENTS as readonly string[]).includes(intent)) {
		return null;
	}
	return {
		intent: intent as ChapterCanvasIntent,
		batchUlid,
		role,
	};
}
