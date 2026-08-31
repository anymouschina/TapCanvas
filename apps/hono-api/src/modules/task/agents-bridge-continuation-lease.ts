export type PhysicalContinuationLeaseTakeover = Readonly<{
	version: 1;
	source: "trusted_public_continuation";
	logicalTaskId: string;
}>;

export function buildPhysicalContinuationLeaseTakeover(input: {
	trustedPublicContinuation: boolean;
	logicalTaskId: string;
}): PhysicalContinuationLeaseTakeover | null {
	if (!input.trustedPublicContinuation) return null;
	const logicalTaskId = input.logicalTaskId.trim();
	if (!logicalTaskId) {
		throw new Error("trusted physical continuation requires logicalTaskId");
	}
	return {
		version: 1,
		source: "trusted_public_continuation",
		logicalTaskId,
	};
}

