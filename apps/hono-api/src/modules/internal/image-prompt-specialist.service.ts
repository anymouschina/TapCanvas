import {
	canonicalImagePromptSpecialistJson,
	imagePromptEvidenceDigest,
	parseImagePromptSpecialistRequest,
	parseImagePromptSpecialistResponse,
	type ImagePromptSpecialistErrorCode,
	type ImagePromptSpecialistRequestV1,
	type ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract";
import {
	claimImagePromptIdempotency,
	completeImagePromptIdempotencyFailure,
	completeImagePromptIdempotencySuccess,
	type ImagePromptIdempotencyStore,
} from "./image-prompt-idempotency";
import {
	ImagePromptRelayGrantFailure,
	issueImagePromptRelayGrant,
	type ImagePromptRelayGrantStore,
} from "./image-prompt-relay-grant";
import { InternalAgentsClientFailure } from "./internal-agents-client";

const encoder = new TextEncoder();

type PromptModelBinding = ImagePromptSpecialistRequestV1["promptModel"];

export type ImagePromptSpecialistGatewayDependencies = {
	idempotencyStore: ImagePromptIdempotencyStore;
	relayGrantStore: ImagePromptRelayGrantStore;
	executeAgentsSpecialist(
		request: ImagePromptSpecialistRequestV1,
		relayGrant: string,
		abortSignal?: AbortSignal,
	): Promise<ImagePromptSpecialistResponseV1>;
	now?: () => Date;
};

export class ImagePromptSpecialistGatewayFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "ImagePromptSpecialistGatewayFailure";
		this.code = code;
	}
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function idempotencyFacts(request: ImagePromptSpecialistRequestV1): unknown {
	return {
		...request,
		evidence: {
			...request.evidence,
			references: request.evidence.references.map(({ accessUrl: _accessUrl, ...reference }) => reference),
		},
	};
}

function exactModelBindingMatches(expected: PromptModelBinding, actual: PromptModelBinding): boolean {
	return (
		expected.catalogRecordId === actual.catalogRecordId &&
		expected.modelKey === actual.modelKey &&
		expected.configurationRevision === actual.configurationRevision &&
		expected.providerEndpointVersionId === actual.providerEndpointVersionId &&
		expected.providerCredentialVersionId === actual.providerCredentialVersionId
	);
}

function asGatewayFailure(error: unknown): ImagePromptSpecialistGatewayFailure {
	if (error instanceof ImagePromptSpecialistGatewayFailure) return error;
	if (error instanceof InternalAgentsClientFailure) {
		return new ImagePromptSpecialistGatewayFailure(error.code, error.message);
	}
	if (error instanceof ImagePromptRelayGrantFailure) {
		return new ImagePromptSpecialistGatewayFailure(error.code, error.message);
	}
	return new ImagePromptSpecialistGatewayFailure(
		"specialist_unavailable",
		error instanceof Error ? error.message : String(error),
	);
}

function verifyResponse(
	request: ImagePromptSpecialistRequestV1,
	input: ImagePromptSpecialistResponseV1,
): ImagePromptSpecialistResponseV1 {
	const parsed = parseImagePromptSpecialistResponse(input);
	if (!parsed.ok) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_output_invalid",
			`specialist response is invalid: ${parsed.error}`,
		);
	}
	const response = parsed.value;
	if (
		response.trace.requestId !== request.requestId ||
		response.trace.correlationId !== request.correlationId
	) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_output_invalid",
			"specialist response request identity mismatch",
		);
	}
	if (response.trace.evidenceDigest !== imagePromptEvidenceDigest(request.evidence)) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_evidence_invalid",
			"specialist response evidence digest mismatch",
		);
	}
	if (
		!exactModelBindingMatches(request.promptModel, response.trace.model) ||
		response.trace.model.effectiveModel !== request.promptModel.modelKey
	) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_model_inheritance_failed",
			"specialist response model binding mismatch",
		);
	}
	return response;
}

export async function executeImagePromptSpecialistGateway(
	input: ImagePromptSpecialistRequestV1,
	dependencies: ImagePromptSpecialistGatewayDependencies,
	abortSignal?: AbortSignal,
): Promise<{
	response: ImagePromptSpecialistResponseV1;
	responseDigest: string;
	replayed: boolean;
}> {
	const parsedRequest = parseImagePromptSpecialistRequest(input);
	if (!parsedRequest.ok) {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_request_invalid",
			parsedRequest.error,
		);
	}
	const request = parsedRequest.value;
	const now = dependencies.now ?? (() => new Date());
	const bodyDigest = await sha256Hex(
		canonicalImagePromptSpecialistJson(idempotencyFacts(request)),
	);
	const claim = await claimImagePromptIdempotency(dependencies.idempotencyStore, {
		idempotencyKey: request.idempotencyKey,
		bodyDigest,
		nowIso: now().toISOString(),
	});
	if (claim.kind === "conflict" || claim.kind === "pending") {
		throw new ImagePromptSpecialistGatewayFailure(
			"specialist_idempotency_conflict",
			claim.kind === "pending"
				? "an identical specialist request is still pending"
				: "idempotency key is already bound to different request facts",
		);
	}
	if (claim.kind === "failed") {
		throw new ImagePromptSpecialistGatewayFailure(
			claim.errorCode,
			"the specialist request previously failed; use a new task idempotency key to retry",
		);
	}
	if (claim.kind === "succeeded") {
		return {
			response: claim.response,
			responseDigest: claim.responseDigest,
			replayed: true,
		};
	}

	try {
		const relayGrant = await issueImagePromptRelayGrant(
			dependencies.relayGrantStore,
			{
				correlationId: request.correlationId,
				generationTaskId: request.commercialContext.generationTaskId,
				commercialContext: request.commercialContext,
				promptModel: request.promptModel,
			},
			now(),
		);
		const response = verifyResponse(
			request,
			await dependencies.executeAgentsSpecialist(request, relayGrant.grant, abortSignal),
		);
		const responseDigest = await sha256Hex(canonicalImagePromptSpecialistJson(response));
		await completeImagePromptIdempotencySuccess(dependencies.idempotencyStore, {
			claim: claim.claim,
			response,
			responseDigest,
			completedAt: now().toISOString(),
		});
		return { response, responseDigest, replayed: false };
	} catch (error) {
		const failure = asGatewayFailure(error);
		try {
			await completeImagePromptIdempotencyFailure(dependencies.idempotencyStore, {
				claim: claim.claim,
				errorCode: failure.code,
				completedAt: now().toISOString(),
			});
		} catch (transitionError) {
			throw new ImagePromptSpecialistGatewayFailure(
				"specialist_unavailable",
				`failed to freeze specialist failure evidence: ${
					transitionError instanceof Error ? transitionError.message : String(transitionError)
				}`,
			);
		}
		throw failure;
	}
}
