import { describe, it, expect } from "vitest";
import { coerceStringifiedObjectArgs } from "./agents-tool-bridge.coerce-args";

// LLM 常把嵌套 object 参数序列化成 JSON 字符串（schema 被 defer 后尤甚），
// 2026-06-11 实证：image_generate_to_canvas 的 node、capture_director_scene 的 scene 连续 400。
describe("coerceStringifiedObjectArgs", () => {
	it("把 JSON 字符串形态的 node/scene 解套成 object", () => {
		const args = coerceStringifiedObjectArgs({
			node: '{"type":"taskNode","data":{"kind":"imageEdit"}}',
			scene: '{"aspect":"16:9","characters":[{"id":"a","posePresetId":"run"}]}',
		});
		expect(args.node).toEqual({ type: "taskNode", data: { kind: "imageEdit" } });
		expect((args.scene as Record<string, unknown>).aspect).toBe("16:9");
	});

	it("JSON 数组字符串也解套（segments/nodes）", () => {
		const args = coerceStringifiedObjectArgs({ segments: '[{"url":"https://a/b.mp4"}]' });
		expect(Array.isArray(args.segments)).toBe(true);
	});

	it("非白名单键不动：prompt 即使以 { 开头也保持字符串", () => {
		const prompt = '{"这是用户故意写的花括号开头文案"}';
		const args = coerceStringifiedObjectArgs({ prompt });
		expect(args.prompt).toBe(prompt);
	});

	it("非法 JSON / 标量 JSON 保留原值，交给下游 zod 报错", () => {
		const args = coerceStringifiedObjectArgs({ node: "{broken json", scene: '"just-a-string"' });
		expect(args.node).toBe("{broken json");
		expect(args.scene).toBe('"just-a-string"');
	});

	it("本来就是 object 的参数原样保留", () => {
		const node = { type: "taskNode" };
		const args = coerceStringifiedObjectArgs({ node });
		expect(args.node).toBe(node);
	});

	it("capture_director_scene: animation 作为对象时顶层透传不破坏嵌套数组", () => {
		const args = {
			id: "n1",
			requestId: "r1",
			mode: "clip",
			animation: {
				durationSeconds: 4,
				fps: 24,
				characters: {
					hero: {
						motion: {
							durationSeconds: 4,
							locomotion: {
								clip: "walk",
								path: { waypoints: [[0, 0], [4, 0]], mode: "linear" },
							},
						},
					},
				},
			},
		};
		const out = coerceStringifiedObjectArgs(args) as any;
		const wp = out.animation.characters.hero.motion.locomotion.path.waypoints;
		expect(Array.isArray(wp)).toBe(true);
		expect(Array.isArray(wp[0])).toBe(true);
		expect(wp[0]).toEqual([0, 0]);
	});
});
