"use strict";
/**
 * TapCanvas Canvas → host Codex task protocol.
 *
 * This package intentionally has no runtime dependency. Web and Hono import the
 * same literal unions and TypeScript contracts; Hono owns runtime Zod validation
 * in modules/codex/codex.schemas.ts so package resolution never depends on a
 * repository-root node_modules directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODEX_TASK_MESSAGE_STATES = exports.CODEX_TURN_OUTCOMES = exports.CODEX_FALLBACK_POLICIES = exports.CODEX_BUILD_EXECUTORS = exports.CODEX_TERMINAL_TASK_STATES = exports.CODEX_TASK_STATES = exports.CODEX_TASK_PROTOCOL_VERSION = void 0;
exports.isCodexTerminalTaskState = isCodexTerminalTaskState;
exports.CODEX_TASK_PROTOCOL_VERSION = 2;
exports.CODEX_TASK_STATES = [
    "queued",
    "claimed",
    "codex_running",
    "awaiting_user_input",
    "codex_failed",
    "remote_build_queued",
    "remote_build_running",
    "remote_build_failed_code",
    "remote_build_failed_infrastructure",
    "fallback_waiting_approval",
    "local_fallback_approved",
    "local_build_running",
    "succeeded",
    "failed",
    "canceled",
    "unknown",
];
exports.CODEX_TERMINAL_TASK_STATES = [
    "awaiting_user_input",
    "codex_failed",
    "remote_build_failed_code",
    "succeeded",
    "failed",
    "canceled",
    "unknown",
];
exports.CODEX_BUILD_EXECUTORS = [
    "vercel-sandbox",
    "local-docker",
];
exports.CODEX_FALLBACK_POLICIES = ["disabled", "ask"];
exports.CODEX_TURN_OUTCOMES = [
    "workspace_changed",
    "needs_input",
    "response_only",
    "failed",
];
exports.CODEX_TASK_MESSAGE_STATES = [
    "queued",
    "delivered",
    "rejected",
    "unknown",
];
const terminalStateSet = new Set(exports.CODEX_TERMINAL_TASK_STATES);
function isCodexTerminalTaskState(state) {
    return terminalStateSet.has(state);
}
