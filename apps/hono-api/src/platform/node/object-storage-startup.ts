import { accessSync, constants, mkdirSync } from "node:fs";

import type { WorkerEnv } from "../../types";
import { resolveLocalAssetStorageConfig } from "../../modules/asset/local-asset-storage";
import {
	resolveObjectStorageConfig,
	toObjectStorageConfigDiagnostics,
	type ObjectStorageConfigDiagnostics,
} from "../../modules/asset/rustfs.client";

export type ObjectStorageStartupStatus =
	| { status: "local"; rootDirectory: string; publicRoute: "/assets/local" }
	| { status: "configured"; config: ObjectStorageConfigDiagnostics };

export function assertObjectStorageStartupReady(env: WorkerEnv): ObjectStorageStartupStatus {
	const config = resolveObjectStorageConfig(env);
	if (config) {
		return {
			status: "configured",
			config: toObjectStorageConfigDiagnostics(config),
		};
	}

	const localStorage = resolveLocalAssetStorageConfig();
	if (!localStorage) {
		throw new Error("Asset hosting requires object storage outside the Node runtime");
	}
	mkdirSync(localStorage.rootDirectory, { recursive: true });
	accessSync(localStorage.rootDirectory, constants.R_OK | constants.W_OK);
	return {
		status: "local",
		rootDirectory: localStorage.rootDirectory,
		publicRoute: "/assets/local",
	};
}
