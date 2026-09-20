type Facts = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Facts {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function commonFacts(records: readonly Facts[]): Facts {
	const first = records[0];
	if (!first || records.length < 2) return {};
	const common: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(first)) {
		// Keep the executable identity on every row, even for duplicate inputs.
		if (key === "assetId" || !records.every((record) => Object.hasOwn(record, key))) continue;
		const values = records.map((record) => record[key]);
		if (values.every((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
			common[key] = value;
		} else if (values.every(isRecord)) {
			const nested = commonFacts(values);
			if (Object.keys(nested).length > 0) common[key] = nested;
		}
	}
	return common;
}

function rowFacts(record: Facts, common: Facts): Facts {
	return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
		if (!Object.hasOwn(common, key)) return [[key, value]];
		if (JSON.stringify(value) === JSON.stringify(common[key])) return [];
		return [[key, isRecord(value) && isRecord(common[key]) ? rowFacts(value, common[key]) : value]];
	}));
}

/** Lossless prompt representation: no ranking, truncation, or omitted candidate. */
export function workflowPromptRecordTable(records: readonly Facts[]) {
	const sharedFacts = commonFacts(records);
	return {
		encoding: "shared-object-fields/v1" as const,
		mergeRule: "Each item recursively overrides sharedFacts; arrays are whole values. All omitted item fields are explicitly present in sharedFacts.",
		sharedFacts,
		items: records.map((record) => rowFacts(record, sharedFacts)),
	};
}
