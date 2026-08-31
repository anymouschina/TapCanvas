import crypto from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
	StoryFactsLedgerSchema,
	type StoryFactOperation,
	type StoryFactRecord,
	type StoryFactsCommitRecord,
	type StoryFactsLedger,
	type StoryPoint,
	type VerifiedStoryFactSource,
} from "./story-facts.schemas";
import {
	assertStoryFactDisclosureWindow,
	compareStoryPoints,
	isStoryFactActiveAt,
	storyFactDisclosureEquals,
} from "./story-facts.timeline";

export { compareStoryPoints, isStoryFactActiveAt } from "./story-facts.timeline";

export type StoryFactsStoreErrorCode =
	| "story_facts_read_failed"
	| "story_facts_parse_failed"
	| "story_facts_invalid"
	| "story_facts_identity_mismatch"
	| "story_facts_lock_timeout"
	| "story_facts_lock_failed"
	| "story_facts_write_failed"
	| "story_facts_revision_conflict"
	| "story_facts_commit_id_conflict"
	| "story_fact_duplicate"
	| "story_fact_not_found"
	| "story_fact_already_closed"
	| "story_fact_interval_invalid"
	| "story_fact_status_conflict"
	| "story_fact_status_transition_invalid"
	| "story_fact_disclosure_conflict"
	| "story_fact_disclosure_window_invalid"
	| "story_facts_capacity_exceeded";

export class StoryFactsStoreError extends Error {
	readonly code: StoryFactsStoreErrorCode;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		message: string,
		input: {
			code: StoryFactsStoreErrorCode;
			cause?: unknown;
			details?: Readonly<Record<string, unknown>>;
		},
	) {
		super(message, input.cause === undefined ? undefined : { cause: input.cause });
		this.name = "StoryFactsStoreError";
		this.code = input.code;
		this.details = input.details ?? {};
	}
}

export type StoryFactsCommitResult = {
	ledgerRevision: number;
	commitRevision: number;
	idempotent: boolean;
	addedFactIds: string[];
	closedFactIds: string[];
	statusChangedFactIds: string[];
	disclosureChangedFactIds: string[];
};

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 10 * 60_000;
const MAX_FACTS = 20_000;
const MAX_COMMITS = 20_000;
const processQueues = new Map<string, Promise<void>>();

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readNodeErrorCode(error: unknown): string {
	if (!error || typeof error !== "object" || Array.isArray(error)) return "";
	const code = (error as Record<string, unknown>).code;
	return typeof code === "string" ? code : "";
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createEmptyLedger(projectId: string, bookId: string): StoryFactsLedger {
	return {
		schemaVersion: 2,
		projectId,
		bookId,
		revision: 0,
		facts: [],
		commits: [],
		updatedAt: null,
	};
}

function assertLedgerIdentity(input: {
	filePath: string;
	ledger: StoryFactsLedger;
	projectId: string;
	bookId: string;
}): void {
	if (input.ledger.projectId === input.projectId && input.ledger.bookId === input.bookId) return;
	throw new StoryFactsStoreError("Story facts ledger identity does not match the requested book", {
		code: "story_facts_identity_mismatch",
		details: {
			filePath: input.filePath,
			expectedProjectId: input.projectId,
			actualProjectId: input.ledger.projectId,
			expectedBookId: input.bookId,
			actualBookId: input.ledger.bookId,
		},
	});
}

function parseLedger(input: {
	filePath: string;
	raw: string;
	projectId: string;
	bookId: string;
}): StoryFactsLedger {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.raw) as unknown;
	} catch (error) {
		throw new StoryFactsStoreError("Story facts ledger JSON parsing failed", {
			code: "story_facts_parse_failed",
			cause: error,
			details: {
				filePath: input.filePath,
				reason: describeError(error),
				bytes: Buffer.byteLength(input.raw),
			},
		});
	}
	const validated = StoryFactsLedgerSchema.safeParse(parsed);
	if (!validated.success) {
		throw new StoryFactsStoreError("Story facts ledger has an invalid structure", {
			code: "story_facts_invalid",
			details: {
				filePath: input.filePath,
				issues: validated.error.issues,
			},
		});
	}
	assertLedgerIdentity({
		filePath: input.filePath,
		ledger: validated.data,
		projectId: input.projectId,
		bookId: input.bookId,
	});
	return validated.data;
}

