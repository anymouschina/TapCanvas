#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const CHANNELS = [
	{ slug: "tv-show", name: "TV Show", icon: "device-tv", sort_order: 1, description: "连续剧 / 系列短剧" },
	{ slug: "short-video", name: "短视频", icon: "movie", sort_order: 2, description: "单条创意短视频" },
	{ slug: "anime", name: "动漫", icon: "mood-smile", sort_order: 3, description: "二次元 / 动画风" },
	{ slug: "mv", name: "MV", icon: "music", sort_order: 4, description: "音乐视频" },
	{ slug: "ad", name: "广告创意", icon: "ad", sort_order: 5, description: "商业广告 / 产品演示" },
	{ slug: "other", name: "其他", icon: "category", sort_order: 99, description: "未分类作品" },
];

async function main() {
	const prisma = new PrismaClient();
	const now = new Date().toISOString();
	let created = 0;
	let updated = 0;
	for (const ch of CHANNELS) {
		const existing = await prisma.content_channels.findUnique({ where: { slug: ch.slug } });
		if (existing) {
			await prisma.content_channels.update({
				where: { slug: ch.slug },
				data: { name: ch.name, icon: ch.icon, sort_order: ch.sort_order, description: ch.description, enabled: 1, updated_at: now },
			});
			updated += 1;
		} else {
			await prisma.content_channels.create({
				data: {
					id: randomUUID(),
					slug: ch.slug,
					name: ch.name,
					icon: ch.icon,
					sort_order: ch.sort_order,
					description: ch.description,
					enabled: 1,
					created_at: now,
					updated_at: now,
				},
			});
			created += 1;
		}
	}
	await prisma.$disconnect();
	console.log(`[seed-community-channels] created=${created} updated=${updated} total=${CHANNELS.length}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
