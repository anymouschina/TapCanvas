import nodeFs from "node:fs";
import path from "node:path";

export function findProjectDataRepoRoot(startDir: string): string {
	let dir = path.resolve(startDir);
	for (let i = 0; i < 12; i += 1) {
		if (nodeFs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(startDir);
}

export function resolveProjectDataRepoRoot(startDir: string = process.cwd()): string {
	return findProjectDataRepoRoot(startDir);
}
