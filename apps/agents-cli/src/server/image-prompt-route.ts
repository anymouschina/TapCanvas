import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  parseImagePromptSpecialistExecutionRequest,
  parseImagePromptSpecialistResponse,
  type ImagePromptSpecialistErrorCode,
  type ImagePromptSpecialistRequestV1,
  type ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract.js";
import { ImagePromptSpecialistFailure } from "./image-prompt-specialist.js";

export type ImagePromptSpecialistHandler = (
  request: ImagePromptSpecialistRequestV1,
  relayGrant: string,
  abortSignal: AbortSignal,
) => Promise<ImagePromptSpecialistResponseV1>;

type ImagePromptRouteOptions = {
  token: string;
  bodyLimitBytes: number;
  execute: ImagePromptSpecialistHandler;
};

const MIN_PRIVATE_TOKEN_BYTES = 32;
const MAX_PRIVATE_TOKEN_BYTES = 512;

class ImagePromptRequestBodyTooLarge extends Error {}

export function normalizeImagePromptSpecialistToken(value: string): string {
  const token = value.trim();
  const byteLength = Buffer.byteLength(token, "utf8");
  if (byteLength < MIN_PRIVATE_TOKEN_BYTES || byteLength > MAX_PRIVATE_TOKEN_BYTES) {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      `agents specialist token must contain at least ${MIN_PRIVATE_TOKEN_BYTES} UTF-8 bytes and at most ${MAX_PRIVATE_TOKEN_BYTES} UTF-8 bytes`,
    );
  }
  return token;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function headerValue(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim();
  return "";
}

function bearerToken(req: IncomingMessage): string {
  const authorization = headerValue(req, "authorization");
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    expectedBuffer.length > 0 &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function readJsonBody(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > bodyLimitBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) throw new ImagePromptRequestBodyTooLarge();
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return Symbol.for("invalid-json");
  }
}

function failureStatus(code: ImagePromptSpecialistErrorCode): number {
  if (code === "specialist_request_invalid" || code === "specialist_evidence_invalid") {
    return 400;
  }
  if (code === "specialist_timeout") return 504;
  if (code === "specialist_unavailable") return 503;
  return 502;
}

function createAbortSignal(req: IncomingMessage, res: ServerResponse): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let finished = false;
  const onFinish = () => {
    finished = true;
  };
  const onAborted = () => controller.abort(new Error("specialist client aborted"));
  const onClose = () => {
    if (!finished) controller.abort(new Error("specialist client disconnected"));
  };
  res.on("finish", onFinish);
  req.on("aborted", onAborted);
  res.on("close", onClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      res.off("finish", onFinish);
      req.off("aborted", onAborted);
      res.off("close", onClose);
    },
  };
}

export async function handleImagePromptSpecialistRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: ImagePromptRouteOptions,
): Promise<void> {
  if (!tokenMatches(options.token, bearerToken(req))) {
    json(res, 401, { code: "specialist_auth_invalid" });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, options.bodyLimitBytes);
  } catch (error) {
    if (error instanceof ImagePromptRequestBodyTooLarge) {
      json(res, 413, { code: "specialist_request_invalid", reason: "request body too large" });
      return;
    }
    throw error;
  }
  const parsed = parseImagePromptSpecialistExecutionRequest(body);
  if (!parsed.ok) {
    json(res, 400, { code: "specialist_request_invalid", reason: parsed.error });
    return;
  }

  const abort = createAbortSignal(req, res);
  const startedAt = Date.now();
  try {
    const response = await options.execute(
      parsed.value.request,
      parsed.value.relayGrant,
      abort.signal,
    );
    const parsedResponse = parseImagePromptSpecialistResponse(response);
    if (!parsedResponse.ok) {
      throw new ImagePromptSpecialistFailure(
        "specialist_output_invalid",
        parsedResponse.error,
      );
    }
    console.log(
      `[agents] image_prompt_specialist completed request=${parsed.value.request.requestId} correlation=${parsed.value.request.correlationId} model=${parsedResponse.value.trace.model.effectiveModel} references=${parsed.value.request.evidence.references.length} promptChars=${parsedResponse.value.imagePrompt.length} totalTokens=${parsedResponse.value.trace.usage.totalTokens} elapsedMs=${Date.now() - startedAt}`,
    );
    json(res, 200, parsedResponse.value);
  } catch (error) {
    const failure =
      error instanceof ImagePromptSpecialistFailure
        ? error
        : new ImagePromptSpecialistFailure(
            "specialist_unavailable",
            error instanceof Error ? error.message : String(error),
          );
    console.error(
      `[agents] image_prompt_specialist failed request=${parsed.value.request.requestId} correlation=${parsed.value.request.correlationId} code=${failure.code} elapsedMs=${Date.now() - startedAt}`,
    );
    if (!res.headersSent) {
      json(res, failureStatus(failure.code), {
        code: failure.code,
        requestId: parsed.value.request.requestId,
        correlationId: parsed.value.request.correlationId,
        reason: failure.message,
      });
    }
  } finally {
    abort.cleanup();
  }
}
