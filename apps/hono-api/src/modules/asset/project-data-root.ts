import nodeFs from "node:fs";
import path from "node:path";

function isTapCanvasRepoRoot(dir: string): boolean {
	if (nodeFs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return true;
	return (
		nodeFs.existsSync(path.join(dir, ".git")) &&
		nodeFs.existsSync(path.join(dir, "apps", "hono-api"))
	);
}

export function findProjectDataRepoRoot(startDir: string): string {
	let dir = path.resolve(startDir);
	for (let i = 0; i < 12; i += 1) {
		if (isTapCanvasRepoRoot(dir)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(startDir);
}

export function resolveProjectDataRepoRoot(startDir: string = process.cwd()): string {
	return findProjectDataRepoRoot(startDir);
}
