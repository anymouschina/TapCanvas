export function readVideoSubmitErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

const LEGACY_LOCAL_PRE_UPSTREAM_ERROR_CODES: ReadonlySet<string> = new Set([
  "new_api_model_disabled",
  "video_prompt_too_long",
]);

const LOCAL_PRE_UPSTREAM_ORCHESTRATION_ERROR_CODES: ReadonlySet<string> = new Set([
  "clip_reference_asset_identity_unresolved",
  "clip_storyboard_reference_missing",
  "clip_video_reference_node_missing",
  "clip_video_reference_url_missing",
  "clip_last_frame_reference_missing",
  "clip_continuity_contract_missing",
  "clip_reference_video_source_missing",
]);

const OPTIONAL_REFERENCE_AUDIO_ERROR_CODES: ReadonlySet<string> = new Set([
  "speaker_reference_audio_unsupported",
  "speaker_reference_audio_limit_exceeded",
  "speaker_voice_binding_missing",
  "speaker_voice_asset_missing",
  "speaker_voice_asset_duration_invalid",
  "speaker_voice_asset_probe_failed",
  "speaker_voice_manifest_binding_invalid",
  "speaker_voice_manifest_mismatch",
  "speaker_voice_manifest_without_dialogue",
]);

function readErrorDetails(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const details = (error as Record<string, unknown>).details;
  return typeof details === "object" && details !== null && !Array.isArray(details)
    ? details as Record<string, unknown>
    : null;
}

/**
 * Preserve the provider's explicit moderation evidence without interpreting
 * the referenced media. The URL list is a deterministic upstream fact that
 * can be joined back to project assets by later workflow executions.
 */
export function readVideoSubmitRejectedUrls(error: unknown): string[] {
  const upstreamData = readErrorDetails(error)?.upstreamData;
  if (typeof upstreamData !== "object" || upstreamData === null || Array.isArray(upstreamData)) return [];
  const upstream = upstreamData as Record<string, unknown>;
  if (readVideoSubmitErrorCode(upstream) !== "ark_moderation_rejected") return [];
  const data = upstream.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const rejectedUrls = (data as Record<string, unknown>).rejected_urls;
  if (!Array.isArray(rejectedUrls)) return [];
  return [...new Set(rejectedUrls.flatMap((value) => {
    if (typeof value !== "string") return [];
    const url = value.trim();
    return url ? [url] : [];
  }))];
}

function stableHttpResourceIdentity(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Join provider-returned rejected URLs back to the caller's frozen reference
 * identities.  This is a deterministic resource-identity join only: it does
 * not inspect image semantics and it never exposes signed URLs to Agents.
 */
export function matchVideoSubmitRejectedReferenceIds(
  error: unknown,
  references: readonly Readonly<{ referenceId: string; url: string }>[],
): string[] {
  const rejected = new Set(
    readVideoSubmitRejectedUrls(error)
      .map(stableHttpResourceIdentity)
      .filter((identity): identity is string => identity !== null),
  );
  if (rejected.size === 0) return [];
  return [...new Set(references.flatMap((reference) => {
    const identity = stableHttpResourceIdentity(reference.url);
    const referenceId = reference.referenceId.trim();
    return identity && referenceId && rejected.has(identity) ? [referenceId] : [];
  }))];
}

export function readVideoSubmitRejectedReferenceIds(error: unknown): string[] {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return [];
  const direct = (error as Record<string, unknown>).providerRejectedReferenceIds;
  if (!Array.isArray(direct)) return [];
  return [...new Set(direct.flatMap((value) => (
    typeof value === "string" && value.trim() ? [value.trim()] : []
  )))];
}

/**
 * 新错误用显式 upstreamRequestAttempted=false 证明发生在付费 POST 前；code 集合只用于恢复修复前
 * 已错误标成 upstream_uncertain 的持久化节点，不能作为新增错误的隐式默认分类。
 */
export function isVideoSubmitKnownPreUpstreamFailure(error: unknown): boolean {
  if (readErrorDetails(error)?.upstreamRequestAttempted === false) return true;
  const code = readVideoSubmitErrorCode(error);
  return code !== null && LEGACY_LOCAL_PRE_UPSTREAM_ERROR_CODES.has(code);
}

export function isOptionalReferenceAudioFailure(error: unknown): boolean {
  const code = readVideoSubmitErrorCode(error);
  return code !== null && OPTIONAL_REFERENCE_AUDIO_ERROR_CODES.has(code);
}

/**
 * A silent/default-voice replay is safe only when the failed attempt carries
 * durable proof that the paid provider boundary was never crossed.  This keeps
 * optional audio fail-open without turning recovery into duplicate video jobs.
 */
export function shouldRetryVideoWithoutOptionalReferenceAudio(input: {
  error: unknown;
  hadReferenceAudio: boolean;
  referenceAudioRequired?: boolean;
}): boolean {
  return input.hadReferenceAudio &&
    input.referenceAudioRequired !== true &&
    isOptionalReferenceAudioFailure(input.error) &&
    isVideoSubmitKnownPreUpstreamFailure(input.error);
}

export function isLegacyLocalPreUpstreamVideoErrorCode(value: unknown): boolean {
  return typeof value === "string" && LEGACY_LOCAL_PRE_UPSTREAM_ERROR_CODES.has(value.trim());
}

export function isLocalPreUpstreamOrchestrationErrorCode(value: unknown): boolean {
  return typeof value === "string" && LOCAL_PRE_UPSTREAM_ORCHESTRATION_ERROR_CODES.has(value.trim());
}

/**
 * Historical submitters persisted some deterministic local rejections before the
 * durable `upstreamRequestAttempted=false` receipt existed. These codes are safe
 * only as a candidate signal: the resume boundary must still fresh-read the
 * canvas and reject any task identity, media asset, or uncertain upstream state.
 */
export function isKnownLocalPreUpstreamVideoErrorCode(value: unknown): boolean {
  return isLegacyLocalPreUpstreamVideoErrorCode(value) ||
    isLocalPreUpstreamOrchestrationErrorCode(value);
}

/** run driver 的持久错误合同固定为 `code: message`；这里只读取 code，不解释 message。 */
export function readSerializedVideoRunErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  const code = (separator >= 0 ? value.slice(0, separator) : value).trim();
  return code || null;
}

export function isVideoSubmitCapacityBackpressure(error: unknown): boolean {
  return readVideoSubmitErrorCode(error) === "membership_concurrency_limit_reached";
}
