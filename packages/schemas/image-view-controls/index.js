"use strict";

const IMAGE_CAMERA_PRESETS = [
  { id: "front", label: "正面", azimuthDeg: 0, elevationDeg: 0 },
  { id: "left", label: "左侧", azimuthDeg: 270, elevationDeg: 0 },
  { id: "right", label: "右侧", azimuthDeg: 90, elevationDeg: 0 },
  { id: "back", label: "背面", azimuthDeg: 180, elevationDeg: 0 },
  { id: "left45", label: "左45°", azimuthDeg: 315, elevationDeg: 0 },
  { id: "right45", label: "右45°", azimuthDeg: 45, elevationDeg: 0 },
  { id: "topDown", label: "俯视", azimuthDeg: 0, elevationDeg: 32 },
  { id: "lowAngle", label: "仰视", azimuthDeg: 0, elevationDeg: -24 },
];

const IMAGE_LIGHT_PRESETS = [
  { id: "left", label: "左侧", azimuthDeg: 270, elevationDeg: 12 },
  { id: "top", label: "顶部", azimuthDeg: 0, elevationDeg: 42 },
  { id: "right", label: "右侧", azimuthDeg: 90, elevationDeg: 12 },
  { id: "topLeft", label: "左上", azimuthDeg: 315, elevationDeg: 28 },
  { id: "front", label: "前方", azimuthDeg: 0, elevationDeg: 8 },
  { id: "topRight", label: "右上", azimuthDeg: 45, elevationDeg: 28 },
  { id: "bottom", label: "底部", azimuthDeg: 0, elevationDeg: -30 },
  { id: "back", label: "后方", azimuthDeg: 180, elevationDeg: 8 },
];

const DEFAULT_IMAGE_CAMERA_CONTROL = {
  enabled: false,
  presetId: "front",
  azimuthDeg: 0,
  elevationDeg: 0,
  distance: 2.4,
};

const DEFAULT_IMAGE_LIGHT_CONTROL = {
  enabled: false,
  presetId: "front",
  azimuthDeg: 0,
  elevationDeg: 12,
  intensity: 45,
  colorHex: "#FFFFFF",
};

