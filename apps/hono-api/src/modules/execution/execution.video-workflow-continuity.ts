import {
	parseAssetObjectContracts,
	requiresAuthoringVisualReference,
	type AssetObjectContract,
	type AssetObjectKind,
} from "../task/video-orchestrator.asset-object-contract";

type JsonRecord = Record<string, unknown>;

export type WorkflowClipAssetObjectContract = AssetObjectContract & Readonly<{
	/** Stable identity of a visual authoring plan. Text-only objects omit it. */
	assetId?: string;
}>;

export type WorkflowVisualAssetBinding = Readonly<{
	assetId: string;
	kind: AssetObjectKind;
	name: string;
}>;

export type WorkflowBeatObjectContinuityDiagnostic = Readonly<{
	code: "model_authored_consistency";
	message: string;
}>;

export type WorkflowBeatObjectContinuityInspection = Readonly<{
	contractsByBeat: readonly WorkflowClipAssetObjectContract[][];
	diagnostics: readonly WorkflowBeatObjectContinuityDiagnostic[];
}>;

const REQUIRED_CONTINUITY_FIELDS = [
	"identityInvariant",
	"startState",
	"spatialRelation",
	"driver",
	"stateChange",
	"endState",
] as const;

const COPY_FIELDS = [
	"kind",
	"name",
	"physicalIdentityKey",
	"referenceImageNodeIds",
	"referenceAssetIds",
	"referenceRole",
	"forbiddenTransfer",
	"identityInvariant",
	"startState",
	"spatialRelation",
	"scale",
	"driver",
	"stateChange",
	"endState",
] as const;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function physicalIdentityName(value: Pick<AssetObjectContract, "kind" | "name" | "physicalIdentityKey">): string {
	return value.kind === "character" ? (value.physicalIdentityKey?.trim() || value.name) : value.name;
}

function identityKey(value: Pick<AssetObjectContract, "kind" | "name" | "physicalIdentityKey">): string {
	return JSON.stringify([value.kind, physicalIdentityName(value)]);
}

export function workflowVisualAssetRole(
	contract: Pick<AssetObjectContract, "kind" | "name" | "physicalIdentityKey">,
): string {
	return `${contract.kind}://${physicalIdentityName(contract)}`;
}

/**
 * Parse the one cross-stage object grammar while allowing workflow-only
 * `assetId` to travel beside it. No story meaning is inferred from names.
 */
