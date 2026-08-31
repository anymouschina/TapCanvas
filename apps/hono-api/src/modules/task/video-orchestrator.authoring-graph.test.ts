import { describe, expect, it } from "vitest";
import {
	compileVideoAuthoringGraph,
	projectVideoAuthoringGraph,
	projectVideoAuthoringGraphArtifacts,
	reconcileAuthoringGraphControlAction,
	selectVideoAuthoringGraphControlAction,
	selectVideoProductionGraphDriveDecision,
	validateVideoAuthoringGraph,
} from "./video-orchestrator.authoring-graph";

describe("video authoring graph", () => {
	it("reconciles every stale graph projection to fresh asset coverage while the durable run is in repair", () => {
		for (const projectedAction of [
			"prepare_assets_and_writers",
			"drive_writers",
			"assemble",
			"estimate_and_handoff",
			"authoring_complete",
		] as const) {
			expect(reconcileAuthoringGraphControlAction({
				authoringState: "asset_repair_required",
				projectedAction,
			})).toBe("wait_asset_repair");
		}
	});

	it("compiles a fixed node vocabulary into a dynamic per-clip DAG", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-1", clipIndexes: [2, 0, 1, 2], executionScope: "media_delivery" });
		expect(graph.nodes.filter((node) => node.kind === "clip_writer")).toEqual([
			expect.objectContaining({ key: "clip:0", clipIndex: 0, dependsOn: ["asset:coverage"] }),
			expect.objectContaining({ key: "clip:1", clipIndex: 1, dependsOn: ["asset:coverage"] }),
			expect.objectContaining({ key: "clip:2", clipIndex: 2, dependsOn: ["asset:coverage"] }),
		]);
		expect(validateVideoAuthoringGraph(graph)).toEqual(expect.objectContaining({ ok: true }));
		expect(graph.nodes.filter((node) => node.kind === "video_submission")).toHaveLength(3);
		expect(graph.nodes.filter((node) => node.kind === "video_result")).toHaveLength(3);
		expect(graph.nodes.at(-2)).toEqual(expect.objectContaining({
			key: "concat:auto",
			dependsOn: ["video-result:0", "video-result:1", "video-result:2"],
		}));
		expect(graph.nodes.at(-1)).toEqual(expect.objectContaining({
			key: "delivery:verify",
			dependsOn: ["concat:auto"],
		}));
	});

	it("compiles prompt_only as a bounded graph with no asset or media nodes", () => {
		const graph = compileVideoAuthoringGraph({
			runId: "run-prompts",
			clipIndexes: [0, 1],
			executionScope: "prompt_only",
		});
		expect(graph.nodes.map((node) => node.kind)).toEqual([
			"beat_sheet",
			"clip_writer",
			"clip_writer",
			"assembly",
			"prompt_package",
		]);
		expect(graph.nodes.filter((node) => node.kind === "clip_writer")).toEqual([
			expect.objectContaining({ key: "clip:0", dependsOn: ["beat_sheet"] }),
			expect.objectContaining({ key: "clip:1", dependsOn: ["beat_sheet"] }),
		]);
		expect(validateVideoAuthoringGraph(graph)).toEqual(expect.objectContaining({ ok: true }));
		const projection = projectVideoAuthoringGraph({
			graph,
			nodeStates: {
				beat_sheet: "ready",
				"clip:0": "ready",
				"clip:1": "ready",
				"assembly:verification": "ready",
			},
		});
		expect(selectVideoAuthoringGraphControlAction(projection)).toBe("package_prompts");
		expect(selectVideoProductionGraphDriveDecision(projection)).toEqual({
			disposition: "complete",
			reason: "prompt_only_has_no_production_graph",
		});
	});

	it("rejects missing dependencies and dependency cycles", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-2", clipIndexes: [0], executionScope: "media_delivery" });
		const missingDependency = {
			...graph,
			nodes: graph.nodes.map((node) => node.key === "clip:0"
				? { ...node, dependsOn: ["unknown"] }
				: node),
		};
		expect(validateVideoAuthoringGraph(missingDependency)).toEqual(expect.objectContaining({
			ok: false,
			code: "video_authoring_graph_dependency_missing",
		}));
		const cyclic = {
			...graph,
			nodes: graph.nodes.map((node) => node.key === "beat_sheet"
				? { ...node, dependsOn: ["production:handoff"] }
				: node),
		};
		expect(validateVideoAuthoringGraph(cyclic)).toEqual(expect.objectContaining({
			ok: false,
			code: "video_authoring_graph_cycle",
		}));
	});

	it("rejects an acyclic graph that omits or rewires a delivery-template node", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-topology", clipIndexes: [0, 1], executionScope: "media_delivery" });
		const missingDelivery = {
			...graph,
			nodes: graph.nodes.filter((node) => node.key !== "delivery:verify"),
		};
		expect(validateVideoAuthoringGraph(missingDelivery)).toEqual(expect.objectContaining({
			ok: false,
			code: "video_authoring_graph_topology_invalid",
		}));
		const mismatchedClip = {
			...graph,
			nodes: graph.nodes.map((node) => node.key === "video-result:1"
				? { ...node, clipIndex: 0, dependsOn: ["video-submission:0"] }
				: node),
		};
		expect(validateVideoAuthoringGraph(mismatchedClip)).toEqual(expect.objectContaining({
			ok: false,
			code: "video_authoring_graph_topology_invalid",
		}));
	});

	it("rejects an unknown persisted status for a declared graph node", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-invalid-status", clipIndexes: [0], executionScope: "media_delivery" });
		expect(projectVideoAuthoringGraphArtifacts({
			runId: "run-invalid-status",
			artifacts: [
				{ artifact_key: "graph:manifest", status: "ready", payload: JSON.stringify(graph) },
				{ artifact_key: "clip:0", status: "mystery", payload: null },
			],
		})).toEqual(expect.objectContaining({
			ok: false,
			code: "video_authoring_graph_node_status_invalid",
		}));
	});

	it("reopens a persisted delivery receipt when its structured media probe evidence is missing", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-delivery-probe", clipIndexes: [0], executionScope: "media_delivery" });
		const projection = projectVideoAuthoringGraphArtifacts({
			runId: "run-delivery-probe",
			artifacts: [
				{ artifact_key: "graph:manifest", status: "ready", payload: JSON.stringify(graph) },
				...graph.nodes
					.filter((node) => node.key !== "delivery:verify")
					.map((node) => ({ artifact_key: node.key, status: "ready", payload: null })),
				{
					artifact_key: "delivery:verify",
					status: "ready",
					payload: JSON.stringify({
						deliveryVerification: {
							satisfied: false,
							outcome: "partial",
							missingCriteria: ["finalMediaProbe"],
						},
					}),
				},
			],
		});
		expect(projection.ok).toBe(true);
		if (!projection.ok) return;
		expect(projection.projection.waitingExternal).toContain("delivery:verify");
		expect(selectVideoProductionGraphDriveDecision(projection.projection)).toEqual({
			disposition: "drive",
			reason: "active:delivery:verify",
		});
	});

	it("projects a deterministic ready queue and keeps provider waits out of the runnable frontier", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-3", clipIndexes: [0, 1], executionScope: "media_delivery" });
		const authoringReady = Object.fromEntries(
			graph.nodes
				.filter((node) => !["video_submission", "video_result", "concat", "delivery_verify"].includes(node.kind))
				.map((node) => [node.key, "ready"] as const),
		);
		const initial = projectVideoAuthoringGraph({ graph, nodeStates: authoringReady });
		expect(initial.readyQueue).toEqual(["video-submission:0", "video-submission:1"]);

		const accepted = projectVideoAuthoringGraph({
			graph,
			nodeStates: {
				...authoringReady,
				"video-submission:0": "ready",
				"video-submission:1": "ready",
				"video-result:0": "waiting_external",
				"video-result:1": "waiting_external",
			},
		});
		expect(accepted.readyQueue).toEqual([]);
		expect(accepted.waitingExternal).toEqual(["video-result:0", "video-result:1"]);

		const resultsReady = projectVideoAuthoringGraph({
			graph,
			nodeStates: {
				...authoringReady,
				"video-submission:0": "ready",
				"video-submission:1": "ready",
				"video-result:0": "ready",
				"video-result:1": "ready",
			},
		});
		expect(resultsReady.readyQueue).toEqual(["concat:auto"]);
	});

	it("selects authoring actions from durable node facts instead of lifecycle prose", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-4", clipIndexes: [0], executionScope: "media_delivery" });
		const manifest = { artifact_key: "graph:manifest", status: "ready", payload: JSON.stringify(graph) };
		const project = (states: Record<string, string>) => projectVideoAuthoringGraphArtifacts({
			runId: "run-4",
			artifacts: [
				manifest,
				...Object.entries(states).map(([artifact_key, status]) => ({ artifact_key, status, payload: null })),
			],
		});
		const beatOnly = project({ beat_sheet: "ready" });
		expect(beatOnly.ok && selectVideoAuthoringGraphControlAction(beatOnly.projection)).toBe("prepare_assets_and_writers");
		const clipsRunning = project({ beat_sheet: "ready", "asset:coverage": "ready", "clip:0": "running" });
		expect(clipsRunning.ok && selectVideoAuthoringGraphControlAction(clipsRunning.projection)).toBe("drive_writers");
		const mixedGraph = compileVideoAuthoringGraph({ runId: "run-4-mixed", clipIndexes: [0, 1], executionScope: "media_delivery" });
		const clipsMixed = projectVideoAuthoringGraphArtifacts({
			runId: "run-4-mixed",
			artifacts: [
				{ artifact_key: "graph:manifest", status: "ready", payload: JSON.stringify(mixedGraph) },
				{ artifact_key: "beat_sheet", status: "ready", payload: null },
				{ artifact_key: "asset:coverage", status: "ready", payload: null },
				{ artifact_key: "clip:0", status: "failed", payload: null },
				{ artifact_key: "clip:1", status: "running", payload: null },
			],
		});
		expect(clipsMixed.ok && selectVideoAuthoringGraphControlAction(clipsMixed.projection)).toBe("drive_writers");
		const assemblyReady = project({ beat_sheet: "ready", "asset:coverage": "ready", "clip:0": "ready" });
		expect(assemblyReady.ok && selectVideoAuthoringGraphControlAction(assemblyReady.projection)).toBe("assemble");
		const handoffReady = project({
			beat_sheet: "ready",
			"asset:coverage": "ready",
			"clip:0": "ready",
			"assembly:verification": "ready",
			"estimate:auto": "ready",
			"production:handoff": "ready",
		});
		expect(handoffReady.ok && selectVideoAuthoringGraphControlAction(handoffReady.projection)).toBe("authoring_complete");
	});

	it("lets the production worker run only from a persisted graph frontier", () => {
		const graph = compileVideoAuthoringGraph({ runId: "run-5", clipIndexes: [0], executionScope: "media_delivery" });
		const baseStates = Object.fromEntries(
			graph.nodes
				.filter((node) => !["video_submission", "video_result", "concat", "delivery_verify"].includes(node.kind))
				.map((node) => [node.key, "ready"] as const),
		);
		const frontier = projectVideoAuthoringGraph({ graph, nodeStates: baseStates });
		expect(selectVideoProductionGraphDriveDecision(frontier)).toEqual(expect.objectContaining({
			disposition: "drive",
			reason: "ready:video-submission:0",
		}));
		const missingHandoff = projectVideoAuthoringGraph({
			graph,
			nodeStates: { ...baseStates, "production:handoff": "pending" },
		});
		expect(selectVideoProductionGraphDriveDecision(missingHandoff)).toEqual(expect.objectContaining({
			disposition: "failed",
			reason: "production_handoff_not_ready:pending",
		}));
		const mixedProductionGraph = compileVideoAuthoringGraph({ runId: "run-5-mixed", clipIndexes: [0, 1], executionScope: "media_delivery" });
		const acceptedSiblingStillRunning = projectVideoAuthoringGraph({
			graph: mixedProductionGraph,
			nodeStates: {
				beat_sheet: "ready",
				"asset:coverage": "ready",
				"clip:0": "ready",
				"clip:1": "ready",
				"assembly:verification": "ready",
				"estimate:auto": "ready",
				"production:handoff": "ready",
				"video-submission:0": "ready",
				"video-submission:1": "failed",
				"video-result:0": "waiting_external",
				"video-result:1": "failed",
			},
		});
		expect(selectVideoProductionGraphDriveDecision(acceptedSiblingStillRunning)).toEqual({
			disposition: "drive",
			reason: "active:video-result:0",
		});
		const settledWithFailure = projectVideoAuthoringGraph({
			graph: mixedProductionGraph,
			nodeStates: {
				beat_sheet: "ready",
				"asset:coverage": "ready",
				"clip:0": "ready",
				"clip:1": "ready",
				"assembly:verification": "ready",
				"estimate:auto": "ready",
				"production:handoff": "ready",
				"video-submission:0": "ready",
				"video-submission:1": "failed",
				"video-result:0": "ready",
				"video-result:1": "failed",
			},
		});
		expect(selectVideoProductionGraphDriveDecision(settledWithFailure)).toEqual({
			disposition: "failed",
			reason: "production_graph_node_failed:video-submission:1,video-result:1",
		});
	});
});
