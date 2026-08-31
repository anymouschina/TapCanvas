import { AppError } from "../../middleware/error";
import type {
	AgentsChatTurnInterruptReceipt,
	AgentsChatTurnStatusSnapshot,
} from "./task.agents-chat-runtime";
import { isAgentsChatRuntimeOutcomeUnknown } from "./task.agents-chat-runtime";

export type PublicChatInterruptError = Readonly<{
	code: string;
	message: string;
	details?: unknown;
}>;

export type PublicChatInterruptCompositeReceipt = Readonly<{
	ok: true;
	interrupted: boolean;
	fullyInterrupted: boolean;
	sessionKey: string;
	turnId: string;
	localTransport:
		| Readonly<{ status: "interrupted" | "not_running" }>
		| Readonly<{ status: "failed"; error: PublicChatInterruptError }>;
	runtime:
		| Readonly<{ status: "interrupted" | "already_inactive"; turnId: string | null }>
		| Readonly<{ status: "unknown" | "failed"; error: PublicChatInterruptError }>;
	continuations:
		| Readonly<{ status: "cancelled" | "none"; cancelledCount: number }>
		| Readonly<{ status: "failed"; cancelledCount: 0; error: PublicChatInterruptError }>;
	status: AgentsChatTurnStatusSnapshot | null;
}>;

export type PublicChatInterruptDependencies = Readonly<{
	interruptLocalTransport: () => boolean;
	interruptRuntime: () => Promise<AgentsChatTurnInterruptReceipt>;
	cancelContinuations: () => Promise<number>;
}>;

function toPublicChatInterruptError(error: unknown, fallbackCode: string): PublicChatInterruptError {
	if (error instanceof AppError) {
		return {
			code: error.code,
			message: error.message,
			...(typeof error.details === "undefined" ? {} : { details: error.details }),
		};
	}
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		return {
			code: typeof record.code === "string" && record.code.trim() ? record.code.trim() : fallbackCode,
			message: typeof record.message === "string" && record.message.trim()
				? record.message.trim()
				: "Unknown interruption failure",
			...(typeof record.details === "undefined" ? {} : { details: record.details }),
		};
	}
	return {
		code: fallbackCode,
		message: error instanceof Error ? error.message : String(error),
	};
}

/** Coordinates the transport, runtime and continuation cancellation planes. */
export async function coordinatePublicChatInterrupt(input: Readonly<{
	sessionKey: string;
	turnId: string;
	dependencies: PublicChatInterruptDependencies;
}>): Promise<PublicChatInterruptCompositeReceipt> {
	let localTransport: PublicChatInterruptCompositeReceipt["localTransport"];
	try {
		localTransport = input.dependencies.interruptLocalTransport()
			? { status: "interrupted" }
			: { status: "not_running" };
	} catch (error: unknown) {
		localTransport = {
			status: "failed",
			error: toPublicChatInterruptError(error, "chat_interrupt_local_transport_failed"),
		};
	}

	const runtimeAttempt = async () => {
		try {
			const receipt = await input.dependencies.interruptRuntime();
			return {
				receipt: {
					status: receipt.interrupted ? "interrupted" as const : "already_inactive" as const,
					turnId: receipt.turnId,
				},
				status: receipt.status,
				interrupted: receipt.interrupted,
			};
		} catch (error: unknown) {
			return {
				receipt: {
					status: isAgentsChatRuntimeOutcomeUnknown(error) ? "unknown" as const : "failed" as const,
					error: toPublicChatInterruptError(error, "chat_interrupt_runtime_failed"),
				},
				status: null,
				interrupted: false,
			};
		}
	};

	const continuationAttempt = async () => {
		try {
			const cancelledCount = await input.dependencies.cancelContinuations();
			return {
				receipt: {
					status: cancelledCount > 0 ? "cancelled" as const : "none" as const,
					cancelledCount,
				},
				interrupted: cancelledCount > 0,
			};
		} catch (error: unknown) {
			return {
				receipt: {
					status: "failed" as const,
					cancelledCount: 0 as const,
					error: toPublicChatInterruptError(error, "chat_interrupt_continuation_cancel_failed"),
				},
				interrupted: false,
			};
		}
	};

	const [runtimeResult, continuationResult] = await Promise.all([
		runtimeAttempt(),
		continuationAttempt(),
	]);
	const interrupted = localTransport.status === "interrupted"
		|| runtimeResult.interrupted
		|| continuationResult.interrupted;
	const fullyInterrupted = localTransport.status !== "failed"
		&& runtimeResult.receipt.status !== "failed"
		&& runtimeResult.receipt.status !== "unknown"
		&& continuationResult.receipt.status !== "failed";

	return {
		ok: true,
		interrupted,
		fullyInterrupted,
		sessionKey: input.sessionKey,
		turnId: input.turnId,
		localTransport,
		runtime: runtimeResult.receipt,
		continuations: continuationResult.receipt,
		status: runtimeResult.status,
	};
}
