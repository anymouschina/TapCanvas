export type SseEventMessage = {
	event: string;
	data: string;
	id: string;
	retry: number | null;
};

type SseParserState = {
	dataLines: string[];
	event: string;
	id: string;
	retry: number | null;
};

function createEmptyState(): SseParserState {
	return {
		dataLines: [],
		event: "",
		id: "",
		retry: null,
	};
}

function normalizeSseFieldValue(raw: string): string {
	return raw.startsWith(" ") ? raw.slice(1) : raw;
}

export function createSseEventParser(): {
	push: (chunk: string) => SseEventMessage[];
	finish: () => SseEventMessage[];
} {
	let buffer = "";
	let state = createEmptyState();

	const flushEvent = (): SseEventMessage[] => {
		if (
			!state.dataLines.length &&
			!state.event &&
			!state.id &&
			state.retry === null
		) {
			return [];
		}
		const event: SseEventMessage = {
			event: state.event || "message",
			data: state.dataLines.join("\n"),
			id: state.id,
			retry: state.retry,
		};
		state = createEmptyState();
		return [event];
	};

	const consumeLine = (rawLine: string): SseEventMessage[] => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line) return flushEvent();
		if (line.startsWith(":")) return [];

		const separatorIndex = line.indexOf(":");
		const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
		const value =
			separatorIndex >= 0
				? normalizeSseFieldValue(line.slice(separatorIndex + 1))
				: "";

		if (field === "data") {
			state.dataLines.push(value);
			return [];
		}
		if (field === "event") {
			state.event = value;
			return [];
		}
		if (field === "id") {
			if (!value.includes("\u0000")) state.id = value;
			return [];
		}
		if (field === "retry") {
			const numeric = Number(value);
			if (Number.isInteger(numeric) && numeric >= 0) {
				state.retry = numeric;
			}
			return [];
		}
		return [];
	};

	const push = (chunk: string): SseEventMessage[] => {
		if (!chunk) return [];
		buffer += chunk;
		const out: SseEventMessage[] = [];
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			out.push(...consumeLine(line));
			newlineIndex = buffer.indexOf("\n");
		}
		return out;
	};

	const finish = (): SseEventMessage[] => {
		const out: SseEventMessage[] = [];
		if (buffer) {
			out.push(...consumeLine(buffer));
			buffer = "";
		}
		out.push(...flushEvent());
		return out;
	};

	return { push, finish };
}
