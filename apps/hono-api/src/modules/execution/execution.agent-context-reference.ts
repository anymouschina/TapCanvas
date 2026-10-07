type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as RecordValue
		: null;
}

function stringField(value: RecordValue, key: string): string {
	return typeof value[key] === "string" ? (value[key] as string) : "";
}

/** The frozen artifact stays complete; only the model-facing copy shares an exact source body. */
export function projectAcceptedTurnBodyReference(value: unknown): unknown {
	const facts = record(value);
	const request = facts && record(facts.userRequest);
	if (!facts || !request || !Array.isArray(facts.authoritativeSources)) return value;
	const requestId = stringField(request, "requestId").trim();
	const fingerprint = stringField(request, "requestFingerprint").trim();
	const content = stringField(request, "content");
	if (!requestId || !fingerprint || !content) return value;
	const sourceIndex = facts.authoritativeSources.findIndex((candidate) => {
		const source = record(candidate);
		return source
			&& stringField(source, "sourceId").trim() === requestId
			&& stringField(source, "sourceFingerprint").trim() === fingerprint
			&& stringField(source, "content") === content;
	});
	if (sourceIndex < 0) return value;
	const { content: _duplicateContent, ...requestFacts } = request;
	return {
		...facts,
		userRequest: {
			...requestFacts,
			contentSource: { sourceId: requestId, sourceFingerprint: fingerprint, sourceIndex },
		},
	};
}

/** Return a path only when the exact accepted body remains visible in the projected prompt. */
export function findVisibleAcceptedTurnContentPath(
	request: RecordValue,
	promptInputs: Readonly<Record<string, readonly unknown[]>>,
): string | null {
	const content = stringField(request, "content");
	const requestId = stringField(request, "requestId").trim();
	const fingerprint = stringField(request, "requestFingerprint").trim();
	if (!content) return null;
	const visit = (value: unknown, path: string, depth: number): string | null => {
		if (depth > 12) return null;
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index += 1) {
				const found = visit(value[index], `${path}[${index}]`, depth + 1);
				if (found) return found;
			}
			return null;
		}
		const candidate = record(value);
		if (!candidate) return null;
		if (stringField(candidate, "kind") === "public_chat_turn"
			&& stringField(candidate, "content") === content
			&& stringField(candidate, "requestId").trim() === requestId) return path;
		if (requestId && fingerprint
			&& stringField(candidate, "sourceId").trim() === requestId
			&& stringField(candidate, "sourceFingerprint").trim() === fingerprint
			&& stringField(candidate, "content") === content) return path;
		for (const [key, child] of Object.entries(candidate)) {
			const found = visit(child, `${path}.${key}`, depth + 1);
			if (found) return found;
		}
		return null;
	};
	for (const [port, values] of Object.entries(promptInputs)) {
		const found = visit(values, port, 0);
		if (found) return found;
	}
	return null;
}
