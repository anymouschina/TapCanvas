"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBatchUlid = generateBatchUlid;
exports.buildAgentNodeId = buildAgentNodeId;
exports.parseAgentNodeId = parseAgentNodeId;
const index_1 = require("./index");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;
function encodeTime(now) {
    let out = "";
    let rem = now;
    for (let i = TIME_LEN - 1; i >= 0; i--) {
        const mod = rem % 32;
        out = CROCKFORD[mod] + out;
        rem = Math.floor(rem / 32);
    }
    return out;
}
function encodeRandom() {
    let out = "";
    for (let i = 0; i < RAND_LEN; i++) {
        out += CROCKFORD[Math.floor(Math.random() * 32)];
    }
    return out;
}
function generateBatchUlid() {
    return encodeTime(Date.now()) + encodeRandom();
}
function buildAgentNodeId(parts) {
    return `agent-${parts.intent}-${parts.batchUlid}-${parts.role}`;
}
const AGENT_ID_RE = /^agent-([a-z_]+)-([0-9A-HJKMNP-TV-Z]{26})-(.+)$/;
function parseAgentNodeId(id) {
    const m = AGENT_ID_RE.exec(id);
    if (!m)
        return null;
    const [, intent, batchUlid, role] = m;
    if (!index_1.CHAPTER_CANVAS_INTENTS.includes(intent)) {
        return null;
    }
    return {
        intent: intent,
        batchUlid,
        role,
    };
}
