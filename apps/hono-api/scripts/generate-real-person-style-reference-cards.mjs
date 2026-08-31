#!/usr/bin/env node
/**
 * Generate true live-action / photorealistic style reference cards.
 *
 * Output:
 * - results/real-person-style-cards-YYYYMMDD.json
 * - sql/patch/YYYYMMDD_real_person_style_reference_cards.sql
 *
 * The API returns hosted image URLs; those URLs are stored in llm_node_presets.meta.referenceImageUrl.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const REAL_PERSON_STYLE_CARDS = [
	{
		id: "s101",
		title: "现代都市真人电影感",
		description: "自然肤质、城市环境光，适合现代都市、职场和现实题材。",
		styleDirective: "modern urban live-action cinematic portrait, East Asian adult professional, city glass building background, natural skin texture, shallow depth of field, neutral wardrobe, controlled contrast",
		categories: ["real_people"],
		tags: ["真人", "影视", "都市", "现代"],
		region: "East Asia",
		ethnicity: "East Asian",
	},
	{
		id: "s102",
		title: "韩剧自然光真人风",
		description: "柔和自然光、干净生活质感，适合都市恋爱和生活剧。",
		styleDirective: "K-drama live-action still, Korean adult character, soft daylight, clean apartment or cafe setting, subtle makeup, realistic hair and skin, gentle emotional expression",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "韩剧", "亚洲", "恋爱"],
		region: "Korea",
		ethnicity: "Korean",
	},
	{
		id: "s103",
		title: "日剧写真人像风",
		description: "低饱和生活摄影、真实表情，适合日常、家庭和治愈题材。",
		styleDirective: "Japanese live-action drama still, Japanese adult character, muted colors, everyday street corner, realistic facial details, calm expression, documentary-like natural light",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "日剧", "生活", "治愈"],
		region: "Japan",
		ethnicity: "Japanese",
	},
	{
		id: "s104",
		title: "港风胶片真人风",
		description: "霓虹、胶片颗粒和高反差夜景，适合港风都市和犯罪题材。",
		styleDirective: "Hong Kong cinema live-action portrait, Chinese adult character, neon night street, wet asphalt reflections, 35mm film grain, high contrast color, practical lighting",
		categories: ["real_people", "era", "ethnicity_region"],
		tags: ["真人", "港风", "胶片", "霓虹"],
		era: "1990s",
		region: "Hong Kong",
		ethnicity: "Chinese",
	},
	{
		id: "s105",
		title: "民国旗袍真人剧照",
		description: "老上海布景、旗袍与暖色胶片，适合民国、谍战和年代剧。",
		styleDirective: "1930s Shanghai live-action period drama still, Chinese adult woman in qipao, warm tungsten light, art deco interior, realistic fabric, cinematic film grain",
		categories: ["real_people", "era", "history", "ethnicity_region"],
		tags: ["真人", "民国", "旗袍", "年代"],
		era: "1930s",
		region: "China",
		ethnicity: "Chinese",
	},
	{
		id: "s106",
		title: "黑色电影真人侦探风",
		description: "硬光阴影、烟雾和黑白高反差，适合侦探、悬疑和犯罪。",
		styleDirective: "1940s film noir live-action portrait, adult detective, black and white high contrast lighting, venetian blind shadows, trench coat, realistic face, smoky atmosphere",
		categories: ["real_people", "era"],
		tags: ["真人", "黑色电影", "侦探", "悬疑"],
		era: "1940s",
		region: "United States",
		ethnicity: "multiethnic",
	},
	{
		id: "s107",
		title: "50年代彩色胶片真人风",
		description: "Kodachrome 复古色、干净广告感，适合复古家庭和年代叙事。",
		styleDirective: "1950s Kodachrome live-action portrait, adult character, vintage American wardrobe, suburban set, saturated but realistic color film, studio softbox lighting",
		categories: ["real_people", "era"],
		tags: ["真人", "50年代", "复古", "彩色胶片"],
		era: "1950s",
		region: "United States",
		ethnicity: "multiethnic",
	},
	{
		id: "s108",
		title: "冷战间谍真人风",
		description: "低饱和灰绿调、风衣和办公室暗光，适合谍战和政治悬疑。",
		styleDirective: "1970s cold war spy live-action still, adult intelligence officer, grey green palette, trench coat, dim government office, realistic skin, restrained expression",
		categories: ["real_people", "era", "history"],
		tags: ["真人", "冷战", "谍战", "70年代"],
		era: "1970s",
		region: "Europe",
		ethnicity: "European",
	},
	{
		id: "s109",
		title: "80年代霓虹真人风",
		description: "合成器霓虹、强色彩边缘光，适合复古科幻和都市夜戏。",
		styleDirective: "1980s neon live-action portrait, adult character, synthwave lighting, magenta and cyan rim lights, leather jacket, realistic facial texture, practical city background",
		categories: ["real_people", "era", "future"],
		tags: ["真人", "80年代", "霓虹", "复古科幻"],
		era: "1980s",
		region: "global city",
		ethnicity: "multiethnic",
	},
	{
		id: "s110",
		title: "90年代街拍真人风",
		description: "手持相机、街头颗粒和真实生活感，适合青春、现实和群像。",
		styleDirective: "1990s street photography live-action portrait, adult young person, handheld camera feel, casual wardrobe, urban sidewalk, natural imperfect lighting, realistic grain",
		categories: ["real_people", "era"],
		tags: ["真人", "90年代", "街拍", "青春"],
		era: "1990s",
		region: "global city",
		ethnicity: "multiethnic",
	},
	{
		id: "s111",
		title: "唐风宫廷真人风",
		description: "真实服化道、宫廷布景和柔和暖光，适合古装宫廷和历史题材。",
		styleDirective: "Tang dynasty inspired live-action historical drama still, Chinese adult court figure, accurate layered silk costume, palace interior, warm cinematic light, realistic makeup and fabric",
		categories: ["real_people", "history", "ethnicity_region"],
		tags: ["真人", "唐风", "古装", "宫廷"],
		era: "Tang-inspired historical",
		region: "China",
		ethnicity: "Chinese",
	},
	{
		id: "s112",
		title: "武侠江湖真人风",
		description: "实景山林、布衣与金属质感，适合武侠、江湖和动作戏。",
		styleDirective: "live-action wuxia period drama portrait, Chinese adult swordsman or swordswoman, mountain forest set, linen costume, practical sword prop, natural mist, realistic cinematic lighting",
		categories: ["real_people", "history", "ethnicity_region"],
		tags: ["真人", "武侠", "古装", "江湖"],
		era: "historical fantasy",
		region: "China",
		ethnicity: "Chinese",
	},
	{
		id: "s113",
		title: "英伦维多利亚真人风",
		description: "维多利亚服饰、伦敦雾和古典室内光，适合历史悬疑和贵族叙事。",
		styleDirective: "Victorian British live-action period portrait, European adult character, tailored coat or dress, foggy London street or parlor, candle and window light, realistic texture",
		categories: ["real_people", "history", "era", "ethnicity_region"],
		tags: ["真人", "维多利亚", "英伦", "历史"],
		era: "Victorian",
		region: "United Kingdom",
		ethnicity: "European",
	},
	{
		id: "s114",
		title: "中东史诗真人风",
		description: "沙漠强光、织物层次和史诗构图，适合沙漠、神话和冒险。",
		styleDirective: "Middle Eastern epic live-action portrait, Arab adult character, desert fortress background, layered textile costume, golden hour sunlight, realistic skin and fabric details",
		categories: ["real_people", "history", "ethnicity_region"],
		tags: ["真人", "中东", "沙漠", "史诗"],
		region: "Middle East",
		ethnicity: "Arab",
	},
	{
		id: "s115",
		title: "南亚宫廷真人风",
		description: "珠宝、彩色纱丽和宫廷暖光，适合南亚历史和神话题材。",
		styleDirective: "South Asian royal live-action portrait, Indian adult character, palace interior, detailed jewelry and silk fabric, warm cinematic light, realistic face and hands",
		categories: ["real_people", "history", "ethnicity_region"],
		tags: ["真人", "南亚", "印度", "宫廷"],
		region: "South Asia",
		ethnicity: "South Asian",
	},
	{
		id: "s116",
		title: "东南亚热带真人风",
		description: "热带自然光、湿润空气和本地服饰，适合海岛、现代和神话题材。",
		styleDirective: "Southeast Asian live-action portrait, Thai or Vietnamese adult character, tropical daylight, humid atmosphere, local textile details, realistic skin, natural background",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "东南亚", "热带", "地域"],
		region: "Southeast Asia",
		ethnicity: "Southeast Asian",
	},
	{
		id: "s117",
		title: "非洲都市时尚真人风",
		description: "高质感时尚摄影、深肤色自然高光，适合现代都市和潮流题材。",
		styleDirective: "African urban fashion live-action portrait, Black adult character, contemporary streetwear, editorial lighting, realistic dark skin highlight detail, modern city background",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "非洲", "时尚", "都市"],
		region: "Africa",
		ethnicity: "Black African",
	},
	{
		id: "s118",
		title: "拉美魔幻现实真人风",
		description: "热带色彩、自然肤质和轻微超现实布景，适合拉美现实与奇幻融合。",
		styleDirective: "Latin American magical realism live-action portrait, Latino adult character, tropical town background, warm saturated film color, realistic skin, subtle surreal practical set pieces",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "拉美", "魔幻现实", "地域"],
		region: "Latin America",
		ethnicity: "Latino",
	},
	{
		id: "s119",
		title: "北欧冷调真人风",
		description: "冷色自然光、极简服装和克制表情，适合悬疑、家庭和心理题材。",
		styleDirective: "Nordic live-action portrait, Scandinavian adult character, cool overcast daylight, minimalist wardrobe, sparse interior or coast background, realistic skin texture",
		categories: ["real_people", "ethnicity_region"],
		tags: ["真人", "北欧", "冷调", "悬疑"],
		region: "Nordic countries",
		ethnicity: "Scandinavian",
	},
	{
		id: "s120",
		title: "未来赛博真人风",
		description: "真实演员质感、义体装置和霓虹环境，适合近未来与赛博城市。",
		styleDirective: "near future cyberpunk live-action portrait, adult character with subtle cybernetic implant, realistic skin, neon city background, practical LEDs, rain reflections, cinematic lens",
		categories: ["real_people", "future"],
		tags: ["真人", "赛博", "未来", "科幻"],
		era: "near future",
		region: "global city",
		ethnicity: "multiethnic",
	},
	{
		id: "s121",
		title: "太空殖民真人风",
		description: "真实宇航服材质、冷白舱内光，适合硬科幻和太空探索。",
		styleDirective: "hard sci-fi live-action portrait, adult astronaut or colony engineer, realistic spacesuit fabric, spacecraft interior, cool white practical lighting, believable face details",
		categories: ["real_people", "future"],
		tags: ["真人", "太空", "硬科幻", "未来"],
		era: "future",
		region: "space colony",
		ethnicity: "multiethnic",
	},
	{
		id: "s122",
		title: "末世废土真人风",
		description: "灰尘、破损服装和自然硬光，适合末日生存和废土冒险。",
		styleDirective: "post-apocalyptic live-action portrait, adult survivor, dusty realistic skin, weathered practical costume, ruined city background, harsh sunlight, grounded film still",
		categories: ["real_people", "future"],
		tags: ["真人", "末世", "废土", "生存"],
		era: "post-apocalyptic future",
		region: "global wasteland",
		ethnicity: "multiethnic",
	},
	{
		id: "s123",
		title: "纪录片真实人像风",
		description: "无修饰环境人像、真实纹理和社会纪实感，适合现实主义叙事。",
		styleDirective: "documentary live-action environmental portrait, adult everyday person, available light, real location, unpolished but respectful composition, natural skin and clothing texture",
		categories: ["real_people"],
		tags: ["真人", "纪录片", "现实主义", "环境人像"],
		region: "global",
		ethnicity: "multiethnic",
	},
	{
		id: "s124",
		title: "高端时装大片真人风",
		description: "棚拍硬光、精致妆发和高级质感，适合明星、时尚和商业叙事。",
		styleDirective: "high fashion live-action editorial portrait, adult model, studio lighting, refined makeup and hair, luxury textile detail, realistic skin texture, magazine cover quality",
		categories: ["real_people"],
		tags: ["真人", "时尚", "棚拍", "大片"],
		region: "global",
		ethnicity: "multiethnic",
	},
];

const { values: args } = parseArgs({
	args: process.argv.slice(2),
	options: {
		api: { type: "string", default: "http://localhost:8788" },
		token: { type: "string", default: "" },
		"dry-run": { type: "boolean", default: false },
		concurrency: { type: "string", default: "2" },
		"out-json": { type: "string", default: "" },
		"out-sql": { type: "string", default: "" },
		start: { type: "string", default: "101" },
		end: { type: "string", default: "124" },
		model: { type: "string", default: "gpt-image-2" },
	},
	strict: false,
});

const API_BASE = String(args.api || "http://localhost:8788").replace(/\/$/, "");
const TOKEN = String(args.token || process.env.TAPCANVAS_TOKEN || "").trim();
const DRY_RUN = args["dry-run"] ?? false;
const CONCURRENCY = Math.max(1, Math.min(6, Number(args.concurrency) || 2));
const START_NUM = Number.parseInt(String(args.start || "101"), 10);
const END_NUM = Number.parseInt(String(args.end || "124"), 10);
const MODEL_KEY = String(args.model || "gpt-image-2").trim();
const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const OUT_JSON = String(args["out-json"] || `results/real-person-style-cards-${dateStr}.json`);
const OUT_SQL = String(args["out-sql"] || `sql/patch/${dateStr}_real_person_style_reference_cards.sql`);

const ACTIVE_CARDS = REAL_PERSON_STYLE_CARDS.filter((style) => {
	const numeric = Number.parseInt(style.id.slice(1), 10);
	return numeric >= START_NUM && numeric <= END_NUM;
});

if (!TOKEN && !DRY_RUN) {
	console.error("缺少 --token 参数或 TAPCANVAS_TOKEN 环境变量");
	process.exit(1);
}

function buildPrompt(style) {
	return [
		"真实真人风格参考图，单个虚构成年人，半身正面或三分之二人像，适合作为影视/真人项目的视觉风格参考。",
		"必须是真实摄影 / live-action / photorealistic。保留自然肤质、真实头发、真实服装材质、真实镜头景深。",
		"禁止动漫、漫画、插画、卡通、二次元、手绘、油画、CG角色、3D游戏角色、玩偶感、塑料皮肤。",
		`风格设计：${style.styleDirective}`,
	].join("\n");
}

async function generateCard(style) {
	const prompt = buildPrompt(style);
	const body = {
		request: {
			kind: "text_to_image",
			prompt,
			extras: {
				nodeKind: "image",
				modelKey: MODEL_KEY,
				resolution: "1k",
				quality: "high",
				size: "1:1",
			},
		},
	};

	if (DRY_RUN) {
		console.log(`[DRY-RUN] ${style.id} ${style.title}`);
		console.log(JSON.stringify(body, null, 2));
		return { ...style, imageUrl: null, prompt, status: "dry-run" };
	}

	try {
		const response = await fetch(`${API_BASE}/public/tasks`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			console.error(`[ERROR] ${style.id} HTTP ${response.status}: ${text.slice(0, 240)}`);
			return { ...style, imageUrl: null, prompt, status: "http_error", error: response.status };
		}

		const data = await response.json();
		const rawAssets = data?.result?.assets ?? data?.assets;
		const assets = Array.isArray(rawAssets) ? rawAssets : [];
		const imageUrl = assets.find((asset) => typeof asset?.url === "string" && asset.url.trim())?.url?.trim() ?? null;

		if (!imageUrl) {
			console.warn(`[WARN] ${style.id} 未返回图片，响应: ${JSON.stringify(data).slice(0, 240)}`);
			return { ...style, imageUrl: null, prompt, status: "no_image", raw: data };
		}

		console.log(`[OK] ${style.id} ${style.title} -> ${imageUrl}`);
		return { ...style, imageUrl, prompt, status: "ok" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[ERROR] ${style.id} ${message}`);
		return { ...style, imageUrl: null, prompt, status: "error", error: message };
	}
}

async function runWithConcurrency(tasks, concurrency) {
	const results = [];
	let cursor = 0;
	async function worker() {
		while (cursor < tasks.length) {
			const task = tasks[cursor];
			cursor += 1;
			results.push(await task());
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
}

function escapeSql(value) {
	return String(value).replace(/'/g, "''");
}

function toNowIso() {
	return new Date().toISOString().replace("T", " ").replace("Z", "+00");
}

function buildMeta(result) {
	return {
		referenceImageUrl: result.imageUrl,
		styleId: result.id,
		styleReference: {
			styleId: result.id,
			categories: result.categories,
			tags: result.tags,
			...(result.era ? { era: result.era } : {}),
			...(result.region ? { region: result.region } : {}),
			...(result.ethnicity ? { ethnicity: result.ethnicity } : {}),
			medium: "live-action photography",
		},
	};
}

function buildSql(results) {
	const now = toNowIso();
	const rows = results
		.filter((result) => result.imageUrl)
		.map((result) => {
			const id = randomUUID();
			const meta = escapeSql(JSON.stringify(buildMeta(result)));
			return [
				`  ('${id}', NULL, 'base', 'image',`,
				`   '${escapeSql(result.title)}',`,
				`   '${escapeSql(result.prompt)}',`,
				`   '${escapeSql(result.description)}',`,
				`   '${meta}', 1, NULL, '${now}', '${now}')`,
			].join("\n");
		});

	if (!rows.length) return "-- No generated real-person style cards.\n";

	return `-- ${dateStr}_real_person_style_reference_cards.sql
-- Purpose: seed true live-action / photorealistic style reference cards (s101-s124).
-- Each row stores the generated OSS image URL in meta.referenceImageUrl.
-- Idempotent: ON CONFLICT DO NOTHING (keyed on id).

INSERT INTO llm_node_presets
  (id, owner_id, scope, preset_type, title, prompt, description, meta, enabled, sort_order, created_at, updated_at)
VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
}

async function main() {
	console.log(`\n开始生成 ${ACTIVE_CARDS.length} 个真人风格参考卡 (s${START_NUM}-s${END_NUM})`);
	console.log(`   API: ${API_BASE}  model: ${MODEL_KEY}  concurrency: ${CONCURRENCY}  dry-run: ${DRY_RUN}`);
	console.log(`   输出 JSON: ${OUT_JSON}`);
	console.log(`   输出 SQL:  ${OUT_SQL}\n`);

	const tasks = ACTIVE_CARDS.map((style) => () => generateCard(style));
	const results = await runWithConcurrency(tasks, CONCURRENCY);
	const ok = results.filter((result) => result.status === "ok").length;
	const fail = results.filter((result) => result.status !== "ok" && result.status !== "dry-run").length;

	const jsonDir = path.dirname(OUT_JSON);
	if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
	fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), "utf8");

	const sqlDir = path.dirname(OUT_SQL);
	if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });
	fs.writeFileSync(OUT_SQL, buildSql(results), "utf8");

	console.log(`\n完成: ${ok} 成功 / ${fail} 失败`);
	console.log(`JSON 已写入: ${OUT_JSON}`);
	console.log(`SQL 已写入: ${OUT_SQL}`);
	if (fail > 0) {
		console.error(`有 ${fail} 个生成失败，可查看 JSON 后按 start/end 重试。`);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
