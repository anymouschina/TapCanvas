export type ClipReferenceBudgetValidation =
	| {
			ok: true;
			businessReferenceImages: string[];
			totalReferenceImages: string[];
	  }
	| {
			ok: false;
			code: "business_reference_limit_exceeded";
			clipIndex: number;
			actualBusinessReferences: number;
			maximumBusinessReferences: number;
			message: string;
	  };

export type OrchestratedSd2Reference = {
	url: string;
	purpose: string;
	role: string;
};

export type OrchestratedSd2ReferenceValidation =
	| { ok: true }
	| {
			ok: false;
			code:
				| "orchestrated_sd2_storyboard_reference_invalid"
				| "clip_reference_budget_exceeded"
				| "orchestrated_sd2_frame_role_forbidden";
			message: string;
			details: Record<string, unknown>;
	  };

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

function uniqueHttpUrls(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const value of values) {
		const url = String(value ?? "").trim();
		if (!url || !isHttpUrl(url) || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
	}
	return urls;
}

/** One SD2 clip may consume the model's full reference-image budget with real clip dependencies. */
export function validateSd2ClipReferenceBudget(input: {
	clipIndex: number;
	businessReferenceImages: readonly string[];
	maximumBusinessReferences: number;
}): ClipReferenceBudgetValidation {
	const maximumBusinessReferences = input.maximumBusinessReferences;
	if (!Number.isInteger(maximumBusinessReferences) || Number(maximumBusinessReferences) < 0) {
		throw new Error("reference_image_policy_required");
	}
	const businessReferenceImages = uniqueHttpUrls(input.businessReferenceImages);
	if (businessReferenceImages.length > Number(maximumBusinessReferences)) {
		return {
			ok: false,
			code: "business_reference_limit_exceeded",
			clipIndex: input.clipIndex,
			actualBusinessReferences: businessReferenceImages.length,
			maximumBusinessReferences: Number(maximumBusinessReferences),
			message:
				`镜${input.clipIndex} 的真实业务图片依赖为 ${businessReferenceImages.length} 张，` +
				`超过当前模型可用的 ${Number(maximumBusinessReferences)} 个业务槽；禁止静默丢弃引用`,
		};
	}
	return {
		ok: true,
		businessReferenceImages,
		totalReferenceImages: businessReferenceImages,
	};
}

/** Final paid-submission boundary for an orchestrated SD2 clip. */
export function validateOrchestratedSd2References(input: {
	clipIndex: number;
	references: readonly OrchestratedSd2Reference[];
	maximumBusinessReferences: number;
}): OrchestratedSd2ReferenceValidation {
	const business = [...input.references];
	const storyboards = business.filter((reference) => reference.purpose === "storyboard");
	if (storyboards.length > 1) {
		return {
			ok: false,
			code: "orchestrated_sd2_storyboard_reference_invalid",
			message: `SD2 V3 编排镜至多包含 1 张按需关键帧/故事板图片，实收 ${storyboards.length} 张`,
			details: { actual: storyboards.length, maximum: 1 },
		};
	}
	const budget = validateSd2ClipReferenceBudget({
		clipIndex: input.clipIndex,
		businessReferenceImages: business.map((reference) => reference.url),
		maximumBusinessReferences: input.maximumBusinessReferences,
	});
	if (!budget.ok) {
		return {
			ok: false,
			code: "clip_reference_budget_exceeded",
			message: budget.message,
			details: { ...budget },
		};
	}
	const frameRoles = input.references.filter(
		(reference) => reference.role !== "reference_image",
	);
	if (frameRoles.length) {
		return {
			ok: false,
			code: "orchestrated_sd2_frame_role_forbidden",
			message: "SD2 整章编排中的 clip 故事板与精选资产必须作为普通参考图，禁止升级为首帧或尾帧",
			details: { references: frameRoles },
		};
	}
	return { ok: true };
}
