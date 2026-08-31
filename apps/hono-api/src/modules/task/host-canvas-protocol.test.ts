// apps/hono-api/src/modules/task/host-canvas-protocol.test.ts
import { describe, expect, it } from "vitest";
import {
	HostCapabilityManifestSchema,
	HostProtocolError,
	buildHostTool,
	extractHostSegments,
	renderHostManifestPrompt,
} from "./host-canvas-protocol";
import { assertHostGenerationModeSupported } from "./task.agents-bridge";

const MANIFEST = {
	protocol_version: "1",
	host: "tanva",
	patchOps: ["addNode", "updateNodeData", "connectEdge", "focusNode", "placeImage", "runNode"],
	nodeSpecs: [
		{ type: "textNote", label: "便签", purpose: "画布上的纯文本便签", params: { text: { type: "string" } } },
	],
};

describe("HostCapabilityManifestSchema", () => {
	it("接受合法 manifest", () => {
		expect(HostCapabilityManifestSchema.safeParse(MANIFEST).success).toBe(true);
	});
	it("保留宿主高层工具并构建受 manifest 约束的 host_tool", () => {
		const parsed = HostCapabilityManifestSchema.parse({
			...MANIFEST,
			hostTools: [{
				name: "create_presentation",
				description: "创建可编辑演示文稿",
				parameters: { type: "object", properties: { title: { type: "string" } } },
			}],
		});
		expect(parsed.hostTools?.[0]?.name).toBe("create_presentation");
		const tool = buildHostTool(parsed);
		expect(tool.name).toBe("host_tool");
		expect(tool.parameters.properties.name.enum).toEqual(["create_presentation"]);
		expect(renderHostManifestPrompt(parsed)).toContain("不得因为该能力不是 flow_patch 而声称宿主未提供");
	});
	it("拒绝未知 patchOp", () => {
		const bad = { ...MANIFEST, patchOps: ["dropTable"] };
		expect(HostCapabilityManifestSchema.safeParse(bad).success).toBe(false);
	});
	it("接受 1..8 的宿主图片输出数量并拒绝越界值", () => {
		expect(
			HostCapabilityManifestSchema.safeParse({ ...MANIFEST, imageOutputCount: 4 }).success,
		).toBe(true);
		expect(
			HostCapabilityManifestSchema.safeParse({ ...MANIFEST, imageOutputCount: 0 }).success,
		).toBe(false);
		expect(
			HostCapabilityManifestSchema.safeParse({ ...MANIFEST, imageOutputCount: 9 }).success,
		).toBe(false);
	});
	it("把宿主数量渲染为权威单输出工作流约束", () => {
		const parsed = HostCapabilityManifestSchema.parse({
			...MANIFEST,
			imageOutputCount: 1,
		});
		const prompt = renderHostManifestPrompt(parsed);
		expect(prompt).toContain("图片输出数量（宿主 UI 权威值）: 1");
		expect(prompt).toContain("恰好创建 1 个单输出图片生成节点");
		expect(prompt).toContain("不得使用 generate4 / generatePro4");
		expect(prompt).toContain("不要再用 media 卡");
		expect(prompt).toContain("同一条 assistant 响应");
	});
	it.each(["managed", "both"] as const)(
		"显式拒绝尚未实现的 %s 生成模式，而不是静默退成 host",
		(generationMode) => {
			const manifest = HostCapabilityManifestSchema.parse({
				...MANIFEST,
				generationMode,
			});
			expect(() => assertHostGenerationModeSupported(manifest)).toThrow(
				/Host generation mode is not implemented/,
			);
		},
	);
	it("接受 host 或缺省生成模式", () => {
		expect(assertHostGenerationModeSupported(HostCapabilityManifestSchema.parse(MANIFEST))).toBe("host");
		expect(assertHostGenerationModeSupported(HostCapabilityManifestSchema.parse({
			...MANIFEST,
			generationMode: "host",
		}))).toBe("host");
	});
});

