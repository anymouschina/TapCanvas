function readId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function videoNodeDataInGraph(current: unknown, nodeId: string): Record<string, unknown> | null {
  const graph = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((entry: unknown) => entry !== null && typeof entry === "object"
    && !Array.isArray(entry) && readId((entry as Record<string, unknown>).id) === nodeId);
  if (!node) return null;
  const data = (node as Record<string, unknown>).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

export function activeVideoTaskId(data: Record<string, unknown>): string {
  // Browser submissions update videoTaskId when a new attempt is accepted;
  // taskId can still identify the previous completed version.
  return readId(data.videoTaskId) || readId(data.taskId);
}

export function isCurrentVideoTask(
  current: unknown,
  nodeId: string,
  taskId: string,
  allowUnboundReceipt = false,
): boolean {
  const data = videoNodeDataInGraph(current, nodeId);
  if (!data || !taskId) return false;
  const activeTaskId = activeVideoTaskId(data);
  return activeTaskId === taskId || (allowUnboundReceipt && !activeTaskId
    && !readId(data.videoUrl)
    && !(Array.isArray(data.videoResults) && data.videoResults.some((result: unknown) =>
      result !== null && typeof result === "object" && !Array.isArray(result)
      && readId((result as Record<string, unknown>).url))));
}
