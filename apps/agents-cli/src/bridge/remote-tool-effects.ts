import { isJsonObject, type JsonObject, type RemoteToolDefinition } from './contracts.js';

/** Only authoritative execution metadata can establish that a call is read-only. */
export function isReadOnlyRemoteTool(tool: RemoteToolDefinition, args: JsonObject): boolean {
  if (tool.operationExecutions?.length) {
    const operation = tool.operationExecutions.find(entry => {
      const selector = entry.selector;
      return isJsonObject(selector) && typeof selector.field === 'string' && typeof selector.value === 'string'
        && args[selector.field] === selector.value;
    });
    return isJsonObject(operation?.execution) && operation.execution.sideEffect === 'none';
  }
  return tool.execution?.sideEffect === 'none';
}
