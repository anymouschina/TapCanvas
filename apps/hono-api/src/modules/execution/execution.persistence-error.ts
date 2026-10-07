import { isTransientDatabaseConflictError, readDatabaseErrorCodes } from "../../platform/node/database-read-retry";

/** Only database ledger operations may create this error; never a provider call. */
export class WorkflowPersistenceError extends Error {
	readonly recoverable: boolean;
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "WorkflowPersistenceError";
		this.recoverable = isTransientDatabaseConflictError(cause)
			|| readDatabaseErrorCodes(cause).includes("P2028");
	}
}
