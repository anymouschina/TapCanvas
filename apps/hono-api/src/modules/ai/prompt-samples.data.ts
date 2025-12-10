export type PromptSample = {
	id: string;
	scene: string;
	commandType: string;
	title: string;
	nodeKind: "image" | "composeVideo" | "storyboard";
	prompt: string;
	description?: string;
	inputHint?: string;
	outputNote?: string;
	keywords: string[];
};

export const PROMPT_SAMPLES: PromptSample[] = [
	{
		id: "video-realism-golden-hour",
		scene: "视频真实感",
		commandType: "手持城市镜头",
		title: "黄金时刻街头追踪",
		nodeKind: "composeVideo",
		prompt:
			"Golden hour handheld tracking shot in a rain-washed Shibuya side street. The protagonist jogs up from the subway, phone buzzing, and follows the alert toward a rooftop cafe sign. Lighting: golden-hour sunlight from the left, 4800K warmth reflecting across wet asphalt and glass, with every shadow aligned to the same direction. Camera handling: subtle handheld jitter around 1% with breathing sway and a 0.3s settle whenever the shot starts or stops. Lens: 35mm prime at f/2.2, performing a two-second focus pull from her determined face to neon signage in the distance. Optics: add a 6% vignette, faint anamorphic flares, slight chromatic aberration and soft film grain for authenticity. Micro motion: fingers tighten on the phone, crossbody bag straps bounce, fabric folds react with a 200ms delay, nearby umbrellas wobble as she brushes past. Materials: textured denim, brushed metal rails catching specular highlights, dusty shop windows blooming with light. Environment: steady wind from the right ripples through her hair, coat, and hanging lanterns, while suspended dust and drizzle sparkle in headlight beams. Camera intent: begin at eye level, push in for 2 seconds, hold as she spots the sign, then exit through a foreground passerby for layered depth. Micro narrative: phone buzz → glance at message → weave through commuters → leap the puddle as a tram whooshes past → dash up the stairwell, retaining motion blur and slight color shift.",
		description: "涵盖九条真实感原则的完整视频模板，适合都市街头题材。",
		inputHint: "当用户需要城市追踪类镜头、强调手持与真实质感时使用。",
		outputNote: "生成结果具备统一光影、可信手持抖动及完整微剧情链。",
		keywords: [
			"video realism",
			"handheld",
			"golden hour",
			"micro narrative",
			"film grain",
		],
	},
	{
		id: "video-realism-rain-night-bus",
		scene: "视频真实感",
		commandType: "微剧情模板",
		title: "雨夜公交站戏剧",
		nodeKind: "composeVideo",
		prompt:
			"Rainy night micro narrative at a glass-covered bus stop. A soaked dancer shields a sketchbook, waiting for route 23 while neon reflections ripple across puddles. Lighting: cold-blue street lamps mix with warm shop interiors, consistent shadow direction and foggy air scattering highlights. Camera handling: 1% handheld sway that mirrors breathing, with a gentle settle after each pan. Lens: 50mm at f/2.0, performing a two-second rack focus from raindrops on the glass to her face, then to the approaching headlights. Optics: introduce a 5% vignette, occasional lens flare streaks, soft chromatic aberration at the frame edges, and light film grain. Micro motion: wrists micro-adjust around the sketchbook, jacket fabric absorbs the gust then recovers, nearby paper cups tip when splashed. Materials: damp wool coat, cracked leather boots, stainless steel benches, and fogged glass panels collecting droplets. Environment: wind from the left pushes hair → coat → dangling earphones in sequence, plus mist particles shimmering in the backlight. Camera intent: eye-level dolly in, hold as the bus brakes, then swing behind her to reveal the city mirrored on the shelter glass. Micro narrative: notification ping → she checks the time → headlights bloom → she dodges a cyclist → boards the bus while motion blur and slight color shift remain.",
		description: "雨夜场景模板，突出风雨互动、材质表现与镜头语言。",
		inputHint: "适合夜景、雨景、街头微剧情类视频节点。",
		outputNote: "输出画面带有真实雨夜质感、统一风向以及手持镜头像。",
		keywords: [
			"rain night",
			"bus stop",
			"handheld",
			"lens imperfection",
			"micro motion",
		],
	},
	{
		id: "img-clean-people",
		scene: "基础图片编辑",
		commandType: "元素消除",
		title: "消除图片中的路人",
		nodeKind: "image",
		prompt:
			"精准移除画面中所有路人，仅保留主体与背景环境，保持原有光影与纹理连贯，输出干净整洁的背景。",
		description: "用于街拍、旅行照的路人清除，重点是无痕补全背景材质。",
		inputHint: "上传含有路人干扰的城市/旅行照片。",
		outputNote: "背景平滑、无重复纹理，可直接用于海报或二次创作。",
		keywords: ["元素消除", "路人", "去除", "清除人物", "移除行人"],
	},
	// 其余官方样例保持与 Nest 版本一致，可按需继续补充...
];

type PromptScore = { sample: PromptSample; score: number };

export function matchPromptSamples(
	query: string | undefined | null,
	limit = 3,
): PromptSample[] {
	const haystack = (query || "").trim().toLowerCase();
	if (!haystack) return [];

	const scored: PromptScore[] = PROMPT_SAMPLES.map((sample) => {
		let score = 0;
		const normalizedPrompt = sample.prompt.toLowerCase();
		const normalizedTitle = sample.title.toLowerCase();
		const normalizedScene = sample.scene.toLowerCase();
		const normalizedCommand = sample.commandType.toLowerCase();

		if (haystack.includes(normalizedTitle)) score += 3;
		if (haystack.includes(normalizedScene)) score += 1;
		if (haystack.includes(normalizedCommand)) score += 2;
		if (
			haystack.includes(
				normalizedPrompt.slice(
					0,
					Math.min(12, normalizedPrompt.length),
				),
			)
		) {
			score += 1;
		}

		for (const keyword of sample.keywords) {
			if (!keyword) continue;
			const normalizedKeyword = keyword.toLowerCase();
			if (normalizedKeyword && haystack.includes(normalizedKeyword)) {
				score += 3;
			}
		}

		if (score === 0) {
			const fallbackSignals: Array<[string, number]> = [
				["海报", sample.scene.includes("海报") ? 1.5 : 0.5],
				["风格", sample.scene.includes("风格") ? 1.4 : 0.3],
				["商品", sample.scene.includes("商品") ? 1.2 : 0],
				["文字", sample.scene.includes("文字") ? 1.2 : 0],
			];
			fallbackSignals.forEach(([token, weight]) => {
				if (!weight) return;
				if (haystack.includes(token)) {
					score += weight;
				}
			});
		}

		return { sample, score };
	}).filter((entry) => entry.score > 0);

	return scored
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((entry) => entry.sample);
}

