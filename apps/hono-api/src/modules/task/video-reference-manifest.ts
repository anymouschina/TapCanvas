export type VideoReferencePurpose =
  | "character"
  | "scene"
  | "prop"
  | "ensemble"
  | "style"
  | "product"
  | "keyframe"
  | "storyboard"
  | "composition"
  | "vfx"
  | "other";

export type VideoReferenceImageRole =
  | "reference_image"
  | "first_frame"
  | "last_frame";

export type VideoReferenceImageBinding = {
  url: string;
  label: string;
  /** 传给 vendor/提示词渲染的主职责。 */
  purpose: VideoReferencePurpose;
  /**
   * 同一物理图片可以同时承担多个业务职责。URL 去重不得抹掉这些结构化语义。
   */
  purposes: VideoReferencePurpose[];
  /**
   * 同一物理图片可以由多个真实画布节点声明。编排付费边界按集合证明全部冻结节点均已交付。
   */
  sourceNodeIds: string[];
  /**
   * Exact frozen asset-object contract identities carried by this physical
   * image. Unlike assetName, this remains unambiguous when one image is reused
   * by aliases or when the source is a project asset without a canvas node.
   */
  assetContractKeys?: string[];
  /**
   * 绑定到真实资产合同的结构化身份。label 只给人看，付费边界与渲染器不得从泛化 label
   *（如“角色卡”）猜名字；编排 clip 会把 kind/name/role 一并冻结到这里。
   */
  assetKind?: VideoReferencePurpose;
  assetName?: string;
  referenceRole?: string;
};

export type VideoReferenceImageBindingInput = {
  url: string;
  label: string;
  purpose: VideoReferencePurpose;
  purposes?: VideoReferencePurpose[];
  sourceNodeIds?: string[];
  assetContractKeys?: string[];
  assetKind?: VideoReferencePurpose;
  assetName?: string;
  referenceRole?: string;
};

export type VideoReferenceImageManifestItem = VideoReferenceImageBinding & {
  role: VideoReferenceImageRole;
};

export type VideoReferenceAudioManifestItem = {
  url: string;
  label: string;
  role: "reference_audio";
};

export type VideoReferenceMediaManifest = {
  images: VideoReferenceImageManifestItem[];
  audios: VideoReferenceAudioManifestItem[];
};

export type VideoAssetReferenceRole =
  | "identity"
  | "wardrobe"
  | "prop"
  | "environment"
  | "palette"
  | "composition"
  | "vfx";

/** BeatSheet 结构职责到 vendor manifest 职责的唯一确定性映射。 */
export function purposeForAssetReferenceRole(
  role: VideoAssetReferenceRole,
): VideoReferencePurpose {
  switch (role) {
    case "identity":
    case "wardrobe":
      return "character";
    case "environment":
      return "scene";
    case "prop":
      return "prop";
    case "palette":
      return "style";
    case "composition":
      return "composition";
    case "vfx":
      return "vfx";
  }
}

/**
 * BeatSheet asset kind 到最终 reference manifest purpose 的确定性映射。
 *
 * 资产合同的 kind 是执行边界的身份事实；它不能由 label、prompt 或参考图序号推导。
 * 统一放在 manifest 模块，避免编排器、生成桥和交付校验各自维护一套映射。
 */
export function purposeForAssetKind(kind: string): VideoReferencePurpose | null {
  switch (kind.trim()) {
    case "character":
      return "character";
    case "scene":
      return "scene";
    case "prop":
      return "prop";
    case "ensemble":
      return "ensemble";
    case "vfx":
      return "vfx";
    case "palette":
      return "style";
    case "composition":
      return "composition";
    default:
      return null;
  }
}

export type SeedanceReferenceModeSelection = {
  mode: "multimodal_reference" | "first_last_frame";
  manifest: VideoReferenceMediaManifest;
  omittedReferenceImages: number;
  omittedReferenceAudios: number;
  frameImagesPromotedToReferences: number;
};

export type SeedanceReferenceContentItem =
  | {
      type: "image_url";
      image_url: { url: string };
      role: VideoReferenceImageRole;
    }
  | {
      type: "audio_url";
      audio_url: { url: string };
      role: "reference_audio";
    };

