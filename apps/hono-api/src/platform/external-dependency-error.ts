/** A missing executable fact, never a semantic quality verdict or retry authorization. */
export class ExternalDependencyError extends Error {
	constructor(
		readonly dependency: Readonly<{
			kind: "model_catalog";
			identity: string;
			field: string;
			code: string;
			observed: unknown;
		}>,
		readonly repairEvidence: Readonly<Record<string, unknown>> = {},
	) {
		super(`${dependency.code}:${dependency.identity}`);
		this.name = "ExternalDependencyError";
	}
}