async function readLedgerUnlocked(input: {
	filePath: string;
	projectId: string;
	bookId: string;
}): Promise<StoryFactsLedger> {
	let raw: string;
	try {
		raw = await fs.readFile(input.filePath, "utf8");
	} catch (error) {
		if (readNodeErrorCode(error) === "ENOENT") {
			return createEmptyLedger(input.projectId, input.bookId);
		}
		throw new StoryFactsStoreError("Story facts ledger read failed", {
			code: "story_facts_read_failed",
			cause: error,
			details: {
				filePath: input.filePath,
				nodeCode: readNodeErrorCode(error),
				reason: describeError(error),
			},
		});
	}
	return parseLedger({ ...input, raw });
}

async function acquireFileLock(filePath: string): Promise<() => Promise<void>> {
	const lockPath = `${filePath}.lock`;
	const startedAt = Date.now();
	for (;;) {
		try {
			const handle = await fs.open(lockPath, "wx");
			try {
				await handle.writeFile(
					JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
					"utf8",
				);
				await handle.sync();
			} finally {
				await handle.close();
			}
			return async () => {
				try {
					await fs.unlink(lockPath);
				} catch (error) {
					throw new StoryFactsStoreError("Story facts lock release failed", {
						code: "story_facts_lock_failed",
						cause: error,
						details: {
							filePath,
							lockPath,
							nodeCode: readNodeErrorCode(error),
							reason: describeError(error),
						},
					});
				}
			};
		} catch (error) {
			if (readNodeErrorCode(error) !== "EEXIST") {
				throw new StoryFactsStoreError("Story facts lock acquisition failed", {
					code: "story_facts_lock_failed",
					cause: error,
					details: {
						filePath,
						lockPath,
						nodeCode: readNodeErrorCode(error),
						reason: describeError(error),
					},
				});
			}
			const stat = await fs.stat(lockPath).catch(() => null);
			if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
				console.warn("[story-facts-store] removing stale lock", {
					filePath,
					lockPath,
					lockAgeMs: Date.now() - stat.mtimeMs,
				});
				await fs.unlink(lockPath).catch(() => undefined);
				continue;
			}
			if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
				throw new StoryFactsStoreError("Timed out waiting for story facts lock", {
					code: "story_facts_lock_timeout",
					details: { filePath, lockPath, timeoutMs: LOCK_TIMEOUT_MS },
				});
			}
			await wait(LOCK_RETRY_MS);
		}
	}
}

async function withProcessQueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
	const previous = processQueues.get(filePath) ?? Promise.resolve();
	let releaseQueue: () => void = () => undefined;
	const current = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});
	const tail = previous.then(() => current);
	processQueues.set(filePath, tail);
	await previous;
	try {
		return await operation();
	} finally {
		releaseQueue();
		if (processQueues.get(filePath) === tail) processQueues.delete(filePath);
	}
}

async function withStoryFactsLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
	return withProcessQueue(filePath, async () => {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const releaseFileLock = await acquireFileLock(filePath);
		let operationError: unknown;
		try {
			return await operation();
		} catch (error) {
			operationError = error;
			throw error;
		} finally {
			try {
				await releaseFileLock();
			} catch (releaseError) {
				if (operationError === undefined) throw releaseError;
				console.error("[story-facts-store] lock release also failed", {
					filePath,
					reason: describeError(releaseError),
				});
			}
		}
	});
}

