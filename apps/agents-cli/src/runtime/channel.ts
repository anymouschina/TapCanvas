export type RuntimeChannelKind = "cli" | "tui" | "http" | "shell";

export type RuntimeChannelTransport = "interactive" | "request_response" | "stream";

export type RuntimeChannelResponseStyle = "compact" | "balanced";

export type RuntimeChannelSessionMode = "ephemeral" | "persistent";

export type RuntimeChannelPolicy = {
  responseStyle: RuntimeChannelResponseStyle;
  sessionMode: RuntimeChannelSessionMode;
  eventMode: RuntimeChannelTransport;
};

export type RuntimeChannelDescriptor = {
  kind: RuntimeChannelKind;
  transport: RuntimeChannelTransport;
  sessionId?: string | null;
  userId?: string | null;
  surface?: string | null;
};

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

export function deriveRuntimeChannelPolicy(
  channel: RuntimeChannelDescriptor | undefined,
): RuntimeChannelPolicy | null {
  if (!channel) return null;
  const sessionMode: RuntimeChannelSessionMode = normalizeOptional(channel.sessionId)
    ? "persistent"
    : "ephemeral";
  const responseStyle: RuntimeChannelResponseStyle =
    channel.kind === "tui" || channel.kind === "cli" || channel.kind === "shell"
      ? "compact"
      : "balanced";
  return {
    responseStyle,
    sessionMode,
    eventMode: channel.transport,
  };
}

export function readRuntimeChannelDescriptor(
  meta: Record<string, unknown> | undefined,
): RuntimeChannelDescriptor | null {
  const raw = meta?.runtimeChannel;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = String(record.kind || "").trim();
  const transport = String(record.transport || "").trim();
  if (
    (kind !== "cli" && kind !== "tui" && kind !== "http" && kind !== "shell") ||
    (transport !== "interactive" && transport !== "request_response" && transport !== "stream")
  ) {
    return null;
  }
  return {
    kind,
    transport,
    ...(normalizeOptional(record.sessionId as string | null | undefined)
      ? { sessionId: normalizeOptional(record.sessionId as string | null | undefined) }
      : {}),
    ...(normalizeOptional(record.userId as string | null | undefined)
      ? { userId: normalizeOptional(record.userId as string | null | undefined) }
      : {}),
    ...(normalizeOptional(record.surface as string | null | undefined)
      ? { surface: normalizeOptional(record.surface as string | null | undefined) }
      : {}),
  };
}

export function buildRuntimeChannelSystemFragment(
  channel: RuntimeChannelDescriptor | undefined,
): string {
  const policy = deriveRuntimeChannelPolicy(channel);
  if (!channel || !policy) return "";
  const lines = [
    "**Channel Contract**",
    `- currentChannel: ${channel.kind}/${channel.transport}`,
    `- responseStyle: ${policy.responseStyle}`,
    `- sessionMode: ${policy.sessionMode}`,
    "- 默认先给直接结论，不要为了显得完整而重复改写同一结论。",
    "- 若结果受权限、路径、输入、审批或外部条件阻塞，第一句直接说明阻塞事实与缺口。",
    "- 阻塞时只给最小可执行下一步，不要自动追加长篇泛化方案，除非用户明确要求替代方案或展开分析。",
  ];
  if (policy.responseStyle === "compact") {
    lines.push(
      "- 当前渠道是交互式终端，默认短答优先。",
      "- 简单问答优先控制在 1 段或最多 4 个要点；除非用户明确要求展开，否则不要输出长篇背景铺垫。",
    );
  } else {
    lines.push("- 保持结果导向；用户未要求展开时，不要无端拉长篇幅。");
  }
  return lines.join("\n");
}

export function createRuntimeChannelMeta(
  channel: RuntimeChannelDescriptor | undefined,
): Record<string, unknown> {
  if (!channel) return {};
  const policy = deriveRuntimeChannelPolicy(channel);
  return {
    runtimeChannel: {
      kind: channel.kind,
      transport: channel.transport,
      ...(channel.sessionId ? { sessionId: channel.sessionId } : {}),
      ...(channel.userId ? { userId: channel.userId } : {}),
      ...(channel.surface ? { surface: channel.surface } : {}),
    },
    ...(policy ? { runtimeChannelPolicy: policy } : {}),
  };
}
