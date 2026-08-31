import { buildInternalApiKey } from "../apiKey/internal-api-key";

export type TrustedInternalExecutionAuthInput = {
	trustedInternalExecution: boolean;
	internalWorkerToken: string;
	userId: string;
	apiKeyId?: string | null;
};

export function buildTrustedInternalExecutionApiKey(
	input: TrustedInternalExecutionAuthInput,
): string | null {
	if (!input.trustedInternalExecution) return null;
	return buildInternalApiKey(input);
}
