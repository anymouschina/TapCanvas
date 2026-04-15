import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { AppContext } from "../../types";

function trimTrailingSlashes(raw: string | null | undefined): string {
	const value = (raw || "").trim();
	return value ? value.replace(/\/+$/, "") : "";
}

export function resolveRequiredVendorHttpContext(
	ctx: { baseUrl: string; apiKey: string },
	options: {
		errorMessage: string;
		errorCode: string;
		fallbackBaseUrl?: string;
	},
): { baseUrl: string; apiKey: string } {
	const baseUrl =
		trimTrailingSlashes(ctx.baseUrl) ||
		trimTrailingSlashes(options.fallbackBaseUrl || "");
	const apiKey = (ctx.apiKey || "").trim();
	if (!baseUrl || !apiKey) {
		throw new AppError(options.errorMessage, {
			status: 400,
			code: options.errorCode,
		});
	}
	return { baseUrl, apiKey };
}

export async function fetchJsonWithDebug(
	c: AppContext,
	input: {
		url: string;
		init: RequestInit;
		tag: string;
		requestFailedMessage: string;
		requestFailedCode: string;
	},
): Promise<{ response: Response; data: any }> {
	let response: Response;
	let data: any = null;
	try {
		response = await fetchWithHttpDebugLog(c, input.url, input.init, { tag: input.tag });
		try {
			data = await response.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError(input.requestFailedMessage, {
			status: 502,
			code: input.requestFailedCode,
			details: { message: error?.message ?? String(error) },
		});
	}
	return { response, data };
}

export function extractUpstreamErrorMessage(
	data: any,
	fallback: string,
): string {
	return (
		(data && (data.error?.message || data.message || data.error || data.msg)) ||
		fallback
	);
}
