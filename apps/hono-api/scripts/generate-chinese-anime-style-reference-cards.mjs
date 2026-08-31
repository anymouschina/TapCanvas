#!/usr/bin/env node
/**
 * generate-chinese-anime-style-reference-cards.mjs
 *
 * 生成国漫风格（仙侠/玄幻/斗气/魂师等）参考卡，直接调用 new-api (port 4455) gpt-image-2。
 * 生成后上传到显式选择的对象存储，写入 llm_node_presets (scope=base, type=image)。
 *
 * 用法:
 *   node scripts/generate-chinese-anime-style-reference-cards.mjs \
 *     [--new-api-token <token>]    # 默认读 .env 的 NEW_API_INTERNAL_TOKEN
 *     [--new-api-url http://localhost:4455]
 *     [--dry-run]
 *     [--concurrency 2]
 *     [--start 125] [--end 132]
 *     [--out-json results/chinese-anime-style-cards-YYYYMMDD.json]
 *     [--out-sql sql/patch/YYYYMMDD_chinese_anime_style_reference_cards.sql]
 *
 * 产出:
 *   - results/chinese-anime-style-cards-YYYYMMDD.json
 *   - sql/patch/YYYYMMDD_chinese_anime_style_reference_cards.sql
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { resolveObjectStorageTarget } from "./object-storage-config.mjs";

// ─── 加载 .env ────────────────────────────────────────────────────────────────
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const envPath = path.join(scriptDir, "..", ".env");
if (fs.existsSync(envPath)) {
	const { config } = await import("dotenv");
	config({ path: envPath });
}

// ─── 国漫风格定义 ─────────────────────────────────────────────────────────────
// subStyle 字段用于国漫子分类标注（UI 分组用）
const CHINESE_ANIME_STYLE_CARDS = [
	// ── 第一批：s125-s132（基础国漫题材） ─────────────────────────────────────
	{
		id: "s125",
		title: "炼气化神仙侠漫",
		description: "灵气流转、飞剑破空，适合修仙/仙道题材国漫。",
		styleDirective:
			"中国国漫风格，仙侠修炼题材，年轻修士道袍仙服，周身灵气流转光环，飞剑悬浮，云雾缭绕仙境背景，仙气十足，细腻精绘，国漫大作画质，半身正面像",
		categories: ["chinese_anime", "xianxia"],
		subStyle: "修仙仙侠",
		tags: ["国漫", "仙侠", "修仙", "飞剑", "灵气"],
		medium: "chinese donghua animation",
	},
	{
		id: "s126",
		title: "斗气境界爆发漫",
		description: "斗气火焰、境界突破光晕，适合斗气修炼/热血国漫题材。",
		styleDirective:
			"中国国漫风格，斗气修炼题材，英俊少年男主，全身斗气火焰环绕，境界突破时炫目光晕爆发，大陆战斗场景，热血帅气，精绘细节，国漫动画感，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "斗气玄幻",
		tags: ["国漫", "斗气", "修炼", "热血", "境界突破"],
		medium: "chinese donghua animation",
	},
	{
		id: "s127",
		title: "魂师觉醒魂环漫",
		description: "魂环光晕共鸣、武魂觉醒，适合魂师战斗/竞技题材国漫。",
		styleDirective:
			"中国国漫风格，魂师战斗题材，年轻魂师角色，身后七彩魂环光晕共鸣，武魂觉醒形态，竞技场背景，精绘立体感，华丽特效，国漫精品画质，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "魂师竞技",
		tags: ["国漫", "魂师", "魂环", "武魂觉醒", "竞技"],
		medium: "chinese donghua animation",
	},
	{
		id: "s128",
		title: "洪荒太古神族漫",
		description: "洪荒混沌气息、太古图腾，适合上古神话/洪荒题材国漫。",
		styleDirective:
			"中国国漫风格，洪荒神话题材，太古神族少年，周身混沌气息流转，太古图腾纹路显现，远古神庙背景，宏大宇宙感，精绘细腻，国漫史诗质感，半身正面像",
		categories: ["chinese_anime", "mythology"],
		subStyle: "洪荒神话",
		tags: ["国漫", "洪荒", "太古", "混沌", "神族"],
		medium: "chinese donghua animation",
	},
	{
		id: "s129",
		title: "星际修真觉醒漫",
		description: "星辰力量宇宙背景、修真与科技融合，适合星际修真题材国漫。",
		styleDirective:
			"中国国漫风格，星际修真题材，觉醒者男主，周身星辰力量光环，银河星云背景，修真与未来科技装备融合，宇宙浩瀚感，精绘细节，国漫画质，半身正面像",
		categories: ["chinese_anime", "scifi"],
		subStyle: "星际修真",
		tags: ["国漫", "星际", "修真", "觉醒", "宇宙"],
		medium: "chinese donghua animation",
	},
	{
		id: "s130",
		title: "凤凰血脉涅槃漫",
		description: "凤凰火焰涅槃重生、天命逆袭，适合女主国漫/凤凰血脉题材。",
		styleDirective:
			"中国国漫风格，凤凰血脉题材，美丽强势女主角，凤凰火焰翅膀绽放，涅槃重生光晕，华丽仙服，宫廷或天界背景，逆天改命气势，精绘细腻，国漫女主大作画质，半身正面像",
		categories: ["chinese_anime", "xuanhuan", "female_lead"],
		subStyle: "女主玄幻",
		tags: ["国漫", "女主", "凤凰", "涅槃", "逆袭"],
		medium: "chinese donghua animation",
	},
	{
		id: "s131",
		title: "铭纹传承秘法漫",
		description: "铭纹符文图腾、传承秘法力量，适合铭文修炼/传承题材国漫。",
		styleDirective:
			"中国国漫风格，铭纹传承题材，少年修炼者，手掌或身体显现古老铭纹符文图腾，传承秘法金色光芒，修炼洞府背景，神秘力量感，精绘细节，国漫精绘风格，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "铭纹玄幻",
		tags: ["国漫", "铭纹", "传承", "符文", "秘法"],
		medium: "chinese donghua animation",
	},
	{
		id: "s132",
		title: "玄幻美型剑道漫",
		description: "美型仙侠剑道、灵器法宝，适合玄幻仙侠/剑修题材国漫。",
		styleDirective:
			"中国国漫风格，玄幻仙侠剑修题材，美型白发或黑发男主，手持灵剑法宝，剑气纵横光效，仙鹤飞翔背景，道袍飘逸，精绘美型，国漫高端画质，半身正面像",
		categories: ["chinese_anime", "xianxia"],
		subStyle: "剑修仙侠",
		tags: ["国漫", "剑修", "仙侠", "玄幻", "美型"],
		medium: "chinese donghua animation",
	},

	// ── 第二批：s133-s152（风格拉开差距，覆盖多元美学） ────────────────────────

	// —— 绘制技法差异 ——
	{
		id: "s133",
		title: "水墨泼彩武侠漫",
		description: "泼墨山水写意、水墨晕染，适合武侠江湖/水墨国漫风。",
		styleDirective:
			"中国国漫风格，水墨泼彩武侠题材，豪迈江湖侠客，浓淡墨色泼洒，写意山水背景，笔墨晕染效果，飘逸剑气线条，国画水墨与动漫结合，水墨层次丰富，半身正面像",
		categories: ["chinese_anime", "wuxia", "ink_art"],
		subStyle: "水墨武侠",
		tags: ["国漫", "武侠", "水墨", "写意", "江湖"],
		medium: "chinese donghua animation",
	},
	{
		id: "s134",
		title: "工笔细密修仙漫",
		description: "工笔线描精密、矿物色彩，适合工笔国漫/古典仙侠风。",
		styleDirective:
			"中国国漫风格，工笔线描仙侠题材，精密勾线细描，矿物石青石绿配色，仙鹤莲花祥云装饰，工笔画细节精绘，古典仙女或修士，国漫与传统工笔融合，超高精绘，半身正面像",
		categories: ["chinese_anime", "xianxia", "ink_art"],
		subStyle: "工笔仙侠",
		tags: ["国漫", "工笔", "仙侠", "传统", "精绘"],
		medium: "chinese donghua animation",
	},
	{
		id: "s135",
		title: "厚涂油画玄幻漫",
		description: "CG厚涂油画质感、史诗体量，适合史诗玄幻/大制作国漫风。",
		styleDirective:
			"中国国漫风格，厚涂CG油画玄幻题材，厚重笔触层次，体积感强烈，史诗大陆背景，威武王者角色，华丽盔甲或道袍，浓郁色调，宏大史诗国漫质感，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "油画玄幻",
		tags: ["国漫", "厚涂", "油画", "史诗", "玄幻"],
		medium: "chinese donghua animation",
	},
	{
		id: "s136",
		title: "清新水彩花仙漫",
		description: "轻薄水彩晕染、花朵仙气，适合少女系/唯美仙子国漫风。",
		styleDirective:
			"中国国漫风格，清新水彩少女仙子题材，轻薄透明水彩晕染，樱花与牡丹花瓣装饰，淡雅粉青色调，仙气飘飘少女，国漫少女唯美风，柔和光感，半身正面像",
		categories: ["chinese_anime", "xianxia", "romance", "female_lead"],
		subStyle: "水彩花仙",
		tags: ["国漫", "水彩", "少女", "仙子", "唯美"],
		medium: "chinese donghua animation",
	},
	{
		id: "s137",
		title: "黑金至尊霸道漫",
		description: "黑底金色特效、霸主气场，适合至尊反派/霸道男主国漫风。",
		styleDirective:
			"中国国漫风格，黑金至尊题材，黑色背景金色光效，霸道强势男主，黑金战甲或长袍，金色龙纹光芒，俯视威压构图，极致奢华，顶级国漫大反派或至尊气质，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "黑金至尊",
		tags: ["国漫", "黑金", "至尊", "霸道", "反派"],
		medium: "chinese donghua animation",
	},

	// —— 视觉风格差异 ——
	{
		id: "s138",
		title: "赛博修仙霓虹漫",
		description: "霓虹科技与仙符结合、未来修仙美学，适合赛博仙侠题材。",
		styleDirective:
			"中国国漫风格，赛博朋克修仙融合题材，霓虹紫青光效，身着科技与道袍融合服装，仙符电路图腾，雨夜霓虹都市背景，未来修真感，赛博仙侠美学，精绘细节，半身正面像",
		categories: ["chinese_anime", "scifi", "xianxia"],
		subStyle: "赛博修仙",
		tags: ["国漫", "赛博", "修仙", "霓虹", "科技"],
		medium: "chinese donghua animation",
	},
	{
		id: "s139",
		title: "Q版萌系国漫风",
		description: "2-3头身Q版萌化、圆润可爱，适合轻松萌系/国漫周边题材。",
		styleDirective:
			"中国国漫Q版萌系风格，2到3头身可爱比例，超大圆眼，圆润肉嘟嘟造型，华丽仙侠服饰萌化版，表情夸张生动，糖果色调，超级可爱国漫角色，全身Q版立绘",
		categories: ["chinese_anime", "chibi"],
		subStyle: "Q版萌系",
		tags: ["国漫", "Q版", "萌系", "可爱", "chibi"],
		medium: "chinese donghua animation",
	},
	{
		id: "s140",
		title: "暗黑魔道反派漫",
		description: "暗紫黑色调、邪魅反派美学，适合魔道修士/大反派题材。",
		styleDirective:
			"中国国漫风格，暗黑魔道反派题材，邪魅俊美男主，暗紫黑配色，魔道纹路光效，骷髅或黑莲花装饰，阴森华丽背景，反派至尊气质，精绘细腻，国漫高端反派美学，半身正面像",
		categories: ["chinese_anime", "dark"],
		subStyle: "魔道暗黑",
		tags: ["国漫", "魔道", "反派", "暗黑", "邪魅"],
		medium: "chinese donghua animation",
	},
	{
		id: "s141",
		title: "国潮扁平几何漫",
		description: "现代扁平设计+国潮色彩，适合国潮都市/现代国漫题材。",
		styleDirective:
			"中国国漫国潮扁平设计风格，几何形状简化，传统纹样现代化，朱红藏青国潮配色，汉字图形设计元素，都市青年国风角色，现代与传统融合，扁平插画感，国潮时尚国漫，全身立绘",
		categories: ["chinese_anime", "flat_design", "modern"],
		subStyle: "国潮扁平",
		tags: ["国漫", "国潮", "扁平", "几何", "现代"],
		medium: "chinese donghua animation",
	},
	{
		id: "s142",
		title: "热血战神爆发漫",
		description: "极限爆发能量、肌肉张力冲击，适合战神/热血格斗国漫题材。",
		styleDirective:
			"中国国漫风格，热血战神极限爆发题材，肌肉张力爆发，全身能量冲击波，碎石尘埃特效，战神怒吼爆发构图，高饱和橙红色能量，动态感极强，硬核热血国漫风，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "热血战神",
		tags: ["国漫", "热血", "战神", "爆发", "格斗"],
		medium: "chinese donghua animation",
	},

	// —— 题材背景差异 ——
	{
		id: "s143",
		title: "龙族血脉觉醒漫",
		description: "东方神龙金红龙纹、血脉觉醒，适合龙族传承题材国漫。",
		styleDirective:
			"中国国漫风格，龙族血脉觉醒题材，少年身后东方神龙虚影，金红龙纹覆盖皮肤，龙角血脉觉醒，云海腾龙背景，威严宏大，古老神龙气势，精绘细节，国漫东方龙族，半身正面像",
		categories: ["chinese_anime", "mythology"],
		subStyle: "龙族神话",
		tags: ["国漫", "龙族", "血脉", "觉醒", "神龙"],
		medium: "chinese donghua animation",
	},
	{
		id: "s144",
		title: "深海妖族水灵漫",
		description: "深蓝海洋水系妖族、异域美人，适合海族/水系妖异题材国漫。",
		styleDirective:
			"中国国漫风格，深海妖族水系题材，蓝紫深海美人角色，鱼鳞纹服饰，水系能量光效，深海珊瑚水草背景，异域妖异气质，半透明水晶感，精绘国漫深海妖族，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "海族妖异",
		tags: ["国漫", "深海", "妖族", "水系", "异域"],
		medium: "chinese donghua animation",
	},
	{
		id: "s145",
		title: "地府鬼差阎殿漫",
		description: "地府阎殿美学、黑白红配色，适合鬼差判官/阴间题材国漫。",
		styleDirective:
			"中国国漫风格，地府鬼差阎殿题材，英俊鬼差判官角色，黑白红三色阎殿配色，地府判官服饰，幽火灵魂特效，阎王殿庄严背景，阴间审判气氛，精绘国漫阴间美学，半身正面像",
		categories: ["chinese_anime", "mythology", "dark"],
		subStyle: "地府鬼差",
		tags: ["国漫", "地府", "鬼差", "阎殿", "幽冥"],
		medium: "chinese donghua animation",
	},
	{
		id: "s146",
		title: "丹道炼药医毒漫",
		description: "炼丹炉灵火、药草灵材，适合医毒双修/丹道题材国漫。",
		styleDirective:
			"中国国漫风格，丹道炼药医毒题材，儒雅年轻炼药师，丹炉灵火特效，手持灵草仙药，药纹符篆光效，炼药室背景，神秘草药色调，精通毒药医术气质，精绘国漫，半身正面像",
		categories: ["chinese_anime", "xianxia"],
		subStyle: "丹道医毒",
		tags: ["国漫", "丹道", "医毒", "炼药", "药师"],
		medium: "chinese donghua animation",
	},
	{
		id: "s147",
		title: "机关傀儡古械漫",
		description: "木质机关傀儡、精密齿轮，适合机关术/傀儡师题材国漫。",
		styleDirective:
			"中国国漫风格，机关傀儡古械题材，傀儡师角色，身边精密木质铜质机关傀儡，齿轮符文线条，古代机关工艺美学，橙铜暖色调，神秘机关术阵，精绘细节，国漫古代科技风，半身正面像",
		categories: ["chinese_anime", "xianxia"],
		subStyle: "机关傀儡",
		tags: ["国漫", "机关", "傀儡", "古械", "工艺"],
		medium: "chinese donghua animation",
	},

	// —— 角色类型差异 ——
	{
		id: "s148",
		title: "腹黑谋士羽扇漫",
		description: "儒雅羽扇谋士、智计深沉，适合谋略争霸/权谋题材国漫。",
		styleDirective:
			"中国国漫风格，腹黑谋士权谋题材，儒雅俊美男谋士，手持羽扇，长袍文士服饰，淡漠深沉表情，棋局或地图背景，智计无双气质，精绘细腻，国漫谋士美型风，半身正面像",
		categories: ["chinese_anime", "wuxia"],
		subStyle: "权谋谋士",
		tags: ["国漫", "谋士", "腹黑", "权谋", "智计"],
		medium: "chinese donghua animation",
	},
	{
		id: "s149",
		title: "末世废土修炼漫",
		description: "后末世废土环境+修炼，适合末世求生/废土修炼题材国漫。",
		styleDirective:
			"中国国漫风格，末世废土修炼题材，废土修炼者角色，破损修炼服饰，废墟城市背景，末日灰棕色调，修炼光环与废土环境对比，求生感强烈，精绘细节，国漫末世题材，半身正面像",
		categories: ["chinese_anime", "scifi"],
		subStyle: "末世废土",
		tags: ["国漫", "末世", "废土", "修炼", "求生"],
		medium: "chinese donghua animation",
	},
	{
		id: "s150",
		title: "九尾妖狐变身漫",
		description: "九尾狐金红狐火变身、妖族美人，适合狐妖/妖族题材国漫。",
		styleDirective:
			"中国国漫风格，九尾妖狐变身题材，妖艳美丽女妖角色，九条金红狐尾绽放，狐火特效环绕，妖族华丽服饰，桃花林或月夜背景，妖族魅惑气质，精绘细腻，国漫妖族美型，半身正面像",
		categories: ["chinese_anime", "mythology", "female_lead"],
		subStyle: "狐妖神话",
		tags: ["国漫", "九尾", "狐妖", "妖族", "变身"],
		medium: "chinese donghua animation",
	},
	{
		id: "s151",
		title: "现代都市隐世修",
		description: "现代都市背景下隐世修炼者，适合都市修真/现代仙侠题材。",
		styleDirective:
			"中国国漫风格，现代都市隐世修炼题材，现代休闲服装的修炼者，城市霓虹背景，体内灵气隐约流转，现代与修真融合，时尚都市与古老修炼对比，精绘细节，国漫现代修真风，半身正面像",
		categories: ["chinese_anime", "xianxia", "modern"],
		subStyle: "都市修真",
		tags: ["国漫", "都市", "修真", "现代", "隐世"],
		medium: "chinese donghua animation",
	},
	{
		id: "s152",
		title: "异兽骑乘战灵漫",
		description: "炫酷异兽骑乘、战灵形态，适合御兽/战灵题材国漫。",
		styleDirective:
			"中国国漫风格，异兽骑乘战灵题材，少年御兽师，身边凶猛神秘异兽（神虎或麒麟），战灵形态光效，荒野或高山背景，御兽师与异兽默契气势，精绘细节，国漫御兽风，半身正面像",
		categories: ["chinese_anime", "xuanhuan"],
		subStyle: "御兽战灵",
		tags: ["国漫", "御兽", "异兽", "战灵", "骑乘"],
		medium: "chinese donghua animation",
	},
];

// ─── 参数解析 ────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
	args: process.argv.slice(2),
	options: {
		"new-api-url": { type: "string", default: "http://localhost:4455" },
		"new-api-token": { type: "string", default: "" },
		"dry-run": { type: "boolean", default: false },
		concurrency: { type: "string", default: "2" },
		"out-json": { type: "string", default: "" },
		"out-sql": { type: "string", default: "" },
		start: { type: "string", default: "133" },
		end: { type: "string", default: "152" },
		model: { type: "string", default: "gpt-image-2" },
		size: { type: "string", default: "1024x1024" },
		quality: { type: "string", default: "high" },
	},
	strict: false,
});

const NEW_API_URL = String(args["new-api-url"] || "http://localhost:4455").replace(/\/$/, "");
const NEW_API_TOKEN = String(
	args["new-api-token"] || process.env.NEW_API_INTERNAL_TOKEN || "",
).trim();
const DRY_RUN = args["dry-run"] ?? false;
const CONCURRENCY = Math.max(1, Math.min(6, Number(args.concurrency) || 2));
const START_NUM = Number.parseInt(String(args.start || "125"), 10);
const END_NUM = Number.parseInt(String(args.end || "132"), 10);
const MODEL_KEY = String(args.model || "gpt-image-2").trim();
const IMG_SIZE = String(args.size || "1024x1024").trim();
const IMG_QUALITY = String(args.quality || "high").trim();

const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const OUT_JSON = String(
	args["out-json"] || `results/chinese-anime-style-cards-${dateStr}.json`,
);
const OUT_SQL = String(
	args["out-sql"] || `sql/patch/${dateStr}_chinese_anime_style_reference_cards.sql`,
);

// ─── 对象存储配置 ────────────────────────────────────────────────────────────
const storage = DRY_RUN ? null : resolveObjectStorageTarget();

async function uploadToObjectStorage(imageBytes, keyPath) {
	if (!storage) throw new Error("Dry-run cannot upload object storage assets");
	const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
	const client = new S3Client(storage.s3ClientConfig);

	await client.send(
		new PutObjectCommand({
			Bucket: storage.bucket,
			Key: keyPath,
			Body: imageBytes,
			ContentType: "image/png",
		}),
	);

	return `${storage.publicBase}/${keyPath}`;
}

// ─── 核心逻辑 ────────────────────────────────────────────────────────────────

function buildPrompt(style) {
	return [
		"一个年轻角色，角色卡格式，干净留白背景，高细节精绘，半身正面像",
		`风格设计：${style.styleDirective}`,
	].join("\n");
}

async function generateAndUpload(style) {
	const prompt = buildPrompt(style);

	if (DRY_RUN) {
		console.log(`[DRY-RUN] ${style.id} ${style.title}`);
		console.log(`  prompt: ${prompt.slice(0, 80)}...`);
		return { ...style, imageUrl: null, prompt, status: "dry-run" };
	}

	// 1. 调 new-api 生图
	let imageSourceUrl;
	try {
		const resp = await fetch(`${NEW_API_URL}/v1/images/generations`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${NEW_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: MODEL_KEY,
				prompt,
				n: 1,
				size: IMG_SIZE,
				quality: IMG_QUALITY,
			}),
			signal: AbortSignal.timeout(180_000),
		});

		if (!resp.ok) {
			const txt = await resp.text().catch(() => "");
			console.error(`[ERROR] ${style.id} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
			return { ...style, imageUrl: null, prompt, status: "http_error", error: resp.status };
		}

		const data = await resp.json();
		imageSourceUrl = data?.data?.[0]?.url ?? null;

		if (!imageSourceUrl) {
			console.warn(`[WARN] ${style.id} 未返回图片 URL，响应: ${JSON.stringify(data).slice(0, 200)}`);
			return { ...style, imageUrl: null, prompt, status: "no_image", raw: data };
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[ERROR] ${style.id} 生图失败: ${msg}`);
		return { ...style, imageUrl: null, prompt, status: "error", error: msg };
	}

	// 2. 下载图片
	let imageBytes;
	try {
		const imgResp = await fetch(imageSourceUrl);
		if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
		const buf = await imgResp.arrayBuffer();
		imageBytes = Buffer.from(buf);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[ERROR] ${style.id} 下载图片失败: ${msg}`);
		return { ...style, imageUrl: null, prompt, status: "download_error", error: msg };
	}

	// 3. 上传对象存储
	let storageUrl;
	try {
		const keyPath = `gen/images/script/${dateStr}/${randomUUID()}.png`;
		storageUrl = await uploadToObjectStorage(imageBytes, keyPath);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[ERROR] ${style.id} 上传对象存储失败: ${msg}`);
		return { ...style, imageUrl: null, prompt, status: "upload_error", error: msg };
	}

	console.log(`[OK] ${style.id} ${style.title} -> ${storageUrl}`);
	return { ...style, imageUrl: storageUrl, prompt, status: "ok" };
}

async function runWithConcurrency(tasks, concurrency) {
	const results = [];
	let cursor = 0;
	async function worker() {
		while (cursor < tasks.length) {
			const task = tasks[cursor++];
			results.push(await task());
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
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
			...(result.subStyle ? { subStyle: result.subStyle } : {}),
			tags: result.tags,
			medium: result.medium,
		},
	};
}

function buildSql(results) {
	const now = toNowIso();
	const ok = results.filter((r) => r.imageUrl);
	if (!ok.length) return "-- No generated chinese anime style cards.\n";

	const rows = ok.map((result) => {
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

	const ids = ok.map((r) => r.id).join(", ");
	return `-- ${dateStr}_chinese_anime_style_reference_cards.sql
-- Purpose: seed Chinese anime (国漫) style reference cards (${ids}).
-- Each row stores the TOS image URL in meta.referenceImageUrl.
-- category: chinese_anime — separate from existing "中国画风" (s16-s25).
-- Idempotent: ON CONFLICT DO NOTHING (keyed on id).

INSERT INTO llm_node_presets
  (id, owner_id, scope, preset_type, title, prompt, description, meta, enabled, sort_order, created_at, updated_at)
VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
	if (!NEW_API_TOKEN && !DRY_RUN) {
		console.error("缺少 --new-api-token 或 NEW_API_INTERNAL_TOKEN 环境变量");
		process.exit(1);
	}
	const active = CHINESE_ANIME_STYLE_CARDS.filter((s) => {
		const n = Number.parseInt(s.id.slice(1), 10);
		return n >= START_NUM && n <= END_NUM;
	});

	console.log(`\n开始生成 ${active.length} 个国漫风格参考卡 (s${START_NUM}-s${END_NUM})`);
	console.log(
		`   new-api: ${NEW_API_URL}  model: ${MODEL_KEY}  size: ${IMG_SIZE}  quality: ${IMG_QUALITY}`,
	);
	console.log(`   concurrency: ${CONCURRENCY}  dry-run: ${DRY_RUN}`);
	console.log(`   输出 JSON: ${OUT_JSON}`);
	console.log(`   输出 SQL:  ${OUT_SQL}\n`);

	const tasks = active.map((s) => () => generateAndUpload(s));
	const results = await runWithConcurrency(tasks, CONCURRENCY);

	const okCount = results.filter((r) => r.status === "ok").length;
	const failCount = results.filter((r) => r.status !== "ok" && r.status !== "dry-run").length;

	const jsonDir = path.dirname(OUT_JSON);
	if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
	fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), "utf8");

	const sqlDir = path.dirname(OUT_SQL);
	if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });
	fs.writeFileSync(OUT_SQL, buildSql(results), "utf8");

	console.log(`\n完成: ${okCount} 成功 / ${failCount} 失败`);
	console.log(`JSON: ${OUT_JSON}`);
	console.log(`SQL:  ${OUT_SQL}`);

	if (failCount > 0) {
		console.error(`有 ${failCount} 个生成失败，可用 --start/--end 重跑指定范围。`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
