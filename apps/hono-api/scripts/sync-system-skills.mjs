import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const skillsRoot = path.join(repositoryRoot, "apps/agents-cli/skills");
const apply = process.argv.includes("--apply");

function parseScalar(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"'))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) return trimmed.slice(1, -1).trim();
	return trimmed;
}

function readFrontmatter(content, filePath) {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	if (lines[0] !== "---") throw new Error(`Skill frontmatter missing: ${filePath}`);
	const metadata = new Map();
	let closed = false;
	let blockKey = "";
	let blockLines = [];
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === "---") {
			if (blockKey) metadata.set(blockKey, blockLines.join(" ").trim());
			closed = true;
			break;
		}
		if (blockKey && (line.startsWith(" ") || line.startsWith("\t") || !line)) {
			if (line.trim()) blockLines.push(line.trim());
			continue;
		}
		if (blockKey) {
			metadata.set(blockKey, blockLines.join(" ").trim());
			blockKey = "";
			blockLines = [];
		}
		if (!line || line.startsWith(" ") || line.startsWith("\t")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = parseScalar(line.slice(separator + 1));
		if (value === "|" || value === ">") {
			blockKey = key;
			continue;
		}
		metadata.set(key, value);
	}
	if (!closed) throw new Error(`Skill frontmatter is not closed: ${filePath}`);
	return metadata;
}

function readDisplayName(content, fallback) {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	let frontmatterClosed = false;
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!frontmatterClosed) {
			if (line === "---") frontmatterClosed = true;
			continue;
		}
		if (line.startsWith("# ") && line.slice(2).trim()) return line.slice(2).trim();
	}
	return fallback;
}

async function loadSystemSkills() {
	const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
	const skills = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (!entry.isDirectory()) continue;
		const filePath = path.join(skillsRoot, entry.name, "SKILL.md");
		let content;
		try {
			content = await fs.readFile(filePath, "utf8");
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
			throw error;
		}
		const metadata = readFrontmatter(content, filePath);
		const key = (metadata.get("name") || entry.name).trim();
		const description = (metadata.get("description") || "").trim();
		if (!key) throw new Error(`Skill name missing: ${filePath}`);
		skills.push({
			key,
			name: readDisplayName(content, key),
			description: description || null,
			content,
			category: "系统技能",
		});
	}
	if (skills.length === 0) throw new Error(`No system skills found in ${skillsRoot}`);
	return skills;
}

const skills = await loadSystemSkills();
if (!apply) {
	console.log(`Dry run: ${skills.length} system Skills are ready. Re-run with --apply to write PostgreSQL.`);
	for (const skill of skills) console.log(`${skill.key}\t${skill.description || "(no description)"}`);
	process.exit(0);
}

const prisma = new PrismaClient();
try {
	const existing = await prisma.agent_skills.findMany({
		where: { key: { in: skills.map((skill) => skill.key) } },
		select: { key: true },
	});
	const existingKeys = new Set(existing.map((skill) => skill.key));
	const now = new Date().toISOString();
	await prisma.$transaction(skills.map((skill, index) => prisma.agent_skills.upsert({
		where: { key: skill.key },
		create: {
			id: crypto.randomUUID(),
			...skill,
			logo_url: null,
			enabled: 1,
			visible: 1,
			sort_order: index,
			created_at: now,
			updated_at: now,
		},
		update: {
			name: skill.name,
			description: skill.description,
			content: skill.content,
			category: skill.category,
			sort_order: index,
			updated_at: now,
		},
	})));
	const created = skills.filter((skill) => !existingKeys.has(skill.key)).length;
	console.log(`System Skill sync complete: total=${skills.length} created=${created} updated=${skills.length - created}`);
} finally {
	await prisma.$disconnect();
}
