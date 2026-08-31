import DmClient, { SingleSendMailRequest } from "@alicloud/dm20151123";
import * as $OpenApi from "@alicloud/openapi-client";
import * as $Util from "@alicloud/tea-util";

export type AliyunEmailConfig = {
	accessKeyId: string;
	accessKeySecret: string;
	accountName: string;
	fromAlias: string;
};

export function isAliyunEmailConfigured(config: {
	aliyunEmailAccessKeyId: string | null;
	aliyunEmailAccessKeySecret: string | null;
	aliyunEmailFrom: string | null;
}): boolean {
	return Boolean(
		config.aliyunEmailAccessKeyId &&
			config.aliyunEmailAccessKeySecret &&
			config.aliyunEmailFrom,
	);
}

function createAliyunEmailClient(config: AliyunEmailConfig): DmClient {
	return new DmClient(
		new $OpenApi.Config({
			accessKeyId: config.accessKeyId,
			accessKeySecret: config.accessKeySecret,
			endpoint: "dm.aliyuncs.com",
		}),
	);
}

export async function sendAliyunEmail(options: {
	config: AliyunEmailConfig;
	to: string;
	subject: string;
	textBody?: string;
	htmlBody?: string;
}): Promise<{ ok: boolean; requestId: string; errorMessage: string }> {
	const { config, to, subject, textBody, htmlBody } = options;
	const client = createAliyunEmailClient(config);
	const request = new SingleSendMailRequest({
		accountName: config.accountName,
		fromAlias: config.fromAlias,
		toAddress: to,
		subject,
		textBody,
		htmlBody,
		addressType: 1,
		replyToAddress: false,
	});
	const response = await client.singleSendMailWithOptions(
		request,
		new $Util.RuntimeOptions({}),
	);
	const requestId = String(response.body?.requestId || "");
	const ok = response.statusCode === 200;
	return { ok, requestId, errorMessage: ok ? "" : `status ${response.statusCode}` };
}
