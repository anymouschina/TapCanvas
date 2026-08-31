const MANUAL_OPERATION_MARKER = "-- tapcanvas:manual-operation";
const FAILED_ASSERTION_RECOVERY_PREFIX = "-- tapcanvas:recover-failed-assertion=";

export function parseManualOperationRecoveryContract(migrationName, migrationSql) {
	if (!migrationSql.includes(MANUAL_OPERATION_MARKER)) return null;
	const signatures = migrationSql
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith(FAILED_ASSERTION_RECOVERY_PREFIX))
		.map((line) => line.slice(FAILED_ASSERTION_RECOVERY_PREFIX.length).trim())
		.filter(Boolean);
	if (signatures.length !== 1) {
		throw new Error(
			`manual-operation migration must declare exactly one failed assertion signature: ${migrationName}`,
		);
	}
	return { migrationName, failedAssertionSignature: signatures[0] };
}

export function selectRecoverableManualOperationFailures(failedRows, contracts) {
	return failedRows.filter((row) => {
		const migrationName = String(row.migration_name ?? "");
		const contract = contracts.get(migrationName);
		if (!contract) return false;
		return String(row.logs ?? "").includes(contract.failedAssertionSignature);
	});
}
