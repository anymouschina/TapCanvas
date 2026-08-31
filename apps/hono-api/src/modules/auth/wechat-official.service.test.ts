import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { AppContext } from "../../types";
import {
	getWechatOfficialConfig,
	isWechatOfficialEnabled,
	parseWechatOfficialXml,
	verifyWechatOfficialSignature,
} from "./wechat-official.service";

const ENV = {
	WECHAT_OFFICIAL_APP_ID: "wx_test_app",
	WECHAT_OFFICIAL_APP_SECRET: "secret",
	WECHAT_OFFICIAL_TOKEN: "tok_abc",
} as unknown as AppContext["env"];

function sign(token: string, timestamp: string, nonce: string): string {
	return crypto
		.createHash("sha1")
		.update([token, timestamp, nonce].sort().join(""))
		.digest("hex");
}

describe("isWechatOfficialEnabled", () => {
	it("is disabled unless all three credentials are present", () => {
		expect(isWechatOfficialEnabled(ENV)).toBe(true);
		expect(
			isWechatOfficialEnabled({ ...ENV, WECHAT_OFFICIAL_TOKEN: "" } as typeof ENV),
		).toBe(false);
		expect(isWechatOfficialEnabled({} as typeof ENV)).toBe(false);
	});
});

describe("verifyWechatOfficialSignature", () => {
	it("accepts a signature computed the way WeChat does (sha1 of sorted token/ts/nonce)", () => {
		const ts = "1784100000";
		const nonce = "abc123";
		expect(
			verifyWechatOfficialSignature(ENV, sign("tok_abc", ts, nonce), ts, nonce),
		).toBe(true);
	});

	it("rejects a signature made with a different token", () => {
		const ts = "1784100000";
		const nonce = "abc123";
		expect(
			verifyWechatOfficialSignature(ENV, sign("wrong_token", ts, nonce), ts, nonce),
		).toBe(false);
	});

	it("rejects when any part is missing", () => {
		expect(verifyWechatOfficialSignature(ENV, undefined, "1", "n")).toBe(false);
		expect(verifyWechatOfficialSignature(ENV, "sig", undefined, "n")).toBe(false);
		expect(verifyWechatOfficialSignature(ENV, "sig", "1", undefined)).toBe(false);
	});

	it("rejects everything when no token is configured (fail closed)", () => {
		const noToken = { ...ENV, WECHAT_OFFICIAL_TOKEN: "" } as typeof ENV;
		const ts = "1784100000";
		const nonce = "abc123";
		expect(verifyWechatOfficialSignature(noToken, sign("", ts, nonce), ts, nonce)).toBe(
			false,
		);
	});
});

describe("parseWechatOfficialXml", () => {
	it("extracts CDATA and plain fields from a SCAN event", () => {
		const parsed = parseWechatOfficialXml(`<xml>
<ToUserName><![CDATA[gh_official]]></ToUserName>
<FromUserName><![CDATA[o_open_id_123]]></FromUserName>
<CreateTime>1784100000</CreateTime>
<MsgType><![CDATA[event]]></MsgType>
<Event><![CDATA[SCAN]]></Event>
<EventKey><![CDATA[tclogin_deadbeef]]></EventKey>
</xml>`);

		expect(parsed.MsgType).toBe("event");
		expect(parsed.Event).toBe("SCAN");
		expect(parsed.EventKey).toBe("tclogin_deadbeef");
		expect(parsed.FromUserName).toBe("o_open_id_123");
		expect(parsed.CreateTime).toBe("1784100000");
	});

	it("returns an empty object for blank or non-string input", () => {
		expect(parseWechatOfficialXml("")).toEqual({});
		expect(parseWechatOfficialXml("   ")).toEqual({});
		expect(parseWechatOfficialXml(undefined as unknown as string)).toEqual({});
	});
});

// 未关注用户扫码走 SUBSCRIBE，EventKey 带 qrscene_ 前缀；已关注走 SCAN，不带。
// 两者剥前缀后必须得到同一个 sceneKey，否则新用户扫码永远匹配不到会话。
describe("scene key 提取（SUBSCRIBE 的 qrscene_ 前缀差异）", () => {
	function sceneKeyOf(xml: string): string {
		const msg = parseWechatOfficialXml(xml);
		const raw = msg.EventKey || "";
		return String(msg.Event).toUpperCase() === "SUBSCRIBE"
			? raw.replace(/^qrscene_/, "")
			: raw;
	}

	it("strips qrscene_ on SUBSCRIBE but not on SCAN", () => {
		const subscribe = sceneKeyOf(
			`<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event><EventKey><![CDATA[qrscene_tclogin_ff01]]></EventKey></xml>`,
		);
		const scan = sceneKeyOf(
			`<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[SCAN]]></Event><EventKey><![CDATA[tclogin_ff01]]></EventKey></xml>`,
		);
		expect(subscribe).toBe("tclogin_ff01");
		expect(scan).toBe("tclogin_ff01");
		expect(subscribe).toBe(scan);
	});
});

describe("getWechatOfficialConfig", () => {
	it("clamps qr expiry into WeChat's allowed 60s~30d window", () => {
		expect(
			getWechatOfficialConfig({ ...ENV, WECHAT_OFFICIAL_QR_EXPIRE_SECONDS: "1" } as typeof ENV)
				.qrExpireSeconds,
		).toBe(60);
		expect(
			getWechatOfficialConfig({
				...ENV,
				WECHAT_OFFICIAL_QR_EXPIRE_SECONDS: "99999999",
			} as typeof ENV).qrExpireSeconds,
		).toBe(2592000);
		expect(
			getWechatOfficialConfig({ ...ENV, WECHAT_OFFICIAL_QR_EXPIRE_SECONDS: "abc" } as typeof ENV)
				.qrExpireSeconds,
		).toBe(600);
	});
});
