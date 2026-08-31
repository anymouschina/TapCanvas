import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { VerifiedStoryFactSource } from "./story-facts.schemas";
import {
	commitStoryFacts,
	readStoryFactsLedger,
	selectStoryFacts,
} from "./story-facts.store";

const PROJECT_ID = "project-story-facts";
const BOOK_ID = "book-story-facts";

function source(chapter = 1): VerifiedStoryFactSource {
	return {
		kind: "book_chapter",
		projectId: PROJECT_ID,
		bookId: BOOK_ID,
		chapter,
		fileName: "raw.md",
		contentSha256: "a".repeat(64),
		contentChars: 120,
		capturedAt: "2026-07-30T00:00:00.000Z",
	};
}

async function createLedgerPath(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "story-facts-store-"));
	return path.join(dir, "story-facts.json");
}

describe("story-facts.store", () => {
	it("creates a versioned temporal fact ledger and filters by an effective point", async () => {
		const filePath = await createLedgerPath();
		const first = await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "commit-1",
			expectedRevision: 0,
			source: source(1),
			operations: [
				{
					type: "add",
					factId: "fact-key-owner-linmo",
					subject: { kind: "character", key: "character:linmo", name: "林墨" },
					predicate: "持有",
					value: "裂纹玉佩",
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 20, label: "捡起玉佩" },
					disclosure: { mode: "immediate", revealAt: null },
				},
			],
		});
		expect(first.result).toMatchObject({
			ledgerRevision: 1,
			commitRevision: 1,
			idempotent: false,
		});

		const second = await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "commit-2",
			expectedRevision: 1,
			source: source(2),
			operations: [
				{
					type: "close",
					factId: "fact-key-owner-linmo",
					validUntil: { chapter: 2, sequence: 10, label: "交给顾宁" },
				},
				{
					type: "add",
					factId: "fact-key-owner-guning",
					subject: { kind: "character", key: "character:guning", name: "顾宁" },
					predicate: "持有",
					value: "裂纹玉佩",
					status: "confirmed",
					validFrom: { chapter: 2, sequence: 10, label: "接过玉佩" },
					disclosure: { mode: "immediate", revealAt: null },
				},
			],
		});
		expect(second.result).toMatchObject({
			ledgerRevision: 2,
			commitRevision: 2,
			closedFactIds: ["fact-key-owner-linmo"],
			addedFactIds: ["fact-key-owner-guning"],
		});

		const ledger = await readStoryFactsLedger({ filePath, projectId: PROJECT_ID, bookId: BOOK_ID });
		expect(ledger.revision).toBe(2);
		expect(ledger.schemaVersion).toBe(2);
		expect(ledger.facts).toHaveLength(2);
		expect(
			selectStoryFacts({ ledger, at: { chapter: 2, sequence: 9 } }).map((fact) => fact.factId),
		).toEqual(["fact-key-owner-linmo"]);
		expect(
			selectStoryFacts({ ledger, at: { chapter: 2, sequence: 10 } }).map((fact) => fact.factId),
		).toEqual(["fact-key-owner-guning"]);
	});

	it("replays the same commit idempotently even when the caller still has the old revision", async () => {
		const filePath = await createLedgerPath();
		const input = {
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "stable-commit",
			expectedRevision: 0,
			source: source(),
			operations: [
				{
					type: "add" as const,
					factId: "fact-secret-known",
					subject: { kind: "character", key: "character:linmo", name: "林墨" },
					predicate: "知道",
					value: "匿名信来自顾宁",
					status: "inferred" as const,
					validFrom: { chapter: 1, sequence: 30 },
					disclosure: {
						mode: "gated" as const,
						revealAt: { chapter: 2, sequence: 0 },
					},
				},
			],
		};
		const first = await commitStoryFacts(input);
		const replay = await commitStoryFacts({
			...input,
			source: { ...input.source, capturedAt: "2026-07-30T00:05:00.000Z" },
		});
		expect(first.result).toMatchObject({
			ledgerRevision: 1,
			commitRevision: 1,
			idempotent: false,
		});
		expect(replay.result).toMatchObject({
			ledgerRevision: 1,
			commitRevision: 1,
			idempotent: true,
		});

		await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "later-commit",
			expectedRevision: 1,
			source: source(2),
			operations: [
				{
					type: "add",
					factId: "fact-later",
					subject: { kind: "event", key: "event:later", name: "后续事件" },
					predicate: "发生",
					value: true,
					status: "confirmed",
					validFrom: { chapter: 2, sequence: 0 },
					disclosure: { mode: "immediate", revealAt: null },
				},
			],
		});
		const replayAfterLaterCommit = await commitStoryFacts({
			...input,
			source: { ...input.source, capturedAt: "2026-07-30T00:10:00.000Z" },
		});
		expect(replayAfterLaterCommit.result).toMatchObject({
			ledgerRevision: 2,
			commitRevision: 1,
			idempotent: true,
		});
		expect(replayAfterLaterCommit.ledger.commits).toHaveLength(2);
	});

	it("fails explicitly on stale revisions, reused commit ids, invalid intervals, and status downgrades", async () => {
		const filePath = await createLedgerPath();
		await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "commit-base",
			expectedRevision: 0,
			source: source(),
			operations: [
				{
					type: "add",
					factId: "fact-relationship",
					subject: { kind: "relationship", key: "relationship:linmo:guning", name: "林墨与顾宁" },
					predicate: "信任",
					value: "有限合作",
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 40 },
					disclosure: { mode: "immediate", revealAt: null },
				},
			],
		});

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "wrong-source-scope",
				expectedRevision: 1,
				source: { ...source(), bookId: "different-book" },
				operations: [
					{
						type: "add",
						factId: "fact-wrong-source",
						subject: { kind: "event", key: "event:wrong-source", name: "错误来源" },
						predicate: "发生",
						value: true,
						status: "confirmed",
						validFrom: { chapter: 2, sequence: 0 },
						disclosure: { mode: "immediate", revealAt: null },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_facts_identity_mismatch" });

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "stale",
				expectedRevision: 0,
				source: source(),
				operations: [
					{
						type: "add",
						factId: "fact-stale",
						subject: { kind: "event", key: "event:stale", name: "过期写入" },
						predicate: "发生",
						value: true,
						status: "confirmed",
						validFrom: { chapter: 2, sequence: 0 },
						disclosure: { mode: "immediate", revealAt: null },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_facts_revision_conflict" });

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "commit-base",
				expectedRevision: 1,
				source: source(),
				operations: [
					{
						type: "close",
						factId: "fact-relationship",
						validUntil: { chapter: 2, sequence: 0 },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_facts_commit_id_conflict" });

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "bad-close",
				expectedRevision: 1,
				source: source(),
				operations: [
					{
						type: "close",
						factId: "fact-relationship",
						validUntil: { chapter: 1, sequence: 40 },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_fact_interval_invalid" });

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "status-downgrade",
				expectedRevision: 1,
				source: source(),
				operations: [
					{
						type: "set_status",
						factId: "fact-relationship",
						expectedStatus: "confirmed",
						status: "inferred",
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_fact_status_transition_invalid" });
	});

	it("CAS-updates disclosure and rejects invalid or stale reveal authority", async () => {
		const filePath = await createLedgerPath();
		await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "secret-add",
			expectedRevision: 0,
			source: source(),
			operations: [
				{
					type: "add",
					factId: "fact-hidden-identity",
					subject: { kind: "relationship", key: "relationship:hidden", name: "隐藏身份" },
					predicate: "真实关系",
					value: "未公开",
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 0 },
					disclosure: { mode: "gated", revealAt: { chapter: 5, sequence: 10 } },
				},
			],
		});

		const changed = await commitStoryFacts({
			filePath,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			actorId: "user-1",
			commitId: "secret-reschedule",
			expectedRevision: 1,
			source: source(),
			operations: [
				{
					type: "set_disclosure",
					factId: "fact-hidden-identity",
					expectedDisclosure: { mode: "gated", revealAt: { chapter: 5, sequence: 10 } },
					disclosure: { mode: "gated", revealAt: { chapter: 6, sequence: 0 } },
				},
			],
		});
		expect(changed.result.disclosureChangedFactIds).toEqual(["fact-hidden-identity"]);

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "secret-stale-disclosure",
				expectedRevision: 2,
				source: source(),
				operations: [
					{
						type: "set_disclosure",
						factId: "fact-hidden-identity",
						expectedDisclosure: { mode: "gated", revealAt: { chapter: 5, sequence: 10 } },
						disclosure: { mode: "immediate", revealAt: null },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_fact_disclosure_conflict" });

		await expect(
			commitStoryFacts({
				filePath,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				actorId: "user-1",
				commitId: "secret-invalid-window",
				expectedRevision: 2,
				source: source(),
				operations: [
					{
						type: "set_disclosure",
						factId: "fact-hidden-identity",
						expectedDisclosure: { mode: "gated", revealAt: { chapter: 6, sequence: 0 } },
						disclosure: { mode: "gated", revealAt: { chapter: 1, sequence: 0 } },
					},
				],
			}),
		).rejects.toMatchObject({ code: "story_fact_disclosure_window_invalid" });
	});
});
