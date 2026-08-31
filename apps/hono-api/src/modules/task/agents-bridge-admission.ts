import { AppError } from "../../middleware/error";

export type AgentsBridgeAdmissionLimits = Readonly<{
	maxConcurrency: number;
	maxQueueDepth: number;
	maxPerUser: number;
}>;

export type AgentsBridgeAdmissionPriority = "production_deadline" | "standard";

type AdmissionWaiter = Readonly<{
	userId: string | null;
	priority: AgentsBridgeAdmissionPriority;
	limits: AgentsBridgeAdmissionLimits;
	signal?: AbortSignal;
	resolve: () => void;
	reject: (error: Error) => void;
	onAbort: () => void;
}>;

function priorityRank(priority: AgentsBridgeAdmissionPriority): number {
	return priority === "production_deadline" ? 1 : 0;
}

function toAbortError(signal?: AbortSignal): Error {
	const reason = signal?.reason;
	if (reason instanceof Error) return reason;
	const text = typeof reason === "string" ? reason.trim() : "";
	return new Error(text || "agents_bridge_request_aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw toAbortError(signal);
}

/**
 * One process-wide capacity pool for every Agents bridge request. A workflow may
 * contain many concurrent Agent nodes/items, but none of them may turn a local
 * capacity boundary into a business failure: admitted work waits for a slot.
 */
export class AgentsBridgeAdmissionScheduler {
	private active = 0;
	private readonly perUser = new Map<string, number>();
	private readonly waiters: AdmissionWaiter[] = [];

	private activeForUser(userId: string | null): number {
		return userId ? this.perUser.get(userId) ?? 0 : 0;
	}

	private canReserve(userId: string | null, limits: AgentsBridgeAdmissionLimits): boolean {
		return this.active < limits.maxConcurrency
			&& (!userId || this.activeForUser(userId) < limits.maxPerUser);
	}

	private reserve(userId: string | null): void {
		this.active += 1;
		if (userId) this.perUser.set(userId, this.activeForUser(userId) + 1);
	}

	private release(userId: string | null): void {
		this.active = Math.max(0, this.active - 1);
		if (userId) {
			const next = this.activeForUser(userId) - 1;
			if (next <= 0) this.perUser.delete(userId);
			else this.perUser.set(userId, next);
		}
		this.drain();
	}

	private removeWaiter(waiter: AdmissionWaiter): void {
		const index = this.waiters.indexOf(waiter);
		if (index >= 0) this.waiters.splice(index, 1);
	}

	private drain(): void {
		while (this.waiters.length > 0) {
			const abortedIndex = this.waiters.findIndex((waiter) => waiter.signal?.aborted === true);
			if (abortedIndex >= 0) {
				const [aborted] = this.waiters.splice(abortedIndex, 1);
				if (!aborted) continue;
				aborted.signal?.removeEventListener("abort", aborted.onAbort);
				aborted.reject(toAbortError(aborted.signal));
				continue;
			}
			const eligibleIndexes = this.waiters.flatMap((waiter, index) => (
				this.canReserve(waiter.userId, waiter.limits) ? [index] : []
			));
			const eligibleIndex = eligibleIndexes.reduce((selected, candidate) => {
				if (selected < 0) return candidate;
				return priorityRank(this.waiters[candidate]?.priority ?? "standard")
					> priorityRank(this.waiters[selected]?.priority ?? "standard")
					? candidate
					: selected;
			}, -1);
			if (eligibleIndex < 0) return;
			const [waiter] = this.waiters.splice(eligibleIndex, 1);
			if (!waiter) continue;
			waiter.signal?.removeEventListener("abort", waiter.onAbort);
			this.reserve(waiter.userId);
			waiter.resolve();
		}
	}

	private async acquire(input: Readonly<{
		userId: string | null;
		priority: AgentsBridgeAdmissionPriority;
		limits: AgentsBridgeAdmissionLimits;
		signal?: AbortSignal;
	}>): Promise<void> {
		throwIfAborted(input.signal);
		if (this.canReserve(input.userId, input.limits)) {
			this.reserve(input.userId);
			return;
		}
		if (this.waiters.length >= input.limits.maxQueueDepth) {
			throw new AppError(
				`AI 对话服务繁忙（队列已满）：当前 ${this.active} 个请求正在处理，${this.waiters.length} 个在排队，请稍后再试`,
				{
					status: 429,
					code: "agents_bridge_queue_full",
					details: {
						active: this.active,
						queued: this.waiters.length,
						maxConcurrency: input.limits.maxConcurrency,
						maxQueueDepth: input.limits.maxQueueDepth,
						maxPerUser: input.limits.maxPerUser,
					},
				},
			);
		}
		await new Promise<void>((resolve, reject) => {
			let waiter: AdmissionWaiter;
			const onAbort = () => {
				this.removeWaiter(waiter);
				input.signal?.removeEventListener("abort", onAbort);
				reject(toAbortError(input.signal));
				this.drain();
			};
			waiter = {
				userId: input.userId,
				priority: input.priority,
				limits: input.limits,
				...(input.signal ? { signal: input.signal } : {}),
				resolve,
				reject,
				onAbort,
			};
			this.waiters.push(waiter);
			input.signal?.addEventListener("abort", onAbort, { once: true });
			this.drain();
		});
	}

	async run<T>(input: Readonly<{
		userId?: string;
		priority?: AgentsBridgeAdmissionPriority;
		limits: AgentsBridgeAdmissionLimits;
		signal?: AbortSignal;
		task: () => Promise<T>;
	}>): Promise<T> {
		const userId = input.userId?.trim() || null;
		await this.acquire({
			userId,
			priority: input.priority ?? "standard",
			limits: input.limits,
			...(input.signal ? { signal: input.signal } : {}),
		});
		try {
			throwIfAborted(input.signal);
			return await input.task();
		} finally {
			this.release(userId);
		}
	}
}
