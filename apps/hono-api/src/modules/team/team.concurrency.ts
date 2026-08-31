export const RESERVATION_SUBMISSION_GRACE_MS = 10 * 60_000;

export type CreditReservationEvidence = {
	taskId: string;
	createdAt: string;
};

export type TaskResultEvidence = {
	taskId: string;
	status: string;
};

export type ActiveReservationAssessment = {
	activeTaskIds: string[];
	orphanedTaskIds: string[];
};

const TERMINAL_TASK_RESULT_STATUSES = new Set(["succeeded", "failed"]);

function parseCreatedAt(value: string): number | null {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export function assessActiveCreditReservations(input: {
	reservations: CreditReservationEvidence[];
	ledgerTerminalTaskIds: ReadonlySet<string>;
	taskResults: TaskResultEvidence[];
	vendorRefTaskIds: ReadonlySet<string>;
	nowMs: number;
	graceMs?: number;
}): ActiveReservationAssessment {
	const graceMs = Math.max(0, Math.floor(input.graceMs ?? RESERVATION_SUBMISSION_GRACE_MS));
	const taskResultStatusByTaskId = new Map(
		input.taskResults.map((row) => [row.taskId, row.status.trim().toLowerCase()]),
	);
	const reservationByTaskId = new Map(
		input.reservations.map((reservation) => [reservation.taskId, reservation]),
	);
	const activeTaskIds: string[] = [];
	const orphanedTaskIds: string[] = [];

	for (const reservation of reservationByTaskId.values()) {
		const taskId = reservation.taskId;
		if (input.ledgerTerminalTaskIds.has(taskId)) continue;

		const taskResultStatus = taskResultStatusByTaskId.get(taskId);
		if (taskResultStatus && TERMINAL_TASK_RESULT_STATUSES.has(taskResultStatus)) continue;
		if (taskResultStatus || input.vendorRefTaskIds.has(taskId)) {
			activeTaskIds.push(taskId);
			continue;
		}

		const createdAtMs = parseCreatedAt(reservation.createdAt);
		if (createdAtMs === null || input.nowMs - createdAtMs < graceMs) {
			activeTaskIds.push(taskId);
			continue;
		}
		orphanedTaskIds.push(taskId);
	}

	return { activeTaskIds, orphanedTaskIds };
}
