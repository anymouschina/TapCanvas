import { describe, it, expect } from "vitest";
import { canvasToolSchemas, canvasNodeSpecs } from "./tool-schemas";
import { inspectAgentsBridgeRemoteToolSurface } from "../task/task.agents-bridge";

describe("canvasToolSchemas Phase 1 flowPatch 扩展", () => {
	const names = canvasToolSchemas.map((t) => t.name);

	it("包含 reflowLayout（向后兼容）", () => {
		expect(names).toContain("reflowLayout");
	});

	it.each([
		"add_node",
		"connect_edge",
		"set_param",
		"link_existing_asset",
		"finalize",
	])("新增 tool %s", (name) => {
		expect(names).toContain(name);
	});

	it("add_node 要求 id / kind / position", () => {
		const t = canvasToolSchemas.find((x) => x.name === "add_node")!;
		const req = (t.parameters as any).required as string[];
		expect(req).toEqual(expect.arrayContaining(["id", "kind", "position"]));
	});

	it("connect_edge 要求 source / target", () => {
		const t = canvasToolSchemas.find((x) => x.name === "connect_edge")!;
		const req = (t.parameters as any).required as string[];
		expect(req).toEqual(expect.arrayContaining(["source", "target"]));
	});

	it("set_param 要求 nodeId / patch", () => {
		const t = canvasToolSchemas.find((x) => x.name === "set_param")!;
		const req = (t.parameters as any).required as string[];
		expect(req).toEqual(expect.arrayContaining(["nodeId", "patch"]));
	});

	it("link_existing_asset 要求 targetNodeId / existingNodeId / role", () => {
		const t = canvasToolSchemas.find(
			(x) => x.name === "link_existing_asset",
		)!;
		const req = (t.parameters as any).required as string[];
		expect(req).toEqual(
			expect.arrayContaining(["targetNodeId", "existingNodeId", "role"]),
		);
	});

	it("finalize 不强求任何字段", () => {
		const t = canvasToolSchemas.find((x) => x.name === "finalize")!;
		const req = ((t.parameters as any).required ?? []) as string[];
		expect(req).toEqual([]);
	});

	it("不再广播无前端执行器且写死模型的 analyze_video 双轨工具", () => {
		expect(names).not.toContain("analyze_video");
	});
});

describe("canvasNodeSpecs Phase 1 presets", () => {
	it("text 节点新增 presets 字段", () => {
		expect(canvasNodeSpecs.text).toHaveProperty("presets");
	});

	it("text.presets 含 chapter-info 预设", () => {
		const presets = (canvasNodeSpecs.text as any).presets;
		expect(presets).toHaveProperty("chapter-info");
	});

	it("chapter-info preset 的 dataDefaults 带 locked/readOnly=true", () => {
		const preset = (canvasNodeSpecs.text as any).presets["chapter-info"];
		expect(preset.dataDefaults.locked).toBe(true);
		expect(preset.dataDefaults.readOnly).toBe(true);
	});
});

describe("canvasNodeSpecs Phase 2 presets", () => {
	it("删除旧 role-card 与 role-portrait preset，角色卡只走 agents-cli 单轨", () => {
		expect((canvasNodeSpecs.novelDoc as any).presets?.["role-card"]).toBeUndefined();
		expect((canvasNodeSpecs.image as any).presets?.["role-portrait"]).toBeUndefined();
	});
});

describe("canvasNodeSpecs registered analysis nodes", () => {
	 it("exposes dedicated storyboard table and video analysis node capabilities", () => {
		expect(canvasNodeSpecs.shotTable.label).toBe("分镜表");
		expect(canvasNodeSpecs.shotTable.fields.shotTable).toContain("required ShotTable object");
		expect(canvasNodeSpecs.videoAnalysis.label).toBe("视频分析");
		expect(canvasNodeSpecs.storyboardScript.label).toBe("分镜脚本");
	 });
});

describe("directorConsole 暴露", () => {
  it("canvasNodeSpecs 含 directorConsole", () => {
    expect(canvasNodeSpecs).toHaveProperty("directorConsole");
    expect((canvasNodeSpecs as any).directorConsole.label).toBe("导演台");
  });
  it("canvasToolSchemas 含 add_director_console", () => {
    const names = canvasToolSchemas.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_director_console"]));
  });
  it("已移除全景球时代的 capture_shot / relight_shot 工具", () => {
    const names = canvasToolSchemas.map((t) => t.name);
    expect(names).not.toContain("capture_shot");
    expect(names).not.toContain("relight_shot");
  });
  it("directorConsole node spec 采用独立导演台入口模型", () => {
    const fields = canvasNodeSpecs.directorConsole.fields;
    expect(fields).toMatchObject({
      kind: "directorConsole",
      label: "string",
      status: "idle | running | success | error",
    });
    expect(fields).not.toHaveProperty("scene");
  });
  it("add_director_console 要求 id", () => {
    const t = canvasToolSchemas.find((x) => x.name === "add_director_console")!;
    const req = (t.parameters as any).required as string[];
    expect(req).toContain("id");
  });
});

describe("buildAgentsBridgeRemoteTools 远程工具广播", () => {
  const surface = inspectAgentsBridgeRemoteToolSurface({
    publicAgentsRequest: true,
    canvasProjectId: "test-project",
    canvasFlowId: "test-flow",
  });
  const remoteTools = [...surface.tools, ...surface.catalog];
  const remoteNames = remoteTools.map((t) => t.name);

	it("所有广播工具都有显式执行语义，读工具可并发、付费生成独占", () => {
		expect(remoteTools.every((tool) => tool.execution)).toBe(true);
		expect(remoteTools.find((tool) => tool.name === "tapcanvas_flow_get")?.execution).toMatchObject({
			sideEffect: "none", retrySafety: "safe", executionMode: "parallel_safe",
		});
		expect(remoteTools.find((tool) => tool.name === "tapcanvas_image_generate_to_canvas")?.execution).toMatchObject({
			sideEffect: "paid_generation", retrySafety: "unsafe", executionMode: "exclusive",
		});
	});

  it("advertises the DirectorDesk relay tool", () => {
    expect(remoteNames).toContain("tapcanvas_director_desk");
    const tool = remoteTools.find((item) => item.name === "tapcanvas_director_desk");
    expect(tool).toBeTruthy();
    expect(tool?.parameters).toMatchObject({ required: ["tool"] });
    expect(JSON.stringify(tool?.parameters)).toContain("director_apply");
    expect(tool?.description).toContain("director_read");
    expect(surface.catalog.some((item) => item.name === "tapcanvas_director_desk")).toBe(true);
  });
});
