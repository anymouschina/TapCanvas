export type NewApiRuntimeModelIdentity = {
	modelName: string;
	requestModelKey: string;
	routingAliases?: readonly string[];
};

function normalizeExactRuntimeModelIdentity(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * new-api 的 modelName、requestModelKey 与 routingAliases 都是同一实时目录行公开的结构化身份。
 * 这里只做逐字（忽略大小写与首尾空白）相等，不推断家族、不改写标点、也不维护本地别名表。
 */
export function matchesNewApiRuntimeModelIdentity(
	model: NewApiRuntimeModelIdentity,
	identity: unknown,
): boolean {
	const wanted = normalizeExactRuntimeModelIdentity(identity);
	if (!wanted) return false;
	return [
		model.modelName,
		model.requestModelKey,
		...(model.routingAliases ?? []),
	].some((candidate) => normalizeExactRuntimeModelIdentity(candidate) === wanted);
}