async function writeLedgerUnlocked(filePath: string, ledger: StoryFactsLedger): Promise<void> {
	const validated = StoryFactsLedgerSchema.parse(ledger);
	const serialized = `${JSON.stringify(validated, null, 2)}\n`;
	const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
	let handle: FileHandle | null = null;
	try {
		handle = await fs.open(tempPath, "wx");
		await handle.writeFile(serialized, "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		const tempRaw = await fs.readFile(tempPath, "utf8");
		parseLedger({
			filePath: tempPath,
			raw: tempRaw,
			projectId: validated.projectId,
			bookId: validated.bookId,
		});
		await fs.rename(tempPath, filePath);
		const persistedRaw = await fs.readFile(filePath, "utf8");
		parseLedger({
			filePath,
			raw: persistedRaw,
			projectId: validated.projectId,
			bookId: validated.bookId,
		});
	} catch (error) {
		throw error instanceof StoryFactsStoreError
			? error
			: new StoryFactsStoreError("Story facts ledger atomic write failed", {
					code: "story_facts_write_failed",
					cause: error,
					details: {
						filePath,
						tempPath,
						nodeCode: readNodeErrorCode(error),
						reason: describeError(error),
					},
			  });
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		await fs.unlink(tempPath).catch(() => undefined);
	}
}

export function selectStoryFacts(input: {
	ledger: StoryFactsLedger;
	at?: StoryPoint;
	statuses?: ReadonlySet<string>;
	subjectKeys?: ReadonlySet<string>;
	includeClosed?: boolean;
}): StoryFactRecord[] {
	return input.ledger.facts.filter((fact) => {
		if (input.statuses && !input.statuses.has(fact.status)) return false;
		if (input.subjectKeys && !input.subjectKeys.has(fact.subject.key)) return false;
		if (input.at) return isStoryFactActiveAt(fact, input.at);
		if (input.includeClosed === true) return true;
		return fact.validUntil === null;
	});
}

function requestHash(input: {
	source: VerifiedStoryFactSource;
	operations: StoryFactOperation[];
	note?: string;
}): string {
	const stableSource = {
		kind: input.source.kind,
		projectId: input.source.projectId,
		bookId: input.source.bookId,
		...(typeof input.source.chapter === "number" ? { chapter: input.source.chapter } : {}),
		...(input.source.chapterId ? { chapterId: input.source.chapterId } : {}),
		...(input.source.nodeId ? { nodeId: input.source.nodeId } : {}),
		...(input.source.field ? { field: input.source.field } : {}),
		...(input.source.fileName ? { fileName: input.source.fileName } : {}),
		contentSha256: input.source.contentSha256,
		contentChars: input.source.contentChars,
	};
	const requestPayload = {
		stableSource,
		operations: input.operations,
		...(input.note ? { note: input.note } : {}),
	};
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(requestPayload))
		.digest("hex");
}

function summarizeOperations(
	operations: StoryFactOperation[],
): Omit<StoryFactsCommitResult, "ledgerRevision" | "commitRevision" | "idempotent"> {
	const addedFactIds: string[] = [];
	const closedFactIds: string[] = [];
	const statusChangedFactIds: string[] = [];
	const disclosureChangedFactIds: string[] = [];
	for (const operation of operations) {
		if (operation.type === "add") addedFactIds.push(operation.factId);
		if (operation.type === "close") closedFactIds.push(operation.factId);
		if (operation.type === "set_status") statusChangedFactIds.push(operation.factId);
		if (operation.type === "set_disclosure") disclosureChangedFactIds.push(operation.factId);
	}
	return { addedFactIds, closedFactIds, statusChangedFactIds, disclosureChangedFactIds };
}

function assertStatusTransition(input: {
	factId: string;
	from: StoryFactRecord["status"];
	to: StoryFactRecord["status"];
}): void {
	const rank: Readonly<Record<StoryFactRecord["status"], number>> = {
		draft_choice: 0,
		inferred: 1,
		confirmed: 2,
	};
	if (input.from !== input.to && rank[input.to] > rank[input.from]) return;
	throw new StoryFactsStoreError("Story fact status transitions must be explicit upgrades", {
		code: "story_fact_status_transition_invalid",
		details: { factId: input.factId, from: input.from, to: input.to },
	});
}