export function parseWorkflowClipAssetObjectContracts(
	value: unknown,
	field: string,
): WorkflowClipAssetObjectContract[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be a non-empty array`);
	const sanitized = value.map((raw) => {
		if (!isRecord(raw)) return raw;
		return Object.fromEntries(COPY_FIELDS.flatMap((key) => (
			Object.prototype.hasOwnProperty.call(raw, key) ? [[key, raw[key]]] : []
		)));
	});
	const parsed = parseAssetObjectContracts(sanitized, field, {
		allowMissingReferenceImageNodeIds: true,
	});
	if (parsed.errors.length > 0) throw new Error(parsed.errors.join("; "));
	return parsed.contracts.map((contract, index) => {
		const raw = value[index];
		const assetId = isRecord(raw) ? readString(raw.assetId) : "";
		if (contract.kind === "character" && !readString(contract.physicalIdentityKey)) {
			throw new Error(`${field}[${index}].physicalIdentityKey must be a non-empty agent-authored physical identity`);
		}
		for (const requiredField of REQUIRED_CONTINUITY_FIELDS) {
			if (!readString(contract[requiredField])) {
				throw new Error(`${field}[${index}].${requiredField} must be a non-empty frozen continuity fact`);
			}
		}
		return {
			...contract,
			...(assetId ? { assetId } : {}),
		};
	});
}

/**
 * Bind only the objects that genuinely need an authoring image. Props/VFX with
 * referenceRole=none remain in the motion/state ledger without creating the
 * useless production images that previously cluttered the canvas.
 */
export function bindWorkflowClipAssetObjectContracts(input: Readonly<{
	contracts: readonly WorkflowClipAssetObjectContract[];
	assetBindings: readonly WorkflowVisualAssetBinding[];
	field: string;
}>): WorkflowClipAssetObjectContract[] {
	const contractsByIdentity = new Map(input.contracts.map((contract) => [identityKey(contract), contract] as const));
	for (const binding of input.assetBindings) {
		const contract = contractsByIdentity.get(JSON.stringify([binding.kind, binding.name]));
		if (!contract) {
			const expectedVisualRoles = input.contracts
				.filter(requiresAuthoringVisualReference)
				.map(workflowVisualAssetRole);
			throw new Error(
				`${input.field} visual asset ${binding.assetId} has no matching BeatSheet object contract ${binding.kind}:${binding.name}; expected one of ${JSON.stringify(expectedVisualRoles)}`,
			);
		}
		if (!requiresAuthoringVisualReference(contract)) {
			throw new Error(`${input.field} text-only object ${contract.kind}:${contract.name} must not create a visual asset plan`);
		}
	}
	return input.contracts.map((contract) => {
		const matches = input.assetBindings.filter((binding) => (
			JSON.stringify([binding.kind, binding.name]) === identityKey(contract)
		));
		if (matches.length > 1) {
			throw new Error(`${input.field} object ${contract.kind}:${contract.name} has multiple visual asset plans`);
		}
		const binding = matches[0];
		if (requiresAuthoringVisualReference(contract) && !binding) {
			throw new Error(`${input.field} object ${contract.kind}:${contract.name} requires one visual asset plan`);
		}
		if (!requiresAuthoringVisualReference(contract) && binding) {
			throw new Error(`${input.field} text-only object ${contract.kind}:${contract.name} must not create a visual asset plan`);
		}
		return {
			...contract,
			referenceImageNodeIds: [],
			...(binding ? { assetId: binding.assetId } : {}),
		};
	});
}

export function assertExactWorkflowClipAssetObjectContracts(input: Readonly<{
	actual: unknown;
	expected: readonly WorkflowClipAssetObjectContract[];
	field: string;
}>): WorkflowClipAssetObjectContract[] {
	const actual = parseWorkflowClipAssetObjectContracts(input.actual, input.field);
	if (JSON.stringify(actual) !== JSON.stringify(input.expected)) {
		throw new Error(`${input.field} must preserve the frozen BeatSheet object contracts exactly, including order, state facts and assetId`);
	}
	return actual;
}

/**
 * Decode the object ledger needed by downstream executors and record semantic
 * drift in agent-authored continuity prose. Only undecodable structure throws;
 * natural-language consistency never owns workflow completion or retry state.
 */
export function inspectWorkflowBeatObjectContinuity(
	beats: readonly JsonRecord[],
): WorkflowBeatObjectContinuityInspection {
	const parsedByBeat = beats.map((beat, beatIndex) => {
		if (beat.clipIndex !== beatIndex) {
			throw new Error(`beats[${beatIndex}].clipIndex must equal physical order ${beatIndex}`);
		}
		const contracts = parseWorkflowClipAssetObjectContracts(
			beat.assetObjectContracts,
			`beats[${beatIndex}].assetObjectContracts`,
		);
		// Story participation and declared reusable objects are independent facts.
		// Missing character/scene/prop plans are owned by the downstream asset
		// planner with the frozen project snapshot; this continuity verifier only
		// checks the exact object facts that the BeatSheet actually declares.
		return contracts;
	});

	const invariantByIdentity = new Map<string, string>();
	const lastContractByIdentity = new Map<string, WorkflowClipAssetObjectContract>();
	const diagnostics: WorkflowBeatObjectContinuityDiagnostic[] = [];
	parsedByBeat.forEach((contracts, beatIndex) => {
		const representativeByIdentity = new Map<string, WorkflowClipAssetObjectContract>();
		for (const contract of contracts) {
			const key = identityKey(contract);
			const sameBeat = representativeByIdentity.get(key);
			if (sameBeat) {
				const sameBodyFields = [...REQUIRED_CONTINUITY_FIELDS, "scale"] as const;
				const changedField = sameBodyFields.find((field) => readString(sameBeat[field]) !== readString(contract[field]));
				if (changedField) {
					diagnostics.push({
						code: "model_authored_consistency",
						message: `beats[${beatIndex}] character aliases ${sameBeat.name}/${contract.name} sharing physicalIdentityKey=${physicalIdentityName(contract)} do not preserve the same ${changedField}`,
					});
				}
				continue;
			}
			representativeByIdentity.set(key, contract);
		}
		for (const contract of representativeByIdentity.values()) {
			const key = identityKey(contract);
			const invariant = readString(contract.identityInvariant);
			const previousInvariant = invariantByIdentity.get(key);
			if (previousInvariant !== undefined && previousInvariant !== invariant) {
				diagnostics.push({
					code: "model_authored_consistency",
					message: `beats[${beatIndex}] physical object ${contract.kind}:${physicalIdentityName(contract)} changed identityInvariant across clips`,
				});
			}
			invariantByIdentity.set(key, invariant);
			const previous = lastContractByIdentity.get(key);
			if (previous && readString(previous.endState) !== readString(contract.startState)) {
				diagnostics.push({
					code: "model_authored_consistency",
					message: `beats[${beatIndex}] physical object ${contract.kind}:${physicalIdentityName(contract)} startState differs from its previous declared endState`,
				});
			}
			lastContractByIdentity.set(key, contract);
		}
	});
	return { contractsByBeat: parsedByBeat, diagnostics };
}

/**
 * Downstream compatibility entry point. It validates only executable structure
 * and deliberately ignores semantic diagnostics returned by the inspector.
 */
export function validateWorkflowBeatObjectContinuity(
	beats: readonly JsonRecord[],
): readonly WorkflowClipAssetObjectContract[][] {
	return inspectWorkflowBeatObjectContinuity(beats).contractsByBeat;
}

export function validateWorkflowSourceEventCoverage(input: Readonly<{
	coverage: unknown;
	storyEvents: readonly unknown[];
	shots: unknown;
	field: string;
}>): void {
	if (!Array.isArray(input.coverage) || input.coverage.length !== input.storyEvents.length) {
		throw new Error(`${input.field} must contain exactly one entry for every frozen storyEvent`);
	}
	if (!Array.isArray(input.shots) || input.shots.length === 0) {
		throw new Error(`${input.field} requires non-empty shots`);
	}
	const shotNos = new Set(input.shots.map((shot, index) => (
		isRecord(shot) && Number.isInteger(shot.shotNo) ? Number(shot.shotNo) : index + 1
	)));
	input.coverage.forEach((raw, index) => {
		if (!isRecord(raw) || raw.storyEventIndex !== index || !Array.isArray(raw.shotNos) || raw.shotNos.length === 0) {
			throw new Error(`${input.field}[${index}] requires storyEventIndex=${index} and non-empty shotNos`);
		}
		const refs = raw.shotNos.map(Number);
		if (refs.some((shotNo) => !Number.isInteger(shotNo) || !shotNos.has(shotNo))) {
			throw new Error(`${input.field}[${index}].shotNos must reference existing positive shot numbers`);
		}
		if (new Set(refs).size !== refs.length) {
			throw new Error(`${input.field}[${index}].shotNos must not contain duplicates`);
		}
	});
}