const DEFAULT_IMAGE_LIGHTING_RIG = {
  main: {
    enabled: false,
    presetId: "right",
    azimuthDeg: 45,
    elevationDeg: 18,
    intensity: 58,
    colorHex: "#FFFFFF",
  },
  fill: {
    enabled: false,
    presetId: "left",
    azimuthDeg: 315,
    elevationDeg: 10,
    intensity: 26,
    colorHex: "#FFFFFF",
  },
};

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clampFinite(value, min, max, fallback) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeDegrees(value, fallback) {
  const numeric = clampFinite(value, -36000, 36000, fallback);
  const normalized = ((numeric % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return fallback;
}

function isCameraPresetId(value) {
  return IMAGE_CAMERA_PRESETS.some((preset) => preset.id === value);
}

function isLightPresetId(value) {
  return IMAGE_LIGHT_PRESETS.some((preset) => preset.id === value);
}

function normalizeImageCameraControl(value) {
  const raw = isPlainRecord(value) ? value : {};
  return {
    enabled: Boolean(raw.enabled),
    presetId: isCameraPresetId(raw.presetId) ? raw.presetId : DEFAULT_IMAGE_CAMERA_CONTROL.presetId,
    azimuthDeg: normalizeDegrees(raw.azimuthDeg, DEFAULT_IMAGE_CAMERA_CONTROL.azimuthDeg),
    elevationDeg: clampFinite(raw.elevationDeg, -45, 45, DEFAULT_IMAGE_CAMERA_CONTROL.elevationDeg),
    distance: clampFinite(raw.distance, 0.7, 3.8, DEFAULT_IMAGE_CAMERA_CONTROL.distance),
  };
}

function normalizeImageLightControl(value, fallback) {
  const raw = isPlainRecord(value) ? value : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    presetId: isLightPresetId(raw.presetId) ? raw.presetId : fallback.presetId,
    azimuthDeg: normalizeDegrees(raw.azimuthDeg, fallback.azimuthDeg),
    elevationDeg: clampFinite(raw.elevationDeg, -45, 60, fallback.elevationDeg),
    intensity: clampFinite(raw.intensity, 0, 100, fallback.intensity),
    colorHex: normalizeHexColor(raw.colorHex, fallback.colorHex),
  };
}

function normalizeImageLightingRig(value) {
  const raw = isPlainRecord(value) ? value : {};
  return {
    main: normalizeImageLightControl(raw.main, DEFAULT_IMAGE_LIGHTING_RIG.main),
    fill: normalizeImageLightControl(raw.fill, DEFAULT_IMAGE_LIGHTING_RIG.fill),
  };
}

function hasActiveImageCameraControl(value) {
  return normalizeImageCameraControl(value).enabled;
}

function hasActiveImageLightingRig(value) {
  const rig = normalizeImageLightingRig(value);
  return rig.main.enabled || rig.fill.enabled;
}

function describeCameraView(azimuthDeg) {
  const rounded = Math.round(normalizeDegrees(azimuthDeg, 0));
  if (rounded < 23 || rounded >= 338) return "front view";
  if (rounded < 68) return "front-right three-quarter view";
  if (rounded < 113) return "right side view";
  if (rounded < 158) return "rear-right three-quarter view";
  if (rounded < 203) return "rear view";
  if (rounded < 248) return "rear-left three-quarter view";
  if (rounded < 293) return "left side view";
  return "front-left three-quarter view";
}

function describeCameraElevation(elevationDeg) {
  const rounded = Math.round(clampFinite(elevationDeg, -45, 45, 0));
  if (rounded <= -28) return "pronounced low-angle view";
  if (rounded <= -10) return "slightly low-angle view";
  if (rounded < 12) return "eye-level view";
  if (rounded < 28) return "slightly high-angle view";
  return "high-angle view";
}

function describeCameraDistance(distance) {
  const numeric = clampFinite(distance, 0.7, 3.8, DEFAULT_IMAGE_CAMERA_CONTROL.distance);
  if (numeric <= 0.95) return "extreme close-up";
  if (numeric <= 1.2) return "close-up";
  if (numeric <= 1.6) return "medium close-up";
  if (numeric <= 2.05) return "medium shot";
  if (numeric <= 2.45) return "full shot";
  if (numeric <= 3.0) return "wide shot";
  return "extreme wide shot";
}

function describeLightDirection(azimuthDeg, elevationDeg) {
  const horizontal = (() => {
    const rounded = Math.round(normalizeDegrees(azimuthDeg, 0));
    if (rounded < 23 || rounded >= 338) return "front";
    if (rounded < 68) return "front-right";
    if (rounded < 113) return "right";
    if (rounded < 158) return "rear-right";
    if (rounded < 203) return "rear";
    if (rounded < 248) return "rear-left";
    if (rounded < 293) return "left";
    return "front-left";
  })();

  const vertical = (() => {
    const rounded = Math.round(clampFinite(elevationDeg, -45, 60, 0));
    if (rounded <= -22) return "from below";
    if (rounded <= 10) return "at subject height";
    if (rounded <= 28) return "slightly elevated";
    return "from above";
  })();

  return `${horizontal}, ${vertical}`;
}

function describeLightIntensity(intensity) {
  const numeric = clampFinite(intensity, 0, 100, 0);
  if (numeric < 18) return "very subtle";
  if (numeric < 36) return "soft";
  if (numeric < 60) return "balanced";
  if (numeric < 82) return "strong";
  return "dramatic";
}

function buildImageCameraPrompt(value) {
  const config = normalizeImageCameraControl(value);
  if (!config.enabled) return "";
  return [
    `Camera control: ${describeCameraView(config.azimuthDeg)}, ${describeCameraElevation(config.elevationDeg)}, ${describeCameraDistance(config.distance)}.`,
    `Use 3D-editor style camera positioning (${Math.round(config.azimuthDeg)}° orbit, ${Math.round(config.elevationDeg)}° elevation, distance ${config.distance.toFixed(2)}).`,
    "If this request uses reference images, keep the same subject identity, pose logic, outfit cues, scene anchors, and fine details while changing only the camera viewpoint.",
  ].join(" ");
}

function buildLightPrompt(label, value) {
  const config = normalizeImageLightControl(value, DEFAULT_IMAGE_LIGHT_CONTROL);
  if (!config.enabled) return "";
  const roleLabel = label === "fill" ? "Fill light" : "Main key light";
  return `${roleLabel}: ${describeLightIntensity(config.intensity)} ${config.colorHex} light from ${describeLightDirection(config.azimuthDeg, config.elevationDeg)} (${Math.round(config.azimuthDeg)}° azimuth, ${Math.round(config.elevationDeg)}° elevation), intensity ${Math.round(config.intensity)}%.`;
}

function buildImageLightingPrompt(value) {
  const rig = normalizeImageLightingRig(value);
  const parts = [
    buildLightPrompt("main", rig.main),
    buildLightPrompt("fill", rig.fill),
  ].filter(Boolean);
  if (!parts.length) return "";
  return [
    "Lighting control:",
    ...parts,
    "If this request uses reference images, relight the same scene while preserving subject identity, background layout, material texture, and detail continuity.",
  ].join(" ");
}

function appendImageViewPrompt(prompt, input) {
  const basePrompt = typeof prompt === "string" ? prompt.trim() : "";
  const raw = isPlainRecord(input) ? input : {};
  const sections = [
    basePrompt,
    buildImageCameraPrompt(raw.cameraControl),
    buildImageLightingPrompt(raw.lightingRig),
  ].filter(Boolean);
  return sections.join("\n\n");
}

module.exports = {
  IMAGE_CAMERA_PRESETS,
  IMAGE_LIGHT_PRESETS,
  DEFAULT_IMAGE_CAMERA_CONTROL,
  DEFAULT_IMAGE_LIGHT_CONTROL,
  DEFAULT_IMAGE_LIGHTING_RIG,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
  hasActiveImageCameraControl,
  hasActiveImageLightingRig,
  buildImageCameraPrompt,
  buildImageLightingPrompt,
  appendImageViewPrompt,
};