function applyOperations(input: {
	current: StoryFactsLedger;
	nextRevision: number;
	nowIso: string;
	source: VerifiedStoryFactSource;
	operations: StoryFactOperation[];
}): StoryFactRecord[] {
	const facts = input.current.facts.map((fact) => structuredClone(fact));
	const indexById = new Map<string, number>();
	for (const [index, fact] of facts.entries()) indexById.set(fact.factId, index);

	for (const operation of input.operations) {
		if (operation.type === "add") {
			if (indexById.has(operation.factId)) {
				throw new StoryFactsStoreError("Story fact id already exists", {
					code: "story_fact_duplicate",
					details: { factId: operation.factId },
				});
			}
			try {
				assertStoryFactDisclosureWindow({
					factId: operation.factId,
					validFrom: operation.validFrom,
					disclosure: operation.disclosure,
				});
			} catch (error) {
				throw new StoryFactsStoreError("Story fact disclosure window is invalid", {
					code: "story_fact_disclosure_window_invalid",
					cause: error,
					details: {
						factId: operation.factId,
						validFrom: operation.validFrom,
						disclosure: operation.disclosure,
					},
				});
			}
			const fact: StoryFactRecord = {
				factId: operation.factId,
				subject: structuredClone(operation.subject),
				predicate: operation.predicate,
				value: structuredClone(operation.value),
				status: operation.status,
				validFrom: structuredClone(operation.validFrom),
				validUntil: null,
				disclosure: structuredClone(operation.disclosure),
				source: structuredClone(input.source),
				createdRevision: input.nextRevision,
				updatedRevision: input.nextRevision,
				createdAt: input.nowIso,
				updatedAt: input.nowIso,
			};
			indexById.set(fact.factId, facts.length);
			facts.push(fact);
			continue;
		}

		const factIndex = indexById.get(operation.factId);
		if (factIndex === undefined) {
			throw new StoryFactsStoreError("Story fact does not exist", {
				code: "story_fact_not_found",
				details: { factId: operation.factId, operation: operation.type },
			});
		}
		const fact = facts[factIndex];
		if (!fact) {
			throw new StoryFactsStoreError("Story fact index is inconsistent", {
				code: "story_facts_invalid",
				details: { factId: operation.factId, factIndex },
			});
		}
		if (operation.type === "close") {
			if (fact.validUntil !== null) {
				throw new StoryFactsStoreError("Story fact is already closed", {
					code: "story_fact_already_closed",
					details: { factId: operation.factId, validUntil: fact.validUntil },
				});
			}
			if (compareStoryPoints(operation.validUntil, fact.validFrom) <= 0) {
				throw new StoryFactsStoreError("Story fact validUntil must be later than validFrom", {
					code: "story_fact_interval_invalid",
					details: {
						factId: operation.factId,
						validFrom: fact.validFrom,
						validUntil: operation.validUntil,
					},
				});
			}
			fact.validUntil = structuredClone(operation.validUntil);
			fact.updatedRevision = input.nextRevision;
			fact.updatedAt = input.nowIso;
			continue;
		}

		if (operation.type === "set_disclosure") {
			if (!storyFactDisclosureEquals(fact.disclosure, operation.expectedDisclosure)) {
				throw new StoryFactsStoreError("Story fact disclosure changed concurrently", {
					code: "story_fact_disclosure_conflict",
					details: {
						factId: operation.factId,
						expectedDisclosure: operation.expectedDisclosure,
						actualDisclosure: fact.disclosure,
					},
				});
			}
			try {
				assertStoryFactDisclosureWindow({
					factId: operation.factId,
					validFrom: fact.validFrom,
					disclosure: operation.disclosure,
				});
			} catch (error) {
				throw new StoryFactsStoreError("Story fact disclosure window is invalid", {
					code: "story_fact_disclosure_window_invalid",
					cause: error,
					details: {
						factId: operation.factId,
						validFrom: fact.validFrom,
						disclosure: operation.disclosure,
					},
				});
			}
			fact.disclosure = structuredClone(operation.disclosure);
			fact.updatedRevision = input.nextRevision;
			fact.updatedAt = input.nowIso;
			continue;
		}

		if (fact.status !== operation.expectedStatus) {
			throw new StoryFactsStoreError("Story fact status changed concurrently", {
				code: "story_fact_status_conflict",
				details: {
					factId: operation.factId,
					expectedStatus: operation.expectedStatus,
					actualStatus: fact.status,
				},
			});
		}
		assertStatusTransition({ factId: operation.factId, from: fact.status, to: operation.status });
		fact.status = operation.status;
		fact.updatedRevision = input.nextRevision;
		fact.updatedAt = input.nowIso;
	}

	if (facts.length > MAX_FACTS) {
		throw new StoryFactsStoreError("Story facts ledger reached its explicit fact capacity", {
			code: "story_facts_capacity_exceeded",
			details: { maxFacts: MAX_FACTS, nextFactCount: facts.length },
		});
	}
	return facts.sort((left, right) => {
		const pointOrder = compareStoryPoints(left.validFrom, right.validFrom);
		if (pointOrder !== 0) return pointOrder;
		const subjectOrder = left.subject.key.localeCompare(right.subject.key);
		if (subjectOrder !== 0) return subjectOrder;
		const predicateOrder = left.predicate.localeCompare(right.predicate);
		if (predicateOrder !== 0) return predicateOrder;
		return left.factId.localeCompare(right.factId);
	});
}

