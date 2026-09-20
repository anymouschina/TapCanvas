type NodeData = Record<string, unknown>;

const SUBMISSION_SETTING_KEYS = [
	"vendor", "videoTaskKind", "prompt", "videoModel", "billingSpecKey",
	"videoResolution", "resolution", "videoDurationSeconds", "durationSeconds",
	"videoSize", "size", "aspectRatio", "aspect", "referenceVideoDurationSeconds",
] as const;

/** Freeze the accepted request before a user changes the editable node settings. */
export function preserveSubmittedMediaSettings(persisted: NodeData, authoring: NodeData): NodeData {
	if (persisted.workflowSubmittedSettings) return { workflowSubmittedSettings: persisted.workflowSubmittedSettings };
	const taskId = persisted.videoTaskId || persisted.taskId;
	if (typeof taskId !== "string" || !taskId.trim()) return {};
	if (!SUBMISSION_SETTING_KEYS.some((key) => persisted[key] !== authoring[key])) return {};
	const settings: NodeData = {};
	for (const key of SUBMISSION_SETTING_KEYS) {
		if (Object.prototype.hasOwnProperty.call(persisted, key)) settings[key] = persisted[key];
	}
	return { workflowSubmittedSettings: settings };
}

/** Until the first edit, node settings still describe the submitted request. */
export function readSubmittedMediaSettings(data: NodeData): NodeData {
	const submitted = data.workflowSubmittedSettings;
	return submitted !== null && typeof submitted === "object" && !Array.isArray(submitted)
		? submitted as NodeData
		: data;
}
