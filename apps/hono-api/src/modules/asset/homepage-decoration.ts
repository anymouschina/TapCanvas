// 首页装修配置：全局 asset(kind=homepageDecoration) 里 JSON 的服务端净化。
// 前端管理端写入的是自由 JSON，公开读取口必须只吐白名单字段。

export type HomepageSkillCard = {
	title: string;
	subtitle: string | null;
	imageUrl: string | null;
	link: string | null;
};

export type LoginVideoItem = {
	url: string;
	posterUrl: string | null;
	caption: string | null;
};

export type HomepageDecoration = {
	greetingSubtitle: string | null;
	heroPlaceholder: string | null;
	skillCards: HomepageSkillCard[];
	loginVideos: LoginVideoItem[];
};

function str(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function sanitizeHomepageDecoration(parsed: unknown): HomepageDecoration {
	const d = (parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? parsed
		: {}) as Record<string, unknown>;

	const skillCards = (Array.isArray(d.skillCards) ? d.skillCards : [])
		.map((raw) => {
			const card = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
			const title = str(card.title);
			if (!title) return null;
			return {
				title,
				subtitle: str(card.subtitle),
				imageUrl: str(card.imageUrl),
				link: str(card.link),
			};
		})
		.filter((c): c is HomepageSkillCard => !!c);

	const loginVideos = (Array.isArray(d.loginVideos) ? d.loginVideos : [])
		.map((raw) => {
			const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
			const url = str(item.url);
			if (!url) return null;
			return { url, posterUrl: str(item.posterUrl), caption: str(item.caption) };
		})
		.filter((v): v is LoginVideoItem => !!v);

	return {
		greetingSubtitle: str(d.greetingSubtitle),
		heroPlaceholder: str(d.heroPlaceholder),
		skillCards,
		loginVideos,
	};
}
