import { AppError } from '../../middleware/error'

export type RestrictedAgentExecutionToolPolicy = {
  mode: 'restricted'
  allowedTools: string[]
}

type NamedTool = {
  name: string
}

const LOCAL_RESTRICTABLE_TOOL_NAMES = new Set([
  'read_file',
  'read_file_range',
	'Skill',
	'skill_search',
	'knowledge_search',
	'knowledge_read',
	'knowledge_catalog',
	'record_user_intent',
	'creative_learning_query',
	// agents-cli owns the prompt-example retrieval protocol locally. Neither the
	// candidate search nor the receipt-bound body read is a Hono remote tool, so
	// both halves must remain admissible in a restricted Workflow Agent policy
	// even when the remote capability surface is empty.
	'prompt_example_search',
	'prompt_example_read',
])

const normalizePolicy = (value: unknown): RestrictedAgentExecutionToolPolicy | null => {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('executionToolPolicy 必须是对象', {
      status: 400,
      code: 'agents_execution_tool_policy_invalid',
    })
  }
  const record = value as Record<string, unknown>
  if (record.mode !== 'restricted') {
    throw new AppError('executionToolPolicy.mode 必须为 restricted', {
      status: 400,
      code: 'agents_execution_tool_policy_invalid',
    })
  }
  if (!Array.isArray(record.allowedTools) || record.allowedTools.length > 32) {
    throw new AppError('executionToolPolicy.allowedTools 必须是最多 32 项的数组', {
      status: 400,
      code: 'agents_execution_tool_policy_invalid',
    })
  }
  const allowedTools = record.allowedTools.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new AppError(`executionToolPolicy.allowedTools[${index}] 必须是非空字符串`, {
        status: 400,
        code: 'agents_execution_tool_policy_invalid',
      })
    }
    return value.trim()
  })
  if (new Set(allowedTools).size !== allowedTools.length) {
    throw new AppError('executionToolPolicy.allowedTools 禁止重复工具名', {
      status: 400,
      code: 'agents_execution_tool_policy_invalid',
    })
  }
  return { mode: 'restricted', allowedTools }
}

export const applyAgentExecutionToolPolicy = <
	TDirect extends NamedTool,
	TCatalog extends NamedTool = TDirect,
	TOptionalDirect extends NamedTool = TDirect,
>(input: {
  policy: unknown
	remoteTools: readonly TDirect[]
	remoteCatalogTools?: readonly TCatalog[]
	optionalDirectTools?: readonly TOptionalDirect[]
	/** Machine-owned hard denylist applied after caller policy resolution. */
	deniedRemoteTools?: readonly string[]
}): {
  remoteTools: Array<TDirect | TOptionalDirect>
	remoteToolCatalog: TCatalog[]
  allowedTools: string[] | null
  mode: 'default' | 'restricted'
} => {
  const policy = normalizePolicy(input.policy)
	const deniedRemoteTools = new Set(
		(input.deniedRemoteTools ?? []).map((name) => name.trim()).filter(Boolean),
	)
	const permittedDirectTools = input.remoteTools.filter(
		(tool) => !deniedRemoteTools.has(tool.name),
	)
	const permittedOptionalDirectTools = (input.optionalDirectTools ?? []).filter(
		(tool) => !deniedRemoteTools.has(tool.name),
	)
	const permittedRemoteCatalogTools = (input.remoteCatalogTools ?? []).filter(
		(tool) => !deniedRemoteTools.has(tool.name),
	)
  if (!policy) {
    return {
			remoteTools: [...permittedDirectTools],
			remoteToolCatalog: [...permittedRemoteCatalogTools],
      allowedTools: null,
      mode: 'default',
    }
  }

	const directByName = new Map(permittedDirectTools.map((tool) => [tool.name, tool]))
	const optionalDirectTools = [
		...new Map(
			permittedOptionalDirectTools
				.filter((tool) => !directByName.has(tool.name))
				.map((tool) => [tool.name, tool]),
		).values(),
	]
	const remoteCatalogTools = [
		...new Map(
			permittedRemoteCatalogTools
				.filter((tool) => !directByName.has(tool.name))
				.map((tool) => [tool.name, tool]),
		).values(),
	]
	const explicitlyAvailableRemoteTools = [
		...permittedDirectTools,
		...optionalDirectTools,
		...remoteCatalogTools,
	]
	const explicitlyAvailableByName = new Map(
		explicitlyAvailableRemoteTools.map((tool) => [tool.name, tool]),
	)
	const policyAllowedTools = policy.allowedTools.filter(
		(name) => !deniedRemoteTools.has(name),
	)
	const unknownTools = policyAllowedTools.filter(
		(name) =>
			!explicitlyAvailableByName.has(name) &&
			!LOCAL_RESTRICTABLE_TOOL_NAMES.has(name),
  )
  if (unknownTools.length > 0) {
		throw new AppError(`受限工具策略声明了当前执行面不存在的工具：${unknownTools.join(', ')}`, {
      status: 400,
      code: 'agents_execution_tool_policy_unknown_tool',
			details: { unknownTools },
    })
  }

	const effectiveAllowedTools = policyAllowedTools.filter((name) => (
		explicitlyAvailableByName.has(name) || LOCAL_RESTRICTABLE_TOOL_NAMES.has(name)
	))
  const allowedNames = new Set(effectiveAllowedTools)
	const selectedDirectTools = [...permittedDirectTools, ...optionalDirectTools]
		.filter((tool) => allowedNames.has(tool.name))
	// A restricted policy defines the root turn's hot capability surface, not the
	// complete authenticated catalog for every future durable DAG frontier. Keep
	// every server-authorized deferred definition dormant in the cold catalog so a
	// later progressCursor.allowedSupportingTools edge can activate the exact
	// schema. The agents runtime still intersects that edge with this catalog and
	// the current turn allowlist before model exposure or execution.
  return {
		remoteTools: selectedDirectTools,
		remoteToolCatalog: remoteCatalogTools,
		allowedTools: effectiveAllowedTools,
    mode: 'restricted',
  }
}
