import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeBookUploadMetadataAtomically(input: {
	targetPath: string;
	value: unknown;
}): Promise<void> {
	const temporaryPath = `${input.targetPath}.${process.pid}.${randomUUID()}.tmp`;
	await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
	try {
		await fs.writeFile(
			temporaryPath,
			JSON.stringify(input.value, null, 2),
			"utf8",
		);
		await fs.rename(temporaryPath, input.targetPath);
	} catch (writeError) {
		try {
			await fs.rm(temporaryPath, { force: true });
		} catch (cleanupError) {
			throw new AggregateError(
				[writeError, cleanupError],
				`书籍上传元数据原子写失败，且临时文件清理失败：${input.targetPath}`,
			);
		}
		throw writeError;
	}
}
