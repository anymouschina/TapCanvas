import { describe, expect, it } from "vitest";
import {
	appendCinematicCameraPrompt,
	buildCinematicCameraPrompt,
} from "./cinematic-camera-prompt";

const FULL_CAM = {
	enabled: true,
	cameraKey: "arri_alexa35",
	lensKey: "zeiss_master_prime",
	focalKey: "35mm",
	apertureKey: "f/2",
};

describe("buildCinematicCameraPrompt", () => {
	it("完整四项拼出与前端一致的句式", () => {
		expect(buildCinematicCameraPrompt(FULL_CAM)).toBe(
			"摄影机参数（机身：ARRI Alexa 35；镜头：Zeiss Master Prime；焦距：35mm；光圈：f/2），呈现对应焦段透视、景深与镜头特有的光学质感。",
		);
	});

	it("部分字段只拼已选项", () => {
		const text = buildCinematicCameraPrompt({
			enabled: true,
			cameraKey: "",
			lensKey: "",
			focalKey: "50mm",
			apertureKey: "",
		});
		expect(text).toBe("摄影机参数（焦距：50mm），呈现对应焦段透视、景深与镜头特有的光学质感。");
	});

	it("null / 未知 key 全不命中时返回空串", () => {
		expect(buildCinematicCameraPrompt(null)).toBe("");
		expect(
			buildCinematicCameraPrompt({
				enabled: true,
				cameraKey: "nope",
				lensKey: "nope",
				focalKey: "1mm",
				apertureKey: "f/999",
			}),
		).toBe("");
	});
});

describe("appendCinematicCameraPrompt", () => {
	it("追加到已有 prompt 尾部", () => {
		const out = appendCinematicCameraPrompt("一只猫", FULL_CAM);
		expect(out.startsWith("一只猫\n摄影机参数（")).toBe(true);
	});

	it("prompt 已含摄影机参数标记时幂等跳过", () => {
		const once = appendCinematicCameraPrompt("一只猫", FULL_CAM);
		expect(appendCinematicCameraPrompt(once, FULL_CAM)).toBe(once);
	});

	it("无有效规格时原样返回", () => {
		expect(appendCinematicCameraPrompt("一只猫", null)).toBe("一只猫");
	});
});
