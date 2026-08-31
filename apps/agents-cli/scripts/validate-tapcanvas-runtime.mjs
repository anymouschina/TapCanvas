const apiBaseUrl = requireValue("AGENTS_API_BASE_URL").replace(/\/+$/, "");
requireValue("AGENTS_API_KEY");
const apiStyle = readApiStyle(process.env.AGENTS_API_STYLE);

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(apiBaseUrl);
} catch {
  throw new Error("AGENTS_API_BASE_URL must be an absolute HTTP(S) URL");
}
if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
  throw new Error("AGENTS_API_BASE_URL must use HTTP or HTTPS");
}

console.log(
  `[agents-runtime] validated ${parsedBaseUrl.origin} with ${apiStyle} protocol; credentials are configured`,
);

function requireValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for TapCanvas agents runtime`);
  return value;
}

function readApiStyle(raw) {
  const value = String(raw || "chat").trim().toLowerCase();
  if (value === "chat" || value === "responses") return value;
  throw new Error("AGENTS_API_STYLE must be chat or responses");
}
