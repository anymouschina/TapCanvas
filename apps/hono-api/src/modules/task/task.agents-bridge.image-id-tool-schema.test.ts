import { describe, expect, it } from "vitest";

import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

type JsonSchemaNode = {
  description?: string;
  maxItems?: number;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: readonly string[];
  oneOf?: readonly JsonSchemaNode[];
};

function buildTools() {
	const surface = inspectAgentsBridgeRemoteToolSurface({
		publicAgentsRequest: true,
		canvasProjectId: "project-1",
		canvasFlowId: "flow-1",
	});
	return [...surface.tools, ...surface.catalog];
}

describe("agent-facing image reference ID schemas", () => {
  it("exposes image_refs_get and analyze_image without URL parameters", () => {
    const tools = buildTools();
    const refs = tools.find((tool) => tool.name === "tapcanvas_image_refs_get");
    const analyze = tools.find((tool) => tool.name === "tapcanvas_analyze_image");

    expect(refs).toBeDefined();
    expect((refs?.parameters as JsonSchemaNode).properties).toHaveProperty("nodeIds");
    expect((refs?.parameters as JsonSchemaNode).properties).toHaveProperty("assetIds");
    expect(
      (refs?.parameters as JsonSchemaNode).properties?.nodeIds?.maxItems,
    ).toBeGreaterThanOrEqual(18);
		expect(refs?.description).toContain("server-batched");
		expect(refs?.description).toContain("without storage URLs");

    const analyzeSchema = analyze?.parameters as JsonSchemaNode;
    expect(analyzeSchema.properties).toHaveProperty("nodeId");
    expect(analyzeSchema.properties).toHaveProperty("assetId");
    expect(analyzeSchema.properties).not.toHaveProperty("imageUrl");
    expect(analyzeSchema.properties).not.toHaveProperty("url");
  });

  it("exposes only ID reference fields on paid image and video generation", () => {
    const tools = buildTools();
    for (const toolName of [
      "tapcanvas_image_generate_to_canvas",
      "tapcanvas_video_generate_to_canvas",
    ]) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      const schema = tool?.parameters as JsonSchemaNode;
      const nodeData = schema.properties?.node?.properties?.data;
      expect(nodeData?.properties).toHaveProperty("referenceImageNodeIds");
      expect(nodeData?.properties).toHaveProperty("referenceAssetIds");
      expect(nodeData?.properties).not.toHaveProperty("referenceImages");
      expect(nodeData?.properties).not.toHaveProperty("styleImages");
      expect(nodeData?.properties).not.toHaveProperty("styleReferenceImages");
      expect(nodeData?.properties).not.toHaveProperty("assetInputs");
      expect(nodeData?.properties).not.toHaveProperty("lastFrameUrl");
    }
  });

  it("keeps material, style and anchor tools URL-free", () => {
    const tools = buildTools();
    const materialVersionCreate = tools.find(
      (tool) => tool.name === "tapcanvas_material_asset_version_create",
    );
    const setStyle = tools.find(
      (tool) => tool.name === "tapcanvas_set_style_reference",
    );

    expect(
      (materialVersionCreate?.parameters as JsonSchemaNode).properties,
    ).not.toHaveProperty("imageUrl");
    expect(
      (materialVersionCreate?.parameters as JsonSchemaNode).required,
    ).toContain("sourceNodeId");
    expect((setStyle?.parameters as JsonSchemaNode).properties).toHaveProperty(
      "nodeIds",
    );
    expect((setStyle?.parameters as JsonSchemaNode).properties).toHaveProperty(
      "assetIds",
    );
    expect((setStyle?.parameters as JsonSchemaNode).properties).not.toHaveProperty(
      "styleImages",
    );
  });
});
