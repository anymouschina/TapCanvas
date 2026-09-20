import { orderClipReferenceEntries } from "./execution.clip-reference-selection";
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
	/** Multiple selected visual plans for this one physical object. */
	assetIds?: readonly string[];
}>;

export type WorkflowVisualAssetBinding = Readonly<{
	assetId: string;
	kind: AssetObjectKind;
	name: string;
	nodeId?: string;
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
		const assetIds = isRecord(raw) ? raw.assetIds : undefined;
		if (assetIds !== undefined && (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== "string" || !id.trim()))) {
			throw new Error(`${field}[${index}].assetIds must contain non-empty plan identities`);
		}
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
			...(Array.isArray(assetIds) ? { assetIds: assetIds.map((id: string) => id.trim()) } : {}),
		};
	});
}

/**
 * Bind only the objects that genuinely need an authoring image. Props/VFX with
 * referenceRole=none remain in the motion/state ledger without creating the
 * useless production images that previously cluttered the canvas.
 */
/**
 * 一个合同可被绑定匹配的身份键集合。
 *
 * 资产计划与绑定按 `kind://physicalIdentityName` 命名（角色用 `physicalIdentityKey`），
 * 而 `assetObjectContracts[].name` 保留显示名。两处只比一种写法会让"计划角色用物理身份键、
 * 合同 name 用显示名"这种正常产物在 clip 阶段被判成"没有资产计划"——ch2 实测 25/30 段因此失败，
 * 报 `character:白真真 requires one visual asset plan`，而计划与已生成资产其实都在。
 * 这里同时接受物理身份键与显示名两种**精确**写法；不做模糊匹配、不做大小写或空白归一。
 */
function contractBindingIdentities(
	contract: Pick<AssetObjectContract, "kind" | "name" | "physicalIdentityKey">,
): readonly string[] {
	return [...new Set([
		JSON.stringify([contract.kind, physicalIdentityName(contract)]),
		JSON.stringify([contract.kind, contract.name]),
	])];
}

export function bindWorkflowClipAssetObjectContracts(input: Readonly<{
	contracts: readonly WorkflowClipAssetObjectContract[];
	assetBindings: readonly WorkflowVisualAssetBinding[];
	field: string;
}>): WorkflowClipAssetObjectContract[] {
	const identitiesByContract = new Map(
		input.contracts.map((contract) => [contract, new Set(contractBindingIdentities(contract))] as const),
	);
	const findContractForBinding = (binding: WorkflowVisualAssetBinding) => {
		const bindingIdentity = JSON.stringify([binding.kind, binding.name]);
		for (const [contract, identities] of identitiesByContract) {
			if (identities.has(bindingIdentity)) return contract;
		}
		return undefined;
	};
	for (const binding of input.assetBindings) {
		const contract = findContractForBinding(binding);
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
		const identities = identitiesByContract.get(contract) ?? new Set(contractBindingIdentities(contract));
		const matches = orderClipReferenceEntries(input.assetBindings.filter((binding) => (
			identities.has(JSON.stringify([binding.kind, binding.name]))
		)), [contract]);
		if (new Set(matches.map((binding) => binding.assetId)).size !== matches.length) {
			throw new Error(`${input.field} object ${contract.kind}:${contract.name} has duplicate visual asset bindings`);
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
			referenceImageNodeIds: [...new Set([
				...contract.referenceImageNodeIds, ...matches.flatMap((match) => match.nodeId ? [match.nodeId] : []),
			])],
			...(matches.length === 1 && binding ? { assetId: binding.assetId } : {}),
			...(matches.length > 1 ? { assetIds: matches.map((match) => match.assetId) } : {}),
		};
	});
}

export function assertExactWorkflowClipAssetObjectContracts(input: Readonly<{
	actual: unknown;
	expected: readonly WorkflowClipAssetObjectContract[];
	field: string;
}>): WorkflowClipAssetObjectContract[] {
	const actual = parseWorkflowClipAssetObjectContracts(input.actual, input.field);
	// Image references are execution-scoped bindings, not BeatSheet-authored
	// continuity facts.  The clip writer may echo the concrete generated canvas
	// node ids after it has seen the asset bindings; those ids are re-derived by
	// the host from the validated asset plan before video submission.  Compare
	// the frozen semantic/object contract and stable asset identity while
	// intentionally ignoring those runtime reference handles.
	const stripRuntimeBindings = (value: WorkflowClipAssetObjectContract): Record<string, unknown> =>
		Object.fromEntries(Object.entries(value).filter(([key]) => (
			key !== "referenceImageNodeIds" && key !== "referenceAssetIds" && key !== "assetIds"
		)));
	const expectedFrozen = input.expected.map(stripRuntimeBindings);
	// `assetId` is a host-owned binding.  Current writers omit it (the host
	// projects it from the materialized asset plan), while older/runtime writers
	// may echo the same value.  Accept the omission and project the frozen value;
	// any non-empty value still has to match exactly, so an invented binding is
	// never accepted.
	const normalizedActual = actual.map((contract, index) => {
		const expected = input.expected[index];
		const expectedAssetId = readString(expected?.assetId);
		const actualAssetId = readString(contract.assetId);
		if (!actualAssetId && expectedAssetId) return { ...contract, assetId: expectedAssetId };
		return contract;
	});
	const actualFrozen = normalizedActual.map(stripRuntimeBindings);
	if (JSON.stringify(actualFrozen) !== JSON.stringify(expectedFrozen)) {
		throw new Error(`${input.field} must preserve the frozen BeatSheet object contracts exactly, including order, state facts and assetId`);
	}
	return normalizedActual;
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