const PURPOSES = new Set<VideoReferencePurpose>([
  "character",
  "scene",
  "prop",
  "ensemble",
  "style",
  "product",
  "keyframe",
  "storyboard",
  "composition",
  "vfx",
  "other",
]);

const IMAGE_ROLES = new Set<VideoReferenceImageRole>([
  "reference_image",
  "first_frame",
  "last_frame",
]);

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isReferenceUrl(value: string): boolean {
  return /^(?:https?|asset):\/\//i.test(value);
}

function readPurpose(value: unknown): VideoReferencePurpose {
  const purpose = readString(value) as VideoReferencePurpose;
  return PURPOSES.has(purpose) ? purpose : "other";
}

function readPurposes(value: unknown, primary: VideoReferencePurpose): VideoReferencePurpose[] {
  if (!Array.isArray(value)) return [primary];
  const purposes = value
    .map(readPurpose)
    .filter((purpose, index, all) => all.indexOf(purpose) === index);
  return purposes.length ? purposes : [primary];
}

function readSourceNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readString)
    .filter((nodeId, index, all) => Boolean(nodeId) && all.indexOf(nodeId) === index);
}

function readAssetContractKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readString)
    .filter((contractKey, index, all) => Boolean(contractKey) && all.indexOf(contractKey) === index);
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text || undefined;
}

/**
 * URL 是 vendor 的物理媒体身份；节点归属与业务用途是同一条媒体上的可叠加事实。
 * 所有引用入口都必须经这里合并，禁止再用 Map#set 覆盖已有归属。
 */
export function mergeVideoReferenceImageBindings(
  bindings: readonly VideoReferenceImageBinding[],
): VideoReferenceImageBinding[] {
  const mergedByUrl = new Map<string, VideoReferenceImageBinding>();
  for (const binding of bindings) {
    const existing = mergedByUrl.get(binding.url);
    if (!existing) {
      mergedByUrl.set(binding.url, {
        ...binding,
        purposes: [...new Set(binding.purposes)],
        sourceNodeIds: [...new Set(binding.sourceNodeIds)],
        ...((binding.assetContractKeys?.length ?? 0) > 0
          ? { assetContractKeys: [...new Set(binding.assetContractKeys)] }
          : {}),
      });
      continue;
    }
    // Prefer the binding that carries an explicit frozen asset identity. This is important when
    // a canvas-wide scan first contributes a generic label and the orchestrator later contributes
    // the exact contract (e.g. “角色卡·烬纹司晨”). A generic label must never erase the name.
    const identity = binding.assetName
      ? binding
      : existing.assetName
        ? existing
        : binding;
    const purpose = existing.purpose === "other" && binding.purpose !== "other"
      ? binding.purpose
      : existing.purpose;
    const purposes = [...new Set([...existing.purposes, ...binding.purposes])];
    const assetContractKeys = [
      ...new Set([
        ...(existing.assetContractKeys ?? []),
        ...(binding.assetContractKeys ?? []),
      ]),
    ];
    mergedByUrl.set(binding.url, {
      url: binding.url,
      label: identity.label,
      purpose,
      purposes: purposes.length > 1
        ? purposes.filter((candidate) => candidate !== "other")
        : purposes,
      sourceNodeIds: [...new Set([...existing.sourceNodeIds, ...binding.sourceNodeIds])],
      ...(assetContractKeys.length > 0 ? { assetContractKeys } : {}),
      ...(identity.assetKind ? { assetKind: identity.assetKind } : {}),
      ...(identity.assetName ? { assetName: identity.assetName } : {}),
      ...(identity.referenceRole ? { referenceRole: identity.referenceRole } : {}),
    });
  }
  return [...mergedByUrl.values()];
}

export function normalizeVideoReferenceImageBindings(
  value: unknown,
): VideoReferenceImageBinding[] {
  if (!Array.isArray(value)) return [];
  const out: VideoReferenceImageBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = readString(record.url);
    if (!url || !isReferenceUrl(url)) continue;
    const purpose = readPurpose(record.purpose);
    out.push({
      url,
      label: readString(record.label) || "参考图",
      purpose,
      purposes: readPurposes(record.purposes, purpose),
      sourceNodeIds: readSourceNodeIds(record.sourceNodeIds),
      assetContractKeys: readAssetContractKeys(record.assetContractKeys),
      ...(readPurpose(record.assetKind) !== "other"
        ? { assetKind: readPurpose(record.assetKind) }
        : {}),
      ...(readOptionalString(record.assetName) ? { assetName: readOptionalString(record.assetName) } : {}),
      ...(readOptionalString(record.referenceRole)
        ? { referenceRole: readOptionalString(record.referenceRole) }
        : {}),
    });
  }
  return mergeVideoReferenceImageBindings(out);
}

