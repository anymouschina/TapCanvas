import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	buildAudioFrame,
	buildFullClientRequestFrame,
	buildSaucRequestPayload,
	buildServerErrorFrameForTest,
	buildServerResponseFrameForTest,
	parseServerMessage,
} from "./volc-sauc-protocol";

describe("客户端帧封包", () => {
	it("full client request：头字节/长度/gzip JSON 还原", () => {
		const payload = buildSaucRequestPayload("u1");
		const frame = buildFullClientRequestFrame(payload);
		expect(frame[0]).toBe((0b0001 << 4) | 0b0001);
		expect(frame[1]).toBe((0b0001 << 4) | 0b0000);
		expect(frame[2]).toBe((0b0001 << 4) | 0b0001); // JSON + Gzip
		const size = frame.readUInt32BE(4);
		expect(frame.length).toBe(8 + size);
		const json = JSON.parse(gunzipSync(frame.subarray(8)).toString("utf8"));
		expect(json.request.model_name).toBe("bigmodel");
		expect(json.request.enable_nonstream).toBe(true);
		expect(json.audio.rate).toBe(16000);
	});

	it("音频帧：普通包 flags=0，最后一包 flags=0b0010，payload gzip 还原", () => {
		const pcm = Buffer.alloc(6400, 7);
		const mid = buildAudioFrame(pcm, false);
		const last = buildAudioFrame(Buffer.alloc(0), true);
		expect(mid[1]).toBe((0b0010 << 4) | 0b0000);
		expect(last[1]).toBe((0b0010 << 4) | 0b0010);
		expect(gunzipSync(mid.subarray(8)).equals(pcm)).toBe(true);
		expect(gunzipSync(last.subarray(8)).length).toBe(0);
	});
});

describe("服务端帧解析", () => {
	it("response（带 sequence）：text + definite 分句 + 非最终包", () => {
		const frame = buildServerResponseFrameForTest(
			{
				result: {
					text: "你好世界，today",
					utterances: [
						{ text: "你好世界，", definite: true },
						{ text: "today", definite: false },
					],
				},
			},
			{ withSeq: true },
		);
		const evt = parseServerMessage(frame);
		expect(evt).toEqual({
			kind: "result",
			text: "你好世界，today",
			definiteUtterances: ["你好世界，"],
			isFinalPacket: false,
		});
	});

	it("最终包 flags=0b0011 → isFinalPacket=true", () => {
		const frame = buildServerResponseFrameForTest(
			{ result: { text: "完毕", utterances: [{ text: "完毕", definite: true }] } },
			{ isLast: true },
		);
		const evt = parseServerMessage(frame);
		expect(evt?.kind).toBe("result");
		if (evt?.kind === "result") expect(evt.isFinalPacket).toBe(true);
	});

	it("错误帧解析 code/message", () => {
		const frame = buildServerErrorFrameForTest(45000001, "invalid param");
		expect(parseServerMessage(frame)).toEqual({
			kind: "error",
			code: 45000001,
			message: "invalid param",
		});
	});

	it("非法/过短数据返回 null", () => {
		expect(parseServerMessage(Buffer.alloc(2))).toBeNull();
		expect(parseServerMessage(Buffer.from("notaframe"))).toBeNull();
	});
});
