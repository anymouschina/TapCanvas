import type { ToolEventMessageDto } from "./ai.schemas";

export type ToolEventSubscriber = {
	push: (event: ToolEventMessageDto) => void;
};

const toolEventSubscribers = new Map<string, Set<ToolEventSubscriber>>();

export function addToolEventSubscriber(
	userId: string,
	subscriber: ToolEventSubscriber,
) {
	const existing = toolEventSubscribers.get(userId);
	if (existing) {
		existing.add(subscriber);
	} else {
		toolEventSubscribers.set(userId, new Set([subscriber]));
	}
}

export function removeToolEventSubscriber(
	userId: string,
	subscriber: ToolEventSubscriber,
) {
	const existing = toolEventSubscribers.get(userId);
	if (!existing) return;
	existing.delete(subscriber);
	if (existing.size === 0) {
		deleteToolEventSubscribers(userId);
	}
}

function deleteToolEventSubscribers(userId: string) {
	toolEventSubscribers.delete(userId);
}

export function publishToolEvent(
	userId: string,
	event: ToolEventMessageDto,
) {
	const subscribers = toolEventSubscribers.get(userId);
	if (!subscribers || subscribers.size === 0) return;
	for (const sub of subscribers) {
		try {
			sub.push(event);
		} catch (err) {
			console.warn("[tool-events] subscriber push failed", err);
		}
	}
}

