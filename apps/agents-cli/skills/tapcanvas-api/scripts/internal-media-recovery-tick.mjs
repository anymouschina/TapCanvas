#!/usr/bin/env node

const baseUrl = String(process.env.TAPCANVAS_API_BASE_URL || "http://127.0.0.1:8788")
  .trim()
  .replace(/\/+$/, "");
const internalToken = String(process.env.INTERNAL_WORKER_TOKEN || "").trim();

if (!internalToken) {
  throw new Error("Missing INTERNAL_WORKER_TOKEN inside the API container.");
}

const url = `${baseUrl}/internal/media-recovery/run`;
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${internalToken}`,
  },
});
const responseText = await response.text();
let data;
try {
  data = responseText ? JSON.parse(responseText) : null;
} catch {
  data = responseText;
}

if (!response.ok) {
  throw new Error(
    JSON.stringify(
      {
        endpoint: "mediaRecoveryTick",
        url,
        status: response.status,
        statusText: response.statusText,
        response: data,
      },
      null,
      2,
    ),
  );
}

process.stdout.write(`${JSON.stringify({ endpoint: "mediaRecoveryTick", url, data }, null, 2)}\n`);
