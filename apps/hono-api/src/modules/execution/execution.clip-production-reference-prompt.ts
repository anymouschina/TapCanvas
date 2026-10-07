import type { ClipProductionSpeechEvent } from "../../../../../packages/schemas/clip-production-packet/index.mjs";

export type ClipProductionReferenceBinding = Readonly<{
	nodeId: string;
	name: string;
	referenceType: string;
}>;

export type ClipProductionReferenceImage = Readonly<{
	sourceNodeIds: readonly string[];
}>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value;
}

/** Read the persisted binding contract without deriving labels from prompt prose or IDs. */
export function parseClipProductionReferenceBindings(value: unknown): readonly ClipProductionReferenceBinding[] {
	if (!Array.isArray(value)) throw new Error("workflowReferenceBindings must be an array");
	const seenNodeIds = new Set<string>();
	return value.map((item, index) => {
		if (!record(item)) throw new Error(`workflowReferenceBindings[${index}] must be an object`);
		const nodeId = requiredString(item.nodeId, `workflowReferenceBindings[${index}].nodeId`);
		const name = requiredString(item.name, `workflowReferenceBindings[${index}].name`);
		const referenceType = requiredString(item.referenceType, `workflowReferenceBindings[${index}].referenceType`);
		if (seenNodeIds.has(nodeId)) throw new Error(`workflowReferenceBindings contains duplicate nodeId ${nodeId}`);
		seenNodeIds.add(nodeId);
		return { nodeId, name, referenceType };
	});
}

/**
 * Build the exact suffix that labels each bound image by its position in the ordered provider manifest.
 * `sourceNodeIds` is the only matching authority; names and prompt text are never used to guess identity.
 */
export function renderClipProductionReferenceHeader(input: Readonly<{
	bindings: readonly ClipProductionReferenceBinding[];
	images: readonly ClipProductionReferenceImage[];
}>): string {
	const bindings = parseClipProductionReferenceBindings(input.bindings);
	const imageIndexesByNodeId = new Map<string, number[]>();
	for (const [imageIndex, image] of input.images.entries()) {
		if (!Array.isArray(image.sourceNodeIds)) throw new Error(`provider images[${imageIndex}].sourceNodeIds must be an array`);
		const sourceNodeIds = new Set(image.sourceNodeIds.map((nodeId, sourceIndex) =>
			requiredString(nodeId, `provider images[${imageIndex}].sourceNodeIds[${sourceIndex}]`)));
		for (const nodeId of sourceNodeIds) {
			const indexes = imageIndexesByNodeId.get(nodeId) ?? [];
			indexes.push(imageIndex);
			imageIndexesByNodeId.set(nodeId, indexes);
		}
	}

	const resolved = bindings.map((binding) => {
		const indexes = imageIndexesByNodeId.get(binding.nodeId) ?? [];
		if (indexes.length === 0) throw new Error(`Provider image manifest is missing planned reference node ${binding.nodeId}`);
		if (indexes.length !== 1) throw new Error(`Provider image manifest has ambiguous matches for planned reference node ${binding.nodeId}`);
		return { binding, imageIndex: indexes[0]! };
	}).sort((left, right) => left.imageIndex - right.imageIndex);

	if (resolved.length === 0) return "";
	const namesByImage = new Map<number, string[]>();
	for (const { binding, imageIndex } of resolved) {
		const names = namesByImage.get(imageIndex) ?? [];
		names.push(binding.name);
		namesByImage.set(imageIndex, names);
	}
	return `参考：${[...namesByImage].map(([index, names]) => `图${index + 1}=${names.join("、")}`).join("，")}。`;
}

/** Render the project's explicit style lock as the prompt's first line. */
export function renderClipProductionStyleLine(stylePrompt: string | null | undefined): string {
	const text = typeof stylePrompt === "string" ? stylePrompt.replace(/\s*[\r\n\u2028\u2029]+\s*/g, "").trim() : "";
	return text ? `画风：${text}` : "";
}

/** Render the explicit project style, image legend and authored scene/shot body. */
export function renderClipProductionReferencePrompt(input: Readonly<{
	prompt: string;
	speechEvents?: readonly ClipProductionSpeechEvent[];
	bindings: readonly ClipProductionReferenceBinding[];
	images: readonly ClipProductionReferenceImage[];
	stylePrompt?: string | null;
}>): string {
	if (typeof input.prompt !== "string") throw new Error("prompt must be a string");
	// Dialogue is compiled into its intersecting timeline segment before the
	// packet is normalized. Keep the trace argument at this boundary, but never
	// serialize it as a detached appendix after the audiovisual prompt.
	return [
		renderClipProductionStyleLine(input.stylePrompt),
		renderClipProductionReferenceHeader({ bindings: input.bindings, images: input.images }),
		input.prompt,
	].filter((part) => part.length > 0).join("\n");
}

/** Rebind the prepared prompt suffix to the final ordered provider image manifest, preserving edited body text. */
export function rebindClipProductionReferencePrompt(input: Readonly<{
	prompt: string;
	preparedHeader: string;
	bindings: unknown;
	images: readonly ClipProductionReferenceImage[];
}>): string {
	if (typeof input.prompt !== "string") throw new Error("prompt must be a string");
	if (typeof input.preparedHeader !== "string") throw new Error("workflowReferenceHeader must be a string");
	const bindings = parseClipProductionReferenceBindings(input.bindings);
	if (input.preparedHeader.length === 0 && bindings.length > 0) {
		throw new Error("Prepared prompt is missing its frozen reference header");
	}
	const header = renderClipProductionReferenceHeader({ bindings, images: input.images });
	if (input.preparedHeader.length === 0) return input.prompt;
	// The legend sits where it was prepared (after the style line; older nodes carry it as a "\n\n" suffix).
	const at = input.prompt.indexOf(input.preparedHeader);
	if (at < 0 || input.prompt.indexOf(input.preparedHeader, at + 1) >= 0) {
		throw new Error("Prepared prompt reference header was removed or changed");
	}
	const legacySuffix = input.preparedHeader.startsWith("\n\n") && !header.startsWith("\n\n");
	return `${input.prompt.slice(0, at)}${legacySuffix && header ? `\n\n${header}` : header}${input.prompt.slice(at + input.preparedHeader.length)}`;
}
