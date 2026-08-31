import { gzipSync, gunzipSync } from "node:zlib";

/**
 * 火山引擎「豆包流式语音识别」sauc WebSocket 二进制协议封/解包（纯函数层）。
 * 协议文档：https://docs.volcengine.com/docs/6561/1354869
 *
 * 帧结构（整数一律大端）：
 *   4B 固定头：[version<<4|headerSize, msgType<<4|flags, serialization<<4|compression, reserved]
 *   [可选 4B sequence（flags 含 0b0001 时）]
 *   4B payload size + payload（本实现统一 Gzip 压缩）
 */

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // ×4 字节

const MSG_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const MSG_TYPE_AUDIO_ONLY_REQUEST = 0b0010;
const MSG_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const MSG_TYPE_SERVER_ERROR = 0b1111;

const FLAG_NONE = 0b0000;
const FLAG_POSITIVE_SEQ = 0b0001;
const FLAG_LAST_PACKET = 0b0010;
const FLAG_LAST_WITH_SEQ = 0b0011;

const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;
const COMPRESS_GZIP = 0b0001;

function packFrame(msgType: number, flags: number, serialization: number, payload: Buffer): Buffer {
	const gz = gzipSync(payload);
	const buf = Buffer.alloc(8 + gz.length);
	buf[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE_UNITS;
	buf[1] = (msgType << 4) | flags;
	buf[2] = (serialization << 4) | COMPRESS_GZIP;
	buf[3] = 0x00;
	buf.writeUInt32BE(gz.length, 4);
	gz.copy(buf, 8);
	return buf;
}

/** 首帧 full client request（识别参数 JSON）。 */
export function buildFullClientRequestFrame(payloadJson: object): Buffer {
	return packFrame(
		MSG_TYPE_FULL_CLIENT_REQUEST,
		FLAG_NONE,
		SERIAL_JSON,
		Buffer.from(JSON.stringify(payloadJson), "utf8"),
	);
}

/** 音频帧；isLast=true 时置负包 flag（最后一包，可为空音频）。 */
export function buildAudioFrame(pcm: Buffer, isLast: boolean): Buffer {
	return packFrame(
		MSG_TYPE_AUDIO_ONLY_REQUEST,
		isLast ? FLAG_LAST_PACKET : FLAG_NONE,
		SERIAL_NONE,
		pcm,
	);
}

export type VolcServerEvent =
	| {
			kind: "result";
			/** 当前识别全文（含未定稿部分） */
			text: string;
			/** definite=true 的定稿分句文本（按序） */
			definiteUtterances: string[];
			/** 服务端最终包（flags=0b0011） */
			isFinalPacket: boolean;
	  }
	| { kind: "error"; code: number; message: string };

type SaucUtterance = { text?: unknown; definite?: unknown };
type SaucResponsePayload = { result?: { text?: unknown; utterances?: SaucUtterance[] } };

/** 解析服务端帧；非 response/error 帧返回 null。 */
export function parseServerMessage(data: Buffer): VolcServerEvent | null {
	if (!Buffer.isBuffer(data) || data.length < 4) return null;
	const headerSize = (data[0] & 0x0f) * 4;
	const msgType = data[1] >> 4;
	const flags = data[1] & 0x0f;
	const compressed = (data[2] & 0x0f) === COMPRESS_GZIP;

	if (msgType === MSG_TYPE_SERVER_ERROR) {
		if (data.length < headerSize + 8) return null;
		const code = data.readUInt32BE(headerSize);
		const size = data.readUInt32BE(headerSize + 4);
		let msg = data.subarray(headerSize + 8, headerSize + 8 + size);
		try {
			if (compressed) msg = gunzipSync(msg);
		} catch { /* 保留原始字节兜底 */ }
		return { kind: "error", code, message: msg.toString("utf8") };
	}

	if (msgType !== MSG_TYPE_FULL_SERVER_RESPONSE) return null;
	let off = headerSize;
	if (flags === FLAG_POSITIVE_SEQ || flags === FLAG_LAST_WITH_SEQ) off += 4;
	if (data.length < off + 4) return null;
	const size = data.readUInt32BE(off);
	let payload = data.subarray(off + 4, off + 4 + size);
	try {
		if (compressed) payload = gunzipSync(payload);
	} catch {
		return null;
	}
	let json: SaucResponsePayload;
	try {
		json = JSON.parse(payload.toString("utf8")) as SaucResponsePayload;
	} catch {
		return null;
	}
	const utterances = Array.isArray(json.result?.utterances) ? json.result.utterances : [];
	return {
		kind: "result",
		text: typeof json.result?.text === "string" ? json.result.text : "",
		definiteUtterances: utterances
			.filter((u) => u && u.definite === true && typeof u.text === "string" && u.text)
			.map((u) => String(u.text)),
		isFinalPacket: flags === FLAG_LAST_WITH_SEQ || flags === FLAG_LAST_PACKET,
	};
}

/** 测试辅助：构造一个服务端 full server response 帧（gzip JSON，可带 sequence）。 */
export function buildServerResponseFrameForTest(
	payloadJson: object,
	opts?: { withSeq?: boolean; isLast?: boolean },
): Buffer {
	const gz = gzipSync(Buffer.from(JSON.stringify(payloadJson), "utf8"));
	const withSeq = Boolean(opts?.withSeq);
	const flags = opts?.isLast ? FLAG_LAST_WITH_SEQ : withSeq ? FLAG_POSITIVE_SEQ : FLAG_NONE;
	const seqBytes = flags === FLAG_POSITIVE_SEQ || flags === FLAG_LAST_WITH_SEQ ? 4 : 0;
	const buf = Buffer.alloc(4 + seqBytes + 4 + gz.length);
	buf[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE_UNITS;
	buf[1] = (MSG_TYPE_FULL_SERVER_RESPONSE << 4) | flags;
	buf[2] = (SERIAL_JSON << 4) | COMPRESS_GZIP;
	if (seqBytes) buf.writeUInt32BE(1, 4);
	buf.writeUInt32BE(gz.length, 4 + seqBytes);
	gz.copy(buf, 8 + seqBytes);
	return buf;
}

/** 测试辅助：构造服务端错误帧。 */
export function buildServerErrorFrameForTest(code: number, message: string): Buffer {
	const gz = gzipSync(Buffer.from(message, "utf8"));
	const buf = Buffer.alloc(12 + gz.length);
	buf[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE_UNITS;
	buf[1] = (MSG_TYPE_SERVER_ERROR << 4) | FLAG_NONE;
	buf[2] = (SERIAL_NONE << 4) | COMPRESS_GZIP;
	buf.writeUInt32BE(code, 4);
	buf.writeUInt32BE(gz.length, 8);
	gz.copy(buf, 12);
	return buf;
}

/** 首帧识别参数（bigmodel_async + 二遍识别，中英混合默认）。 */
export function buildSaucRequestPayload(uid: string): object {
	return {
		user: { uid },
		audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
		request: {
			model_name: "bigmodel",
			enable_punc: true,
			enable_itn: true,
			show_utterances: true,
			result_type: "full",
			// 二遍识别（仅 bigmodel_async 支持）：实时逐字上屏 + VAD 判停后终稿重识别，快与准兼得。
			enable_nonstream: true,
			end_window_size: 800,
		},
	};
}
