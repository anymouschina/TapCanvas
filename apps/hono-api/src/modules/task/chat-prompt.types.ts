import type { StoryboardSelectionContext } from "../storyboard/storyboardSelectionProtocol";
import type { PublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import type { PublicFlowAnchorBinding } from "../flow/flow.anchor-bindings";

export type ChatPromptSkill = {
	id: string;
	source: "system" | "user" | "marketplace";
	key: string | null;
	name: string | null;
};

export type PersonaContextFile = {
	name: "IDENTITY.md" | "SOUL.md";
	path: string;
	content: string;
};

export type PersonaIdentity = {
	name: string | null;
	product: string | null;
	role: string | null;
};

export type PublicChatReferenceImageSlot = {
	slot: string;
	url: string;
	referenceId?: string | null;
	nodeId?: string | null;
	assetId?: string | null;
	assetRefId?: string | null;
	role: string | null;
	label: string | null;
	note: string | null;
};

export type PublicChatPromptContext = {
	generationProposal?: {
		version: 1;
		proposalId: string;
		kind: "image" | "video" | "audio" | "prompt";
		title: string;
		prompt: string;
		model?: string;
		parameters: Array<{ label: string; value: string }>;
		action: string | null;
		nodeId: string | null;
	} | null;
	currentProjectName: string | null;
	chatMode: "creative" | null;
	creativePhase: "prep" | "writing" | null;
	workspaceAction?:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	currentBookId?: string | null;
	currentChapterId?: string | null;
	skill: ChatPromptSkill | null;
	referenceImageCount: number;
	referenceImageSlots: PublicChatReferenceImageSlot[];
	assetRoleSummary: string[];
	hasTargetImage: boolean;
	hasSelectedNode: boolean;
	selectedNodeId: string | null;
	selectedNodeLabel: string | null;
	selectedNodeKind: string | null;
	selectedNodeTextPreview: string | null;
	enabledModelCatalogSummary?: PublicChatEnabledModelCatalogSummary | null;
	enabledModelCatalogSummaryError?: string | null;
	selectedReference: {
		nodeId: string | null;
		label: string | null;
		kind: string | null;
		anchorBindings?: PublicFlowAnchorBinding[];
		roleName?: string | null;
		roleCardId?: string | null;
		imageUrl: string | null;
		sourceUrl: string | null;
		bookId: string | null;
		chapterId: string | null;
		shotNo: number | null;
		productionLayer: string | null;
		creationStage: string | null;
		approvalStatus: string | null;
		authorityBaseFrameNodeId?: string | null;
		authorityBaseFrameStatus?: "planned" | "confirmed" | null;
		hasUpstreamTextEvidence: boolean;
		hasDownstreamComposeVideo: boolean;
		storyboardSelectionContext: StoryboardSelectionContext | null;
	} | null;
};