describe("extractHostSegments", () => {
	it("从 messages 中抽出 manifest/context/prompt/instructions", () => {
		const messages = [
			{ role: "system", content: `<capability_manifest>${JSON.stringify(MANIFEST)}</capability_manifest>` },
			{ role: "system", content: `<canvas_context>{"nodes":[{"id":"n1","type":"textNote"}],"edges":[]}</canvas_context>` },
			{ role: "system", content: "你叫小T，说话简洁。" },
			{ role: "user", content: "帮我加一个便签" },
		];
		const seg = extractHostSegments(messages);
		expect(seg.manifest?.host).toBe("tanva");
		expect(seg.canvasContext?.nodes).toHaveLength(1);
		expect(seg.instructions).toEqual(["你叫小T，说话简洁。"]);
		expect(seg.prompt).toBe("帮我加一个便签");
	});
	it("保留经过 schema 校验的本地桌面执行声明", () => {
		const seg = extractHostSegments([
			{
				role: "system",
				content: `<capability_manifest>${JSON.stringify({
					...MANIFEST,
					executionMode: "local_desktop",
				})}</capability_manifest>`,
			},
			{ role: "user", content: "生成 PPTX" },
		]);
		expect(seg.manifest?.executionMode).toBe("local_desktop");
	});
	it("无 manifest 时返回 manifest undefined（回落原行为）", () => {
		const seg = extractHostSegments([{ role: "user", content: "hi" }]);
		expect(seg.manifest).toBeUndefined();
		expect(seg.prompt).toBe("hi");
	});
	it("manifest JSON 非法时抛出带 code 的错误", () => {
		const messages = [
			{ role: "system", content: "<capability_manifest>{oops</capability_manifest>" },
			{ role: "user", content: "hi" },
		];
		expect(() => extractHostSegments(messages)).toThrow(/capability_manifest/);
		try {
			extractHostSegments(messages);
			expect.unreachable("应当抛出 HostProtocolError");
		} catch (err) {
			expect(err).toBeInstanceOf(HostProtocolError);
			expect((err as HostProtocolError).code).toBe("invalid_capability_manifest");
		}
	});
	it("messages 结构非法时抛出 invalid_messages", () => {
		try {
			extractHostSegments([{ role: "hacker", content: "hi" }]);
			expect.unreachable("应当抛出 HostProtocolError");
		} catch (err) {
			expect(err).toBeInstanceOf(HostProtocolError);
			expect((err as HostProtocolError).code).toBe("invalid_messages");
		}
	});
	it("generation_contract 段解析成功并从 instructions 剥离", () => {
		const contract = {
			version: "v1",
			lockedAnchors: ["水彩画风，低饱和", "35mm 定焦，平视机位"],
			editableVariable: "主体动作",
			forbiddenChanges: ["不得改变角色服装"],
			approvedKeyframeId: null,
		};
		const seg = extractHostSegments([
			{
				role: "system",
				content: `<generation_contract>${JSON.stringify(contract)}</generation_contract>其余说明`,
			},
			{ role: "user", content: "hi" },
		]);
		expect(seg.generationContract).toEqual(contract);
		expect(seg.instructions).toEqual(["其余说明"]);
	});
	it("generation_contract JSON 非法时抛 invalid_generation_contract", () => {
		try {
			extractHostSegments([
				{ role: "system", content: "<generation_contract>{oops</generation_contract>" },
				{ role: "user", content: "hi" },
			]);
			expect.unreachable("应当抛出 HostProtocolError");
		} catch (err) {
			expect(err).toBeInstanceOf(HostProtocolError);
			expect((err as HostProtocolError).code).toBe("invalid_generation_contract");
		}
	});
	it("generation_contract 超 12 项 lockedAnchors 被 schema 拒绝", () => {
		const contract = {
			version: "v1",
			lockedAnchors: Array.from({ length: 13 }, (_, i) => `锚点${i}`),
			editableVariable: null,
			forbiddenChanges: [],
			approvedKeyframeId: null,
		};
		try {
			extractHostSegments([
				{
					role: "system",
					content: `<generation_contract>${JSON.stringify(contract)}</generation_contract>`,
				},
				{ role: "user", content: "hi" },
			]);
			expect.unreachable("应当抛出 HostProtocolError");
		} catch (err) {
			expect(err).toBeInstanceOf(HostProtocolError);
			expect((err as HostProtocolError).code).toBe("invalid_generation_contract");
		}
	});
	it("developer role 视同 system", () => {
		const seg = extractHostSegments([
			{ role: "developer", content: `<capability_manifest>${JSON.stringify(MANIFEST)}</capability_manifest>说明文字` },
			{ role: "user", content: "hi" },
		]);
		expect(seg.manifest?.host).toBe("tanva");
		expect(seg.instructions).toEqual(["说明文字"]);
	});
});
