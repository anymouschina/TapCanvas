import DysmsClient, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";
import * as $Util from "@alicloud/tea-util";

export type AliyunSmsConfig = {
	accessKeyId: string;
	accessKeySecret: string;
	signName: string;
	templateCode: string;
	endpoint: string;
};

export function isAliyunSmsConfigured(config: {
	aliyunSmsAccessKeyId: string | null;
	aliyunSmsAccessKeySecret: string | null;
	aliyunSmsSignName: string | null;
	aliyunSmsTemplateCode: string | null;
}): boolean {
	return Boolean(
		config.aliyunSmsAccessKeyId &&
			config.aliyunSmsAccessKeySecret &&
			config.aliyunSmsSignName &&
			config.aliyunSmsTemplateCode,
	);
}

function createAliyunSmsClient(config: AliyunSmsConfig): DysmsClient {
	return new DysmsClient(
		new $OpenApi.Config({
			accessKeyId: config.accessKeyId,
			accessKeySecret: config.accessKeySecret,
			endpoint: config.endpoint,
		}),
	);
}

export async function sendAliyunSmsOtp(options: {
	config: AliyunSmsConfig;
	to: string;
	code: string;
}): Promise<{ ok: boolean; providerCode: string; providerMessage: string }> {
	const { config, to, code } = options;
	const client = createAliyunSmsClient(config);
	const request = new SendSmsRequest({
		phoneNumbers: to,
		signName: config.signName,
		templateCode: config.templateCode,
		templateParam: JSON.stringify({ code }),
	});
	const response = await client.sendSmsWithOptions(
		request,
		new $Util.RuntimeOptions({}),
	);
	const providerCode = String(response.body?.code || "");
	const providerMessage = String(response.body?.message || "");
	return {
		ok: providerCode === "OK",
		providerCode,
		providerMessage,
	};
}
