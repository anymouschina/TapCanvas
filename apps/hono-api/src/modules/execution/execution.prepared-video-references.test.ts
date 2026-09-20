import { expect, it } from "vitest";
import { buildPreparedVideoReferences } from "./execution.prepared-video-references";
import type { ResolvedExecutionImageReference } from "../task/agents-tool-bridge.image-reference-ids";

it("binds asset-only cross-chapter references without inventing provider image numbers", () => {
  const references: ResolvedExecutionImageReference[] = [
    { referenceId: "chapter-one:hero", source: "project_node", nodeId: null, assetId: "hero", assetRefId: "hero-reference", name: "主角", url: "https://assets.example/hero.png", previewOnly: false },
    { referenceId: "room", source: "asset", nodeId: null, assetId: "room", assetRefId: null, name: "房间", url: "https://assets.example/room.png", previewOnly: false },
  ];
  const result = buildPreparedVideoReferences([
    { kind: "character", name: "主角", referenceAssetIds: ["chapter-one:hero"] },
    { kind: "scene", name: "房间", referenceAssetIds: ["room"] },
  ], references);
  expect(result.referenceTokens.get('["character","主角"]')).toEqual(["@hero-reference"]);
  expect(result.referenceTokens.get('["scene","房间"]')).toEqual(["@room"]);
  expect(result.assetInputs).toEqual([
    { url: references[0]!.url, assetId: "hero", assetRefId: "hero-reference", name: "主角", role: "reference" },
    { url: references[1]!.url, assetId: "room", assetRefId: "room", name: "房间", role: "reference" },
  ]);
});

it("matches node references by identity, never by identical display names", () => {
  const result = buildPreparedVideoReferences([
    { kind: "scene", name: "房间", referenceImageNodeIds: ["node-a"] },
  ], ["a", "b"].map((id) => ({ referenceId: id, source: "node" as const, nodeId: `node-${id}`, assetId: null, assetRefId: null, name: "房间", url: `https://assets.example/${id}.png`, previewOnly: false })));
  expect(result.referenceTokens.get('["scene","房间"]')).toEqual(["@a"]);
});
