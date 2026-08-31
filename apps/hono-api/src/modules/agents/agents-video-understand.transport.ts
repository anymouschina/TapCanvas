import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { WorkerEnv } from "../../types";
import {
	createObjectStorageClientFromConfig,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";

const MODEL_INPUT_URL_TTL_SECONDS = 3_600;

/**
 * 为模型读取代理片生成对象存储数据面的短期 URL。正式画布资产仍使用 publicBase URL；
 * 这个带签名地址只存在于单次上游请求内，禁止写入节点、trace 或返回给浏览器。
 */
export async function createVideoUnderstandingModelInputUrl(input: {
	env: WorkerEnv;
	objectKey: string;
}): Promise<string> {
	const objectKey = input.objectKey.trim();
	if (!objectKey) throw new Error("视频理解代理缺少对象存储 key");
	const storage = resolveObjectStorageConfig(input.env);
	if (!storage) throw new Error("对象存储未配置，无法签发视频理解读取地址");
	const signedUrl = await getSignedUrl(
		createObjectStorageClientFromConfig(storage),
		new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }),
		{ expiresIn: MODEL_INPUT_URL_TTL_SECONDS },
	);
	let parsed: URL;
	try {
		parsed = new URL(signedUrl);
	} catch {
		throw new Error("对象存储返回了无效的视频理解读取地址");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("视频理解读取地址必须使用 https");
	}
	return parsed.toString();
}
