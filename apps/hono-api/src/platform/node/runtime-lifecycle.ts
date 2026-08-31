export type RuntimeLifecycleStatus = {
	ready: boolean;
	draining: boolean;
	updatedAt: string;
	reason: string | null;
};

let status: RuntimeLifecycleStatus = {
	ready: false,
	draining: false,
	updatedAt: new Date().toISOString(),
	reason: "startup",
};

function update(next: Pick<RuntimeLifecycleStatus, "ready" | "draining" | "reason">): void {
	status = { ...next, updatedAt: new Date().toISOString() };
}

export function markRuntimeReady(): void {
	update({ ready: true, draining: false, reason: null });
}

export function markRuntimeDraining(reason: string): void {
	update({ ready: false, draining: true, reason });
}

export function getRuntimeLifecycleStatus(): RuntimeLifecycleStatus {
	return { ...status };
}