export async function readStoryFactsLedger(input: {
	filePath: string;
	projectId: string;
	bookId: string;
}): Promise<StoryFactsLedger> {
	return readLedgerUnlocked(input);
}

export async function commitStoryFacts(input: {
	filePath: string;
	projectId: string;
	bookId: string;
	actorId: string;
	commitId: string;
	expectedRevision: number;
	source: VerifiedStoryFactSource;
	operations: StoryFactOperation[];
	note?: string;
}): Promise<{ ledger: StoryFactsLedger; result: StoryFactsCommitResult }> {
	return withStoryFactsLock(input.filePath, async () => {
		const current = await readLedgerUnlocked(input);
		if (input.source.projectId !== input.projectId || input.source.bookId !== input.bookId) {
			throw new StoryFactsStoreError("Story fact source identity does not match the target ledger", {
				code: "story_facts_identity_mismatch",
				details: {
					expectedProjectId: input.projectId,
					actualProjectId: input.source.projectId,
					expectedBookId: input.bookId,
					actualBookId: input.source.bookId,
				},
			});
		}
		const normalizedNote = input.note?.trim() || undefined;
		const operationSummary = summarizeOperations(input.operations);
		const requestSha256 = requestHash({
			source: input.source,
			operations: input.operations,
			...(normalizedNote ? { note: normalizedNote } : {}),
		});
		const priorCommit = current.commits.find((commit) => commit.commitId === input.commitId);
		if (priorCommit) {
			if (priorCommit.requestSha256 !== requestSha256) {
				throw new StoryFactsStoreError("Story facts commitId was reused for a different request", {
					code: "story_facts_commit_id_conflict",
					details: {
						commitId: input.commitId,
						previousRequestSha256: priorCommit.requestSha256,
						requestSha256,
					},
				});
			}
				return {
					ledger: current,
					result: {
						ledgerRevision: current.revision,
						commitRevision: priorCommit.revision,
						idempotent: true,
						...summarizeOperations(priorCommit.operations),
				},
			};
		}
		if (current.revision !== input.expectedRevision) {
			throw new StoryFactsStoreError("Story facts revision conflict", {
				code: "story_facts_revision_conflict",
				details: {
					expectedRevision: input.expectedRevision,
					actualRevision: current.revision,
				},
			});
		}
		if (current.commits.length >= MAX_COMMITS) {
			throw new StoryFactsStoreError("Story facts ledger reached its explicit commit capacity", {
				code: "story_facts_capacity_exceeded",
				details: { maxCommits: MAX_COMMITS, currentCommitCount: current.commits.length },
			});
		}

		const nowIso = new Date().toISOString();
		const nextRevision = current.revision + 1;
		const facts = applyOperations({
			current,
			nextRevision,
			nowIso,
			source: input.source,
			operations: input.operations,
		});
		const commit: StoryFactsCommitRecord = {
			commitId: input.commitId,
			requestSha256,
			baseRevision: current.revision,
			revision: nextRevision,
			actorId: input.actorId,
			source: structuredClone(input.source),
			operations: structuredClone(input.operations),
			...(normalizedNote ? { note: normalizedNote } : {}),
			createdAt: nowIso,
		};
		const ledger: StoryFactsLedger = {
			...current,
			revision: nextRevision,
			facts,
			commits: [...current.commits, commit],
			updatedAt: nowIso,
		};
		await writeLedgerUnlocked(input.filePath, ledger);
		return {
			ledger,
			result: {
				ledgerRevision: nextRevision,
				commitRevision: nextRevision,
				idempotent: false,
				...operationSummary,
			},
		};
	});
}