export function buildVideoReferenceMediaManifest(input: {
  referenceImages: string[];
  referenceBindings?: VideoReferenceImageBindingInput[];
  firstFrameUrl?: unknown;
  lastFrameUrl?: unknown;
  referenceAudioUrls?: string[];
  referenceAudioLabels?: string[];
}): VideoReferenceMediaManifest {
  const bindingByUrl = new Map(
    normalizeVideoReferenceImageBindings(input.referenceBindings ?? []).map((binding) => [binding.url, binding]),
  );
  const firstFrameUrl = readString(input.firstFrameUrl);
  const lastFrameCandidate = readString(input.lastFrameUrl);
  const lastFrameUrl = lastFrameCandidate === firstFrameUrl ? "" : lastFrameCandidate;
  const orderedUrls = [
    ...(Array.isArray(input.referenceImages) ? input.referenceImages : []),
    firstFrameUrl,
    lastFrameUrl,
  ];
  const images: VideoReferenceImageManifestItem[] = [];
  const indexByUrl = new Map<string, number>();

  for (const rawUrl of orderedUrls) {
    const url = readString(rawUrl);
    if (!url || !isReferenceUrl(url)) continue;
    const role: VideoReferenceImageRole =
      url === firstFrameUrl
        ? "first_frame"
        : url === lastFrameUrl
          ? "last_frame"
          : "reference_image";
    const existingIndex = indexByUrl.get(url);
    if (existingIndex !== undefined) {
      if (role !== "reference_image") images[existingIndex].role = role;
      continue;
    }
    const binding = bindingByUrl.get(url);
    const fallbackLabel =
      role === "first_frame" ? "本镜首帧" : role === "last_frame" ? "本镜尾帧" : "参考图";
    images.push({
      url,
      label: binding?.label || fallbackLabel,
      purpose: binding?.purpose || (role === "reference_image" ? "other" : "keyframe"),
      purposes: binding?.purposes || [role === "reference_image" ? "other" : "keyframe"],
      sourceNodeIds: binding?.sourceNodeIds || [],
      ...((binding?.assetContractKeys?.length ?? 0) > 0
        ? { assetContractKeys: binding?.assetContractKeys }
        : {}),
      ...(binding?.assetKind ? { assetKind: binding.assetKind } : {}),
      ...(binding?.assetName ? { assetName: binding.assetName } : {}),
      ...(binding?.referenceRole ? { referenceRole: binding.referenceRole } : {}),
      role,
    });
    indexByUrl.set(url, images.length - 1);
  }

  const audios: VideoReferenceAudioManifestItem[] = [];
  const seenAudioUrls = new Set<string>();
  for (const [index, rawUrl] of (input.referenceAudioUrls ?? []).entries()) {
    const url = readString(rawUrl);
    if (!url || !/^https?:\/\//i.test(url) || seenAudioUrls.has(url)) continue;
    seenAudioUrls.add(url);
    audios.push({
      url,
      label: readString(input.referenceAudioLabels?.[index]) || `音频${audios.length + 1}`,
      role: "reference_audio",
    });
  }
  return { images, audios };
}

/**
 * 参考视频的事实注记仍然需要传递给供应商；图片身份由结构化 renderer 在提交边界
 * 根据最终 manifest 图序集中写入前置资产锁定。这里仅保留上一镜视频的连续性职责，
 * 避免把“参考视频”误标为“参考图”。
 */
export function renderVideoReferenceContinuationNote(videoNote?: string): string {
  const note = readString(videoNote);
  return note ? `[参考视频绑定] ${note}` : "";
}

/**
 * 只清理历史运行遗留的提交注记，再追加本轮必要的参考视频事实。
 * 不扫描或改写正文；最终 @图N 由结构化 renderer 从 manifest 构造，不依赖本函数。
 */
export function withAuthoritativePromptAnnotation(
  prompt: string,
  note: string,
): string {
  const paragraphs = String(prompt ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph &&
        !paragraph.startsWith("[参考图绑定]") &&
        !paragraph.startsWith("[参考视频绑定]"),
    );
  const normalizedNote = readString(note);
  if (normalizedNote) paragraphs.push(normalizedNote);
  return paragraphs.join("\n\n");
}

export function buildSeedanceReferenceContentItems(
  manifest: VideoReferenceMediaManifest,
): SeedanceReferenceContentItem[] {
  return [
    ...manifest.images.map((image) => ({
      type: "image_url" as const,
      image_url: { url: image.url },
      role: image.role,
    })),
    ...manifest.audios.map((audio) => ({
      type: "audio_url" as const,
      audio_url: { url: audio.url },
      role: audio.role,
    })),
  ];
}

/**
 * Ark exposes first/last-frame and multimodal-reference as distinct Seedance
 * request modes. Keep literal first/last roles only when they are the complete
 * reference contract. If a clip also needs identity, scene, audio, or video
 * references, preserve the full multimodal contract and treat its keyframes as
 * ordinary reference images instead of silently discarding every other asset.
 */
export function selectSeedanceReferenceMode(
  manifest: VideoReferenceMediaManifest,
  options: { hasReferenceVideo?: boolean } = {},
): SeedanceReferenceModeSelection {
  const frameImages = manifest.images.filter(
    (image) => image.role === "first_frame" || image.role === "last_frame",
  );
  if (frameImages.length === 0) {
    return {
      mode: "multimodal_reference",
      manifest,
      omittedReferenceImages: 0,
      omittedReferenceAudios: 0,
      frameImagesPromotedToReferences: 0,
    };
  }
  const ordinaryReferenceImages = manifest.images.filter(
    (image) => image.role === "reference_image",
  );
  const requiresMultimodalReferences =
    ordinaryReferenceImages.length > 0 ||
    manifest.audios.length > 0 ||
    options.hasReferenceVideo === true;
  if (requiresMultimodalReferences) {
    return {
      mode: "multimodal_reference",
      manifest: {
        images: manifest.images.map((image) => ({ ...image, role: "reference_image" })),
        audios: manifest.audios,
      },
      omittedReferenceImages: 0,
      omittedReferenceAudios: 0,
      frameImagesPromotedToReferences: frameImages.length,
    };
  }
  const referenceImageCount = manifest.images.length - frameImages.length;
  return {
    mode: "first_last_frame",
    manifest: { images: frameImages, audios: [] },
    omittedReferenceImages: referenceImageCount,
    omittedReferenceAudios: manifest.audios.length,
    frameImagesPromotedToReferences: 0,
  };
}

export function parseVideoReferenceMediaManifest(
  value: unknown,
): VideoReferenceMediaManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.images) || !Array.isArray(record.audios)) return null;
  const images: VideoReferenceImageManifestItem[] = [];
  for (const item of record.images) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const url = readString(row.url);
    const role = readString(row.role) as VideoReferenceImageRole;
    if (
      !url ||
      !isReferenceUrl(url) ||
      !IMAGE_ROLES.has(role) ||
      !Array.isArray(row.purposes) ||
      !Array.isArray(row.sourceNodeIds)
    ) {
      return null;
    }
    images.push({
      url,
      label: readString(row.label) || "参考图",
      purpose: readPurpose(row.purpose),
      purposes: readPurposes(row.purposes, readPurpose(row.purpose)),
      sourceNodeIds: readSourceNodeIds(row.sourceNodeIds),
      role,
    });
  }
  const audios: VideoReferenceAudioManifestItem[] = [];
  for (const item of record.audios) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const url = readString(row.url);
    if (!url || !/^https?:\/\//i.test(url) || readString(row.role) !== "reference_audio") {
      return null;
    }
    audios.push({ url, label: readString(row.label) || "参考音频", role: "reference_audio" });
  }
  return { images, audios };
}

export function mediaManifestMatchesRequest(input: {
  manifest: VideoReferenceMediaManifest;
  referenceImages: string[];
  referenceAudios: string[];
}): boolean {
  const same = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  return (
    same(
      input.manifest.images.map((item) => item.url),
      input.referenceImages,
    ) &&
    same(
      input.manifest.audios.map((item) => item.url),
      input.referenceAudios,
    )
  );
}
