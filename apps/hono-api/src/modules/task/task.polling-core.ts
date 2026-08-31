export type PollDecision = "success" | "failure" | "continue";

export type PollUntilSettledResult<T> = {
	state: "success" | "failure" | "timeout";
	value: T | null;
	attempts: number;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntilSettled<T>(input: {
	timeoutMs: number;
	intervalMs: number;
	pollOnce: () => Promise<T>;
	evaluate: (value: T) => PollDecision;
}): Promise<PollUntilSettledResult<T>> {
	const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));
	const intervalMs = Math.max(1, Math.floor(input.intervalMs));
	const deadline = Date.now() + timeoutMs;
	let attempts = 0;
	let lastValue: T | null = null;

	while (Date.now() < deadline) {
		attempts += 1;
		const value = await input.pollOnce();
		lastValue = value;
		const decision = input.evaluate(value);
		if (decision === "success") {
			return { state: "success", value, attempts };
		}
		if (decision === "failure") {
			return { state: "failure", value, attempts };
		}
		if (Date.now() >= deadline) break;
		await sleep(intervalMs);
	}

	return {
		state: "timeout",
		value: lastValue,
		attempts,
	};
}
