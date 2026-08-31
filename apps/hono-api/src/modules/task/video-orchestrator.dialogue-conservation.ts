type DialogueContractLine = {
	lineId: string;
	speakerName: string;
	text: string;
	delivery?: "on_screen" | "off_screen" | "voice_over";
};

export function countDialogueCapacityCharacters(value: string): number {
	return Array.from(value).filter((character) => !/[\p{P}\p{Z}\s]/u.test(character)).length;
}

function containsExactSpokenText(value: unknown, spokenText: string): boolean {
	return typeof value === "string" && spokenText.length > 0 && value.indexOf(spokenText) >= 0;
}

export function validateSpokenTextAbsentFromControlFields(input: {
	fields: readonly Readonly<{ path: string; value: unknown }>[];
	dialogueScript: readonly DialogueContractLine[];
}): string[] {
	const issues: string[] = [];
	for (const line of input.dialogueScript) {
		for (const field of input.fields) {
			if (containsExactSpokenText(field.value, line.text)) {
				issues.push(`${field.path} 不得重复 lineId=${line.lineId} 的逐字正文；控制字段必须保持静默`);
			}
		}
	}
	return issues;
}

/**
 * Prove that the independent speech timeline reconstructs the frozen ledger
 * exactly once. Visual cuts are intentionally absent from this proof.
 */
export function validateShotDialogueConservation(input: {
	clip: Record<string, unknown>;
	dialogueScript: readonly DialogueContractLine[];
}): string[] {
	const issues: string[] = [];
	const events = Array.isArray(input.clip.speechEvents) ? input.clip.speechEvents : [];
	const expectedById = new Map(
		input.dialogueScript.map((line, index) => [line.lineId, { line, index }] as const),
	);
	const seenLineIds = new Set<string>();
	let previousLineIndex = -1;

	events.forEach((rawEvent, eventIndex) => {
		if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return;
		const event = rawEvent as Record<string, unknown>;
		const lineId = typeof event.lineId === "string" ? event.lineId.trim() : "";
		const spokenText = typeof event.spokenText === "string" ? event.spokenText : "";
		const speakerName = typeof event.speakerName === "string" ? event.speakerName.trim() : "";
		const expected = expectedById.get(lineId);
		if (!expected) {
			issues.push(`speechEvents[${eventIndex}].lineId=${lineId} 不属于冻结人声脚本`);
			return;
		}
		if (seenLineIds.has(lineId)) issues.push(`speechEvents[${eventIndex}].lineId=${lineId} 重复承载`);
		seenLineIds.add(lineId);
		if (expected.index < previousLineIndex) issues.push(`speechEvents[${eventIndex}] 的台词顺序回退到 lineId=${lineId}`);
		previousLineIndex = Math.max(previousLineIndex, expected.index);
		if (speakerName !== expected.line.speakerName) {
			issues.push(`speechEvents[${eventIndex}].speakerName 必须等于 ${JSON.stringify(expected.line.speakerName)}`);
		}
		if (expected.line.delivery !== undefined && event.delivery !== expected.line.delivery) {
			issues.push(`speechEvents[${eventIndex}].delivery 必须等于 ${expected.line.delivery}`);
		}
		if (spokenText !== expected.line.text) {
			issues.push(`lineId=${lineId} 必须逐字还原原文；期望 ${JSON.stringify(expected.line.text)}，实收 ${JSON.stringify(spokenText)}`);
		}
	});

	for (const line of input.dialogueScript) {
		if (!seenLineIds.has(line.lineId)) issues.push(`lineId=${line.lineId} 缺少唯一 speech event`);
	}
	if (input.dialogueScript.length === 0 && events.length > 0) {
		issues.push("冻结人声脚本为空时禁止 writer 新增任何人声");
	}
	return issues;
}
