import { describe, expect, it } from "vitest";
import {
	adaptStoryboardShotDesignToStructuredData,
	assessStoryboardMiniArc,
	deriveShotPromptsFromStructuredData,
	normalizeStoryboardShotDesignArtifact,
	normalizeStoryboardStructuredData,
} from "./storyboard-structure";

describe("storyboard structure helpers", () => {
	it("normalizes storyboard-director v1.1 payloads into dense render prompts", () => {
		const structured = normalizeStoryboardStructuredData({
			schemaVersion: "storyboard-director/v1.1",
			globalStyle: {
				genre: "东方奇幻定格动画",
				visualTone: "冷灰压迫感",
				palette: "冷蓝灰与烛火暖橙",
			},
			shots: [
				{
					shotId: "SHOT_01",
					durationSec: 3,
					narrativeGoal: "建立角色被雨夜压迫的处境",
					subjectAnchors: ["李长安湿透黑发", "旧式粗布外套"],
					scene: {
						location: "老屋门前",
						timeOfDay: "深夜",
						weather: "暴雨",
						environmentDetails: ["泥地积水反光", "门框剥落木刺"],
					},
					camera: {
						shotSize: "中景",
						angle: "轻低机位",
						height: "胸口高度",
						lensMm: 35,
						shutterAngleDeg: 180,
						movement: "缓慢前推",
						focusTarget: "李长安面部",
					},
					lighting: {
						keyDirection: "左后方祠堂冷光",
						keyAngleDeg: 35,
						colorTempK: 4800,
						contrastRatio: "4:1",
						fillStyle: "雨夜环境漫反射",
						rimLight: "湿发边缘弱轮廓",
					},
					actionChain: ["李长安停步", "抬眼盯住房门"],
					composition: {
						foreground: "雨线和门槛积水",
						midground: "李长安侧身站定",
						background: "老屋门板与晃动白幡",
						spatialRule: "人物偏左，房门占右侧压迫视野",
					},
					dramaticBeat: {
						before: "刚穿过村口",
						during: "在老屋前察觉异样",
						after: "决定逼近房门",
					},
					performance: {
						emotion: "警惕压抑",
						microExpression: "眼角紧绷",
						bodyLanguage: "肩膀前探但脚下迟疑",
					},
					continuity: {
						fromPrev: "首镜建立，无需承接上一镜",
						persistentAnchors: ["人物湿透外套不变", "房门始终位于画面右侧"],
						forbiddenDrifts: ["不要把老屋改成现代楼房"],
					},
					continuityLocks: {
						identityLock: ["李长安脸型与黑发保持一致"],
						propLock: ["木门破损纹理保持一致"],
						spaceLock: ["门在右、人物在左的轴线不变"],
						lightLock: ["冷雨夜与门内暖光对比保持稳定"],
					},
					failureRisks: ["人物站位漂移"],
					negativeConstraints: ["禁止现代元素", "禁止卡通表情"],
					prompt: {
						cn: "中景，李长安站在暴雨中的老屋门前。",
					},
				},
			],
		});

		expect(structured?.shots).toHaveLength(1);
		expect(structured?.shots[0]?.render?.promptText).toContain("空间锁");
		expect(structured?.shots[0]?.render?.promptText).toContain("李长安");
		expect(structured?.shots[0]?.render?.promptText).toContain("老屋门前");
		expect(structured?.shots[0]?.render?.shotType).toBe("中景");
		expect(structured?.shots[0]?.render?.cameraMovement).toBe("缓慢前推");
	});

	it("normalizes two-phase storyboard data and derives legacy prompts", () => {
		const structured = normalizeStoryboardStructuredData({
			pacingGoal: "7-15秒总时长",
			shots: [
				{
					shot_number: "分镜 1",
					beat_role: "opening",
					dramatic_beat: "危险逼近",
					story_purpose: "建立威胁",
					continuity: "承接上一镜视线方向",
					durationSec: 3,
					render_prompt: "中景，角色A回头看向门外，烛火摇动",
					subject_action: "角色A回头",
					shot_type: "中景",
					camera_movement: "轻推",
				},
			],
		});

		expect(structured?.version).toBe("two_phase_v1");
		expect(structured?.shots[0]?.purpose?.dramaticBeat).toBe("危险逼近");
		expect(structured?.shots[0]?.purpose?.beatRole).toBe("opening");
		expect(structured?.shots[0]?.render?.promptText).toBe("中景，角色A回头看向门外，烛火摇动");
		expect(deriveShotPromptsFromStructuredData(structured)).toEqual([
			"中景，角色A回头看向门外，烛火摇动",
		]);
	});

	it("adapts shot design into renderable structured prompts", () => {
		const design = normalizeStoryboardShotDesignArtifact({
			version: "shot_design_v1",
			shots: [
				{
					shot_number: "分镜 1",
					beat_role: "opening",
					dramatic_beat: "角色停步听见门后异响",
					story_purpose: "建立危险靠近的压力",
					continuity: "承接上一组尾帧的视线方向",
					durationSec: 3,
					subject_action: "角色A停步侧耳",
					shot_type: "中景",
					camera_movement: "轻推",
					environment: "祠堂门口",
					time_lighting: "夜内景烛火",
				},
			],
		});

		expect(design?.version).toBe("shot_design_v1");
		const structured = adaptStoryboardShotDesignToStructuredData(design);
		expect(structured?.shots[0]?.render?.promptText).toContain("中景");
		expect(structured?.shots[0]?.render?.promptText).toContain("角色A停步侧耳");
		expect(structured?.shots[0]?.render?.promptText).toContain("祠堂门口");
	});

	it("assesses a valid short-form mini arc", () => {
		const assessment = assessStoryboardMiniArc({
			shots: [
				{
					shot_number: "分镜 1",
					beat_role: "opening",
					dramatic_beat: "角色A发现门后异响",
					story_purpose: "建立压迫和警觉",
					continuity: "承接上一组尾帧视线",
					durationSec: 3,
					render_prompt: "中景，角色A侧耳靠近门缝",
				},
				{
					shot_number: "分镜 2",
					beat_role: "escalation",
					dramatic_beat: "门缝内突然露出血手",
					story_purpose: "把威胁升级为实体冲击",
					continuity: "延续门的方位和角色站位",
					durationSec: 4,
					render_prompt: "近景，血手猛地抓住门框，角色A后仰",
				},
				{
					shot_number: "分镜 3",
					beat_role: "payoff",
					dramatic_beat: "角色A撞开门后看到尸体真相",
					story_purpose: "完成揭示并形成落点",
					continuity: "镜头沿门缝方向推进至内室",
					durationSec: 4,
					render_prompt: "推进镜头，内室尸体暴露在烛火下",
				},
			],
		});

		expect(assessment.ok).toBe(true);
		expect(assessment.totalDurationSec).toBe(11);
	});

	it("rejects mini arc outputs with missing escalation/payoff roles", () => {
		const assessment = assessStoryboardMiniArc({
			shots: [
				{
					shot_number: "分镜 1",
					beat_role: "opening",
					dramatic_beat: "角色A警觉回头",
					story_purpose: "建立开场",
					continuity: "承接视线",
					durationSec: 3,
					render_prompt: "中景，角色A回头",
				},
				{
					shot_number: "分镜 2",
					beat_role: "opening",
					dramatic_beat: "角色A继续回头",
					story_purpose: "重复描述",
					continuity: "延续站位",
					durationSec: 3,
					render_prompt: "中景，角色A继续回头",
				},
			],
		});

		expect(assessment.ok).toBe(false);
		expect(assessment.reasons).toContain("mini_arc_missing_escalation_turn");
		expect(assessment.reasons).toContain("mini_arc_missing_payoff_landing");
	});
});
