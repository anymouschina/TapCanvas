const PROFILE_NAMES = Object.freeze(["local", "production"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProfile(value) {
  const profile = String(value || "").trim();
  if (!PROFILE_NAMES.includes(profile)) {
    throw new Error("Missing --profile. Choose local or production explicitly.");
  }
  return profile;
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function normalizeBaseUrl(profile, value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  if (!normalized) throw new Error(`Profile ${profile} is missing apiBaseUrl.`);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Profile ${profile} apiBaseUrl is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Profile ${profile} apiBaseUrl must use HTTP(S).`);
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (profile === "local" && !loopback) {
    throw new Error("Profile local must use localhost, 127.0.0.0/8, or ::1.");
  }
  if (profile === "production" && (loopback || parsed.protocol !== "https:")) {
    throw new Error("Profile production must use non-loopback HTTPS.");
  }
  return normalized;
}

export function resolveProfileCredentials(input) {
  const profile = normalizeProfile(input.args.profile || input.environment.TAPCANVAS_PROFILE);
  const config = input.config;
  if (!isRecord(config) || config.version !== 2 || !isRecord(config.profiles)) {
    throw new Error(`Config ${input.configPath} must use version=2 with profiles.`);
  }
  const stored = config.profiles[profile];
  if (!isRecord(stored)) {
    throw new Error(`Profile ${profile} is not configured in ${input.configPath}.`);
  }
  const apiBaseUrl = normalizeBaseUrl(
    profile,
    input.args.apiBaseUrl || stored.apiBaseUrl || input.environment.TAPCANVAS_API_BASE_URL,
  );
  const apiKey = String(
    input.args.apiKey || stored.apiKey || input.environment.TAPCANVAS_API_KEY || "",
  ).trim();
  const authToken = String(
    input.args.authToken || stored.authToken || input.environment.TAPCANVAS_AUTH_TOKEN || "",
  ).trim();
  if (!apiKey && !authToken) {
    throw new Error(`Profile ${profile} is missing auth credentials in ${input.configPath}.`);
  }
  return { profile, apiBaseUrl, apiKey, authToken };
}

export function profileRequestBaseUrl(input) {
  const profile = normalizeProfile(input.profile);
  const apiBaseUrl = normalizeBaseUrl(profile, input.apiBaseUrl);
  return profile === "production" && input.access === "protected"
    ? `${apiBaseUrl}/api`
    : apiBaseUrl;
}
