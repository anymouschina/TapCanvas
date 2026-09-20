import { fetchWithHttpDebugLog } from "../httpDebugLog";
import type { AppContext } from "../types";

/**
 * 远端媒体（图片/视频等二进制资产）抓取的确定性重试策略。
 *
 * 为什么必须是通用能力而不是某个调用点的补丁：媒体资产一旦被供应商受理并物化，
 * 它就是已存在的真实事实。一次 TLS 握手超时、连接重置，或对象存储/CDN 对新写入
 * 对象返回的瞬时 404，都会让整条工作流在「资产其实可用」的情况下失败。
 *
 * 这不是兜底降级或掩盖问题：同一 URL、同一语义的重复请求不产生新的副作用，
 * 属于动作内的确定性重试；全部尝试耗尽后仍然如实失败，并保留逐次失败证据。
 */
export const REMOTE_MEDIA_FETCH_ATTEMPTS = 3;
export const REMOTE_MEDIA_FETCH_RETRY_DELAYS_MS = [1_000, 3_000] as const;

export type RemoteMediaFetchFailure = Readonly<{
	attempt: number;
	attempts: number;
	delayMs: number | null;
	httpStatus: number | null;
	reason: string;
}>;

export type RemoteMediaFetchOutcome<T> =
	| Readonly<{ ok: true; value: T; attempts: number; elapsedMs: number }>
	| Readonly<{
			ok: false;
			error: unknown;
			attempts: number;
			elapsedMs: number;
			httpStatus: number | null;
			reason: string;
	  }>;

/**
 * 由 `attempt` 回调抛出以声明「本次失败是瞬时的、可重试的」。
 * 没有 httpStatus 的传输层错误（TLS/连接重置/DNS）默认也可重试。
 */
export class RetryableRemoteMediaError extends Error {
	constructor(
		message: string,
		readonly httpStatus: number | null = null,
	) {
		super(message);
		this.name = "RetryableRemoteMediaError";
	}
}

/** 408/425/429 与 5xx 是明确的瞬时服务端状态；404 覆盖对象存储/CDN 的写后读可见性窗口。 */
export function isRetryableRemoteMediaStatus(status: number): boolean {
	return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function remoteMediaRetryDelayMs(attempt: number): number {
	const index = Math.max(0, Math.min(attempt - 1, REMOTE_MEDIA_FETCH_RETRY_DELAYS_MS.length - 1));
	return REMOTE_MEDIA_FETCH_RETRY_DELAYS_MS[index] ?? REMOTE_MEDIA_FETCH_RETRY_DELAYS_MS[0];
}

export function remoteMediaHttpStatus(error: unknown): number | null {
	return error instanceof RetryableRemoteMediaError ? error.httpStatus : null;
}

function remoteMediaReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 日志里只保留可定位的资源标识，不写出可能带签名的完整 URL。 */
export function sanitizeRemoteMediaUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return "[unparsable-url]";
	}
}

/**
 * 以同一组输入重试一次远端媒体抓取。`attempt` 负责真实的抓取与校验，
 * 并通过抛出 `RetryableRemoteMediaError`（或任意传输层错误）声明可重试失败。
 */
export async function runRemoteMediaFetch<T>(input: {
	c: AppContext;
	url: string;
	tag: string;
	event: string;
	attempt: () => Promise<T>;
	isRetryable?: (error: unknown) => boolean;
	onRetry?: (failure: RemoteMediaFetchFailure) => void;
	attempts?: number;
	delaysMs?: readonly number[];
}): Promise<RemoteMediaFetchOutcome<T>> {
	const attempts = input.attempts ?? REMOTE_MEDIA_FETCH_ATTEMPTS;
	const delays = input.delaysMs ?? REMOTE_MEDIA_FETCH_RETRY_DELAYS_MS;
	const delayForAttempt = (attempt: number): number => {
		const index = Math.max(0, Math.min(attempt - 1, delays.length - 1));
		return delays[index] ?? 0;
	};
	const isRetryable = input.isRetryable ?? (() => true);
	const startedAt = Date.now();
	let lastError: unknown = null;
	let completedAttempts = 0;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		completedAttempts = attempt;
		try {
			const value = await input.attempt();
			return { ok: true, value, attempts: attempt, elapsedMs: Date.now() - startedAt };
		} catch (error: unknown) {
			lastError = error;
			const httpStatus = remoteMediaHttpStatus(error);
			const willRetry = attempt < attempts && isRetryable(error);
			const failure: RemoteMediaFetchFailure = {
				attempt,
				attempts,
				delayMs: willRetry ? delayForAttempt(attempt) : null,
				httpStatus,
				reason: remoteMediaReason(error),
			};
			input.onRetry?.(failure);
			if (!willRetry) break;
			console.warn(
				JSON.stringify({
					event: input.event,
					tag: input.tag,
					url: sanitizeRemoteMediaUrl(input.url),
					...failure,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, failure.delayMs ?? 0));
		}
	}

	const httpStatus = remoteMediaHttpStatus(lastError);
	return {
		ok: false,
		error: lastError,
		attempts: completedAttempts,
		elapsedMs: Date.now() - startedAt,
		httpStatus,
		reason: remoteMediaReason(lastError),
	};
}

/** 复用的标准抓取：带 http debug 日志的 GET + 响应校验，校验失败标记为可重试。 */
export async function fetchRemoteMediaResponse(
	c: AppContext,
	input: Readonly<{
		url: string;
		tag: string;
		timeoutMs: number;
		accept?: (response: Response) => boolean;
		rejectMessage?: (response: Response) => string;
	}>,
): Promise<Response> {
	const response = await fetchWithHttpDebugLog(
		c,
		input.url,
		{ signal: AbortSignal.timeout(input.timeoutMs) },
		{ tag: input.tag },
	);
	if (!response.ok) {
		throw new RetryableRemoteMediaError(`HTTP ${response.status}`, response.status);
	}
	if (input.accept && !input.accept(response)) {
		throw new RetryableRemoteMediaError(
			input.rejectMessage ? input.rejectMessage(response) : `Unexpected response for ${input.url}`,
			response.status,
		);
	}
	return response;
}
