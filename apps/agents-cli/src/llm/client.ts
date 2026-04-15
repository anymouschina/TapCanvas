import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createRequire } from "node:module";
import { AgentConfig, LLMRequest, LLMResponse, Message, ToolCall, ToolDefinition } from "../types/index.js";
import { normalizeToolOutput } from "../core/message-limits.js";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type JsonObject = Record<string, unknown>;

type ResponsesContentPart = {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
};

type ResponsesOutputItem = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
  name?: unknown;
  call_id?: unknown;
  arguments?: unknown;
  function?: {
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
  content?: ResponsesContentPart[];
  tool_calls?: ResponsesOutputItem[];
  role?: unknown;
};

type EventStreamState = {
  output?: ResponsesOutputItem[];
  output_text?: string;
  response?: JsonObject;
} & JsonObject;

type LlmRequestMessageSummary = {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolMessageCount: number;
  assistantToolCallCount: number;
  totalMessageChars: number;
  userMessageChars: number;
  assistantMessageChars: number;
  toolMessageChars: number;
  maxSingleMessageChars: number;
  maxToolMessageChars: number;
  toolMessagesOver16k: number;
  largestToolMessages: Array<{
    toolCallId: string;
    chars: number;
  }>;
};

type LlmRequestSummary = LlmRequestMessageSummary & {
  apiStyle: "chat" | "responses";
  url: string;
  model: string;
  retry: number;
  stream: boolean;
  systemChars: number;
  toolDefinitions: number;
  approxPayloadChars: number;
  inputItems?: number;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOutputItems(value: unknown): ResponsesOutputItem[] {
  return Array.isArray(value) ? value.filter((item): item is ResponsesOutputItem => Boolean(asObject(item))) : [];
}

let dnsConfigured = false;
const nodeFetchDispatcherCache = new Map<number, unknown>();
const requireNodeModule = createRequire(import.meta.url);

export class LLMClient {
  private responsesInstructionsKey: "instructions" | "system" = "instructions";
  private responsesToolOutputType: "function_call_output" | "tool_result" = "function_call_output";

  constructor(private config: AgentConfig) {
    configureDnsResultOrderOnce();
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const apiStyle = this.config.apiStyle;
    if (apiStyle === "chat") {
      return this.callChat(request);
    }
    return this.callResponses(request);
  }

  private resolveModel(request: LLMRequest): string {
    const requestModel = typeof request.model === "string" ? request.model.trim() : "";
    return requestModel || this.config.model;
  }

  private buildChatMessages(messages: Message[]): ChatMessage[] {
    return messages.map((m) => {
      const msg: ChatMessage = {
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      };
      if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls
          .filter((call) => Boolean(call?.name))
          .map((call) => ({
            id: call.id ?? randomUUID(),
            type: "function" as const,
            function: {
              name: call.name,
              arguments: call.arguments ?? "{}",
            },
          }));
      }
      return msg;
    });
  }

  private buildResponsesInput(messages: Message[]) {
    const items: JsonObject[] = [];
    for (const m of messages) {
      if (m.role === "tool") {
        items.push(this.buildResponsesToolOutputItem(m));
        continue;
      }

      if (m.content) {
        const contentType = m.role === "assistant" ? "output_text" : "input_text";
        items.push({
          type: "message",
          role: m.role,
          content: [{ type: contentType, text: m.content }],
        });
      }

      if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        for (const call of m.toolCalls) {
          if (!call?.name) continue;
          items.push(this.buildResponsesToolCallItem(call));
        }
      }
    }
    return items;
  }

  private buildResponsesToolCallItem(call: ToolCall) {
    if (this.responsesToolOutputType === "function_call_output") {
      return {
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments ?? "{}",
      };
    }
    return {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments ?? "{}",
    };
  }

  private buildResponsesToolOutputItem(m: Message) {
    const toolCallId = m.toolCallId || randomUUID();
    const output = normalizeToolOutput(m.content, `tool-call:${toolCallId}`);
    if (this.responsesToolOutputType === "function_call_output") {
      return {
        type: "function_call_output",
        call_id: toolCallId,
        output,
      };
    }
    return {
      type: "tool_result",
      tool_call_id: toolCallId,
      content: [{ type: "output_text", text: output }],
    };
  }

  private toChatTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private toResponsesTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  private async callChat(request: LLMRequest, retry = 0): Promise<LLMResponse> {
    assertToolLinkage(request.messages);
    const toolLinkage = summarizeToolLinkage(request.messages);
    const resolvedModel = this.resolveModel(request);
    const payload = {
        model: resolvedModel,
      messages: [{ role: "system", content: request.system }, ...this.buildChatMessages(request.messages)],
      tools: this.toChatTools(request.tools),
      stream: this.config.stream,
    };
    const requestSummary = buildLlmRequestSummary({
      apiStyle: "chat",
      url: `${this.config.apiBaseUrl}/chat/completions`,
      model: resolvedModel,
      retry,
      stream: this.config.stream,
      systemChars: String(request.system || "").length,
      messages: request.messages,
      toolDefinitions: payload.tools.length,
      payload,
    });
    this.debugLog("chat.request", {
      ...requestSummary,
      messages: payload.messages.length,
      toolLinkage,
      payloadPreview: shouldLogPayload()
        ? safePreview(payload).slice(0, 4000)
        : undefined,
    });

    let res: Response;
    try {
      res = await this.safeFetch(`${this.config.apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      });
    } catch (error) {
      throw attachRequestSummaryToError(error, requestSummary);
    }

    if (!res.ok) {
      const text = await res.text();
      if (isRetryableHttpStatus(res.status) && retry < 2) {
        await sleep(500 * (retry + 1));
        return this.callChat(request, retry + 1);
      }
      throw createHttpStatusError({
        status: res.status,
        bodyText: text,
        requestSummary,
      });
    }

    const json = asObject(await this.parseResponseBody(res, request.onTextDelta)) ?? {};
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = asObject(choices[0]);
    const choiceMessage = asObject(firstChoice?.message);
    const rawToolCalls = Array.isArray(choiceMessage?.tool_calls)
      ? choiceMessage.tool_calls
      : [];
    this.debugLog("chat.response", {
      model: this.config.model,
      hasChoices: Array.isArray(json?.choices) && json.choices.length > 0,
      choiceCount: Array.isArray(json?.choices) ? json.choices.length : 0,
      rawToolCallCount: rawToolCalls.length,
      rawToolCallIds: rawToolCalls
        .map((call) => {
          const record = asObject(call);
          const fn = asObject(record?.function);
          return String(record?.id ?? record?.call_id ?? fn?.id ?? "").trim();
        })
        .filter(Boolean),
    });
    const text = asString(choiceMessage?.content);
    const toolCalls = this.parseChatToolCalls(rawToolCalls);
    this.debugLog("chat.response.tool_calls.normalized", {
      normalizedCount: toolCalls.length,
      normalizedIds: toolCalls.map((call) => call.id),
      normalizedNames: toolCalls.map((call) => call.name),
    });

    return { text, toolCalls };
  }

  private async callResponses(request: LLMRequest, retry = 0): Promise<LLMResponse> {
    assertToolLinkage(request.messages);
    const resolvedModel = this.resolveModel(request);
    const payload: JsonObject = {
      model: resolvedModel,
      input: this.buildResponsesInput(request.messages),
      tools: this.toResponsesTools(request.tools),
      stream: this.config.stream,
    };

    if (request.system) {
      if (this.responsesInstructionsKey === "instructions") {
        payload.instructions = request.system;
      } else {
        payload.system = request.system;
      }
    }
    const requestSummary = buildLlmRequestSummary({
      apiStyle: "responses",
      url: `${this.config.apiBaseUrl}/responses`,
      model: resolvedModel,
      retry,
      stream: this.config.stream,
      systemChars: String(request.system || "").length,
      messages: request.messages,
      toolDefinitions: Array.isArray(payload.tools) ? payload.tools.length : 0,
      payload,
      inputItems: Array.isArray(payload.input) ? payload.input.length : 0,
    });
    this.debugLog("responses.request", {
      ...requestSummary,
      instructionsKey: this.responsesInstructionsKey,
      toolOutputType: this.responsesToolOutputType,
      payloadPreview: shouldLogPayload()
        ? safePreview(payload).slice(0, 4000)
        : undefined,
    });

    let res: Response;
    try {
      res = await this.safeFetch(`${this.config.apiBaseUrl}/responses`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
      });
    } catch (error) {
      throw attachRequestSummaryToError(error, requestSummary);
    }

    if (!res.ok) {
      const text = await res.text();
      if (isRetryableHttpStatus(res.status) && retry < 2) {
        await sleep(500 * (retry + 1));
        return this.callResponses(request, retry + 1);
      }
      if (res.status === 400 && retry < 2) {
        if (request.system && text.includes("Unsupported parameter: system") && this.responsesInstructionsKey === "system") {
          this.responsesInstructionsKey = "instructions";
          return this.callResponses(request, retry + 1);
        }
        if (request.system && text.includes("Unsupported parameter: instructions") && this.responsesInstructionsKey === "instructions") {
          this.responsesInstructionsKey = "system";
          return this.callResponses(request, retry + 1);
        }

        if (
          (text.includes("Unsupported type") || text.includes("Invalid type")) &&
          (text.includes("function_call_output") || text.includes("call_id")) &&
          this.responsesToolOutputType === "tool_result"
        ) {
          this.responsesToolOutputType = "function_call_output";
          return this.callResponses(request, retry + 1);
        }
        if (
          (text.includes("Unsupported type") || text.includes("Invalid type")) &&
          (text.includes("tool_result") || text.includes("tool_call_id")) &&
          this.responsesToolOutputType === "function_call_output"
        ) {
          this.responsesToolOutputType = "tool_result";
          return this.callResponses(request, retry + 1);
        }
      }
      throw createHttpStatusError({
        status: res.status,
        bodyText: text,
        requestSummary,
      });
    }

    const initialJson = (await this.parseResponseBody(res, request.onTextDelta)) as Record<string, unknown>;
    const json = await this.resolveResponsesLifecycle(initialJson, {
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
    });
    this.debugLog("responses.response", {
      model: this.config.model,
      status: String((json as Record<string, unknown>)?.status || ""),
      outputItems: Array.isArray((json as Record<string, unknown>)?.output)
        ? (((json as Record<string, unknown>).output as unknown[]) || []).length
        : 0,
      outputTextChars:
        typeof (json as Record<string, unknown>)?.output_text === "string"
          ? String((json as Record<string, unknown>).output_text).length
          : 0,
    });
    if (json?.error) {
      throw new Error(`LLM 返回错误: ${safePreview(json.error)}`);
    }
    const output = asOutputItems(json.output);

    if (output.some((item) => item.type === "function_call")) {
      this.responsesToolOutputType = "function_call_output";
    } else if (output.some((item) => item.type === "tool_call")) {
      this.responsesToolOutputType = "tool_result";
    }

    const toolCalls = this.parseResponsesToolCalls(output);
    const extractedText = this.extractResponsesText(output);
    const outputText = typeof json.output_text === "string" ? json.output_text : "";
    const text = extractedText || outputText || "";

    if (!text && toolCalls.length === 0) {
      const status = String((json as Record<string, unknown>)?.status || "").trim().toLowerCase();
      const inProgressRetryMax = parsePositiveInt(process.env.AGENTS_RESPONSES_IN_PROGRESS_RETRIES, 3);
      if ((status === "in_progress" || status === "queued" || status === "processing") && retry < inProgressRetryMax) {
        await sleep(1200 * (retry + 1));
        return this.callResponses(request, retry + 1);
      }
      const preview = safePreview({
        ...json,
        ...(typeof json.instructions === "string" ? { instructions: `${json.instructions.slice(0, 400)}…` } : {}),
        ...(typeof json.system === "string" ? { system: `${json.system.slice(0, 400)}…` } : {}),
      });
      const outputTypes = output.map((item) => item.type).filter(Boolean);
      throw new Error(`LLM 返回空响应: outputTypes=${JSON.stringify(outputTypes)} preview=${preview}`);
    }

    return { text, toolCalls };
  }

  private async resolveResponsesLifecycle(
    initial: Record<string, unknown>,
    options?: {
      pollBaseUrl?: string;
      pollPathPrefix?: string;
      headers?: Record<string, string>;
      abortSignal?: AbortSignal;
    },
  ): Promise<Record<string, unknown>> {
    const status = String(initial.status || "").trim().toLowerCase();
    const id = String(initial.id || "").trim();
    const hasOutput = Array.isArray(initial.output) && initial.output.length > 0;
    const hasOutputText =
      typeof initial.output_text === "string" && initial.output_text.trim().length > 0;

    if (!id || hasOutput || hasOutputText) return initial;
    if (status === "completed" || status === "failed" || status === "cancelled") return initial;
    if (status !== "in_progress" && status !== "queued" && status !== "processing") return initial;

    // Some gateways return an in_progress shell object first; poll by id for final content.
    const timeoutMs = parsePositiveInt(process.env.AGENTS_RESPONSES_POLL_TIMEOUT_MS, 45_000);
    const intervalMs = parsePositiveInt(process.env.AGENTS_RESPONSES_POLL_INTERVAL_MS, 800);
    const deadline = Date.now() + timeoutMs;
    let latest: Record<string, unknown> = initial;

    while (Date.now() < deadline) {
      throwIfAborted(options?.abortSignal);
      await sleep(intervalMs);
      let res: Response | null = null;
      try {
        const base = String(options?.pollBaseUrl || this.config.apiBaseUrl || "").replace(/\/+$/, "");
        const prefix = String(options?.pollPathPrefix || "/responses").replace(/\/+$/, "");
        res = await this.safeFetch(`${base}${prefix}/${encodeURIComponent(id)}`, {
          method: "GET",
          headers: options?.headers ?? this.buildHeaders(),
          ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
        });
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const polled = (await this.parseResponseBody(res)) as Record<string, unknown>;
      latest = polled;
      const polledStatus = String(polled.status || "").trim().toLowerCase();
      const polledHasOutput = Array.isArray(polled.output) && polled.output.length > 0;
      const polledHasOutputText =
        typeof polled.output_text === "string" && polled.output_text.trim().length > 0;

      if (polledHasOutput || polledHasOutputText) return polled;
      if (polledStatus === "completed" || polledStatus === "failed" || polledStatus === "cancelled") {
        return polled;
      }
    }

    return latest;
  }

  private async safeFetch(url: string, init: RequestInit): Promise<Response> {
    const timeoutMs = parseTimeoutMs(process.env.AGENTS_REQUEST_TIMEOUT_MS);
    const retries = parseRetryCount(process.env.AGENTS_FETCH_RETRIES);
    let lastError: unknown;
    const candidateUrls = buildCandidateUrls(url);

    for (const requestUrl of candidateUrls) {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const signal = buildFetchAbortSignal(timeoutMs, init.signal ?? null);
        try {
          const dispatcher = await createNodeFetchDispatcher(timeoutMs);
          const initWithSignal: RequestInit & { dispatcher?: unknown } = signal.signal
            ? { ...init, signal: signal.signal }
            : { ...init };
          if (dispatcher) {
            initWithSignal.dispatcher = dispatcher;
          }
          return await fetch(requestUrl, initWithSignal);
        } catch (error) {
          lastError = error;
          if (!isRetryableFetchError(error) || attempt >= retries) {
            break;
          }
          await sleep(Math.min(1200, 250 * (attempt + 1)));
        } finally {
          signal.cleanup();
        }
      }
    }

    throw wrapFetchError(lastError, url, this.config.apiBaseUrl, timeoutMs, retries);
  }

  private extractResponsesText(output: ResponsesOutputItem[]): string {
    const chunks: string[] = [];
    for (const item of output) {
      if (item.type === "output_text" && typeof item.text === "string") {
        chunks.push(item.text);
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        chunks.push(item.text);
        continue;
      }
      if (item.type === "refusal" && typeof item.refusal === "string") {
        chunks.push(item.refusal);
        continue;
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" || part.type === "text") {
            if (typeof part.text === "string") {
              chunks.push(part.text);
            }
          }
          if (part.type === "refusal") {
            const refusal = typeof part.refusal === "string" ? part.refusal : typeof part.text === "string" ? part.text : "";
            if (refusal) chunks.push(refusal);
          }
        }
      }
    }
    return chunks.join("");
  }

  private parseResponsesToolCalls(output: ResponsesOutputItem[]): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const item of output) {
      if (item.type === "function_call" || item.type === "tool_call") {
        const id = asString(item.call_id) || asString(item.id) || randomUUID();
        const name = asString(item.name) || asString(item.function?.name);
        const rawArgs = item.arguments ?? item.function?.arguments ?? "{}";
        const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
        if (name) calls.push({ id, name, arguments: args });
        continue;
      }

      if (item.type === "message" && Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls) {
          const id = asString(call.id) || asString(call.call_id) || randomUUID();
          const name = asString(call.name) || asString(call.function?.name);
          const rawArgs = call.arguments ?? call.function?.arguments ?? "{}";
          const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
          if (name) calls.push({ id, name, arguments: args });
        }
      }
    }
    return calls;
  }

  private parseChatToolCalls(toolCalls: unknown[]): ToolCall[] {
    return toolCalls
      .map((call) => {
        const record = asObject(call) ?? {};
        const fn = asObject(record.function) ?? {};
        return {
        // Different gateways may return id under `id`, `call_id`, or nested function.id.
          id: asString(record.id) || asString(record.call_id) || asString(fn.id) || randomUUID(),
          name: asString(fn.name),
          arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        };
      })
      .filter((call): call is ToolCall => Boolean(call.name));
  }

  private async parseResponseBody(res: Response, onTextDelta?: (delta: string) => void) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const raw = await res.text();
      if (!raw.trim()) {
        this.debugLog("response.raw.empty", {
          contentType,
          status: res.status,
        });
        return {};
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        this.debugLog("response.raw.parse_failed", {
          contentType,
          status: res.status,
          bodyPreview: raw.slice(0, 4000),
          error: String((err as Error)?.message || err || ""),
        });
        throw err;
      }
    }
    if (!res.body) {
      return {};
    }
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const parser = createEventStreamParser(onTextDelta);
    let chunkChars = 0;
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      chunkChars += value?.length ?? 0;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
        pending = pending.slice(newlineIndex + 1);
        parser.pushLine(line);
        newlineIndex = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending) {
      for (const line of pending.replace(/\r\n/g, "\n").split("\n")) {
        parser.pushLine(line.replace(/\r$/, ""));
      }
    }
    const parsed = parser.finish();
    this.debugLog("response.sse.raw", {
      status: res.status,
      bodyChars: chunkChars,
      bodyPreview: shouldLogPayload() ? safePreview(parsed).slice(0, 4000) : undefined,
    });
    return parsed;
  }

  private debugLog(event: string, details: Record<string, unknown>) {
    if (!isLlmDebugEnabled()) return;
    try {
      console.info(`[agents.llm.debug] ${event} ${safePreview(details)}`);
    } catch {
      // ignore log failures
    }
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
      headers["x-api-key"] = this.config.apiKey;
    }

    return headers;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function createEventStreamParser(onTextDelta?: (delta: string) => void) {
  let lastJson: EventStreamState = {};
  let outputText = "";
  const outputItems: Array<ResponsesOutputItem | undefined> = [];
  const outputIndexById = new Map<string, number>();
  let buffer: string[] = [];

  const toIndex = (value: unknown, itemId?: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    if (typeof itemId === "string" && outputIndexById.has(itemId)) {
      return outputIndexById.get(itemId) ?? -1;
    }
    return -1;
  };

  const ensureMessageItem = (index: number, itemId?: unknown) => {
    if (!outputItems[index]) {
      outputItems[index] = {
        id: typeof itemId === "string" && itemId ? itemId : randomUUID(),
        type: "message",
        role: "assistant",
        content: [],
      };
    }
    const item = outputItems[index];
    if (!item) {
      throw new Error(`Missing message item at index ${index}`);
    }
    if (!Array.isArray(item.content)) {
      item.content = [];
    }
    if (typeof item.id === "string") {
      outputIndexById.set(item.id, index);
    }
    return item;
  };

  const ensureFunctionCallItem = (index: number, itemId?: unknown) => {
    if (!outputItems[index]) {
      outputItems[index] = {
        id: typeof itemId === "string" && itemId ? itemId : randomUUID(),
        type: "function_call",
        arguments: "",
      };
    }
    const item = outputItems[index];
    if (!item) {
      throw new Error(`Missing function call item at index ${index}`);
    }
    if (typeof item.arguments !== "string") item.arguments = "";
    if (typeof item.id === "string") {
      outputIndexById.set(item.id, index);
    }
    return item;
  };

  const handleEvent = (parsed: JsonObject) => {
    const response = asObject(parsed.response);
    if (response) {
      lastJson = response as EventStreamState;
      if (typeof response.output_text === "string" && !outputText) {
        outputText = response.output_text;
      }
    }

    const type = asString(parsed.type);

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = asObject(parsed.item) as ResponsesOutputItem | null;
      if (!item) return;
      const itemId = item.id ?? parsed.item_id;
      const index = toIndex(parsed.output_index, itemId);
      if (index >= 0) {
        outputItems[index] = item;
        if (typeof item.id === "string") outputIndexById.set(item.id, index);
      } else if (typeof item.id === "string" && outputIndexById.has(item.id)) {
        const existingIndex = outputIndexById.get(item.id);
        if (typeof existingIndex === "number") {
          outputItems[existingIndex] = item;
        }
      } else {
        const nextIndex = outputItems.length;
        outputItems.push(item);
        if (typeof item.id === "string") outputIndexById.set(item.id, nextIndex);
      }
      return;
    }

    if (type === "response.content_part.added" || type === "response.content_part.done") {
      const part = asObject(parsed.part) as ResponsesContentPart | null;
      if (!part) return;
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index < 0 || contentIndex < 0) return;
      const item = ensureMessageItem(index, parsed.item_id);
      if (!Array.isArray(item.content)) item.content = [];
      item.content[contentIndex] = part;
      const partText = typeof part.text === "string" ? part.text : "";
      if (partText && (!outputText || partText.length >= outputText.length)) {
        outputText = partText;
      }
      return;
    }

    if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
      outputText += parsed.delta;
      onTextDelta?.(parsed.delta);
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index >= 0 && contentIndex >= 0) {
        const item = ensureMessageItem(index, parsed.item_id);
        if (!Array.isArray(item.content)) item.content = [];
        const currentPart = item.content[contentIndex];
        const part: ResponsesContentPart =
          currentPart && typeof currentPart === "object" && !Array.isArray(currentPart)
            ? currentPart
            : { type: "output_text", text: "" };
        const currentText = typeof part.text === "string" ? part.text : "";
        part.text = currentText + parsed.delta;
        item.content[contentIndex] = part;
      }
      return;
    }

    if (type === "response.output_text.done" && typeof parsed.text === "string") {
      if (!outputText || parsed.text.length >= outputText.length) {
        outputText = parsed.text;
      }
      const index = toIndex(parsed.output_index, parsed.item_id);
      const contentIndex = toIndex(parsed.content_index, undefined);
      if (index >= 0 && contentIndex >= 0) {
        const item = ensureMessageItem(index, parsed.item_id);
        const content = Array.isArray(item.content) ? item.content : (item.content = []);
        content[contentIndex] = { type: "output_text", text: parsed.text };
      }
      return;
    }

    if (type.endsWith("arguments.delta") && typeof parsed.delta === "string") {
      const index = toIndex(parsed.output_index, parsed.item_id);
      if (index >= 0) {
        const callItem = ensureFunctionCallItem(index, parsed.item_id);
        callItem.arguments += parsed.delta;
      }
      return;
    }

    if (type.endsWith("arguments.done") && typeof parsed.arguments === "string") {
      const index = toIndex(parsed.output_index, parsed.item_id);
      if (index >= 0) {
        const callItem = ensureFunctionCallItem(index, parsed.item_id);
        callItem.arguments = parsed.arguments;
      }
    }
  };

  const tryParseBuffer = (force: boolean) => {
    if (buffer.length === 0) return;
    const rawWithNewlines = buffer.join("\n").trim();
    const rawNoNewlines = buffer.join("").trim();
    if (!rawWithNewlines) {
      if (force) buffer = [];
      return;
    }
    if (rawWithNewlines === "[DONE]" || rawNoNewlines === "[DONE]") {
      buffer = [];
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawWithNewlines);
    } catch {
      try {
        parsed = JSON.parse(rawNoNewlines);
      } catch {
        if (force) buffer = [];
        return;
      }
    }
    buffer = [];
    const record = asObject(parsed);
    if (!record) return;
    handleEvent(record);
  };

  const finalize = () => {
    tryParseBuffer(true);
    const mergedOutput = outputItems.filter((item): item is ResponsesOutputItem => Boolean(item));
    if (mergedOutput.length > 0) {
      if (!Array.isArray(lastJson.output) || lastJson.output.length === 0) {
        lastJson.output = mergedOutput;
      } else {
        const output = lastJson.output;
        for (let i = 0; i < outputItems.length; i += 1) {
          const item = outputItems[i];
          if (!item) continue;
          if (!output[i]) {
            output[i] = item;
          }
        }
      }
    }

    if (outputText) {
      if (typeof lastJson.output_text !== "string" || !lastJson.output_text) {
        lastJson.output_text = outputText;
      }
      if (!Array.isArray(lastJson.output) || lastJson.output.length === 0) {
        lastJson.output = [{ type: "message", content: [{ type: "output_text", text: outputText }], role: "assistant" }];
      }
    }
    return lastJson;
  };

  return {
    pushLine(line: string) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        tryParseBuffer(true);
        return;
      }
      if (!trimmed.startsWith("data:")) return;
      buffer.push(trimmed.slice(5).trim());
      tryParseBuffer(false);
    },
    finish() {
      return finalize();
    },
  };
}

function parseEventStream(body: string, onTextDelta?: (delta: string) => void) {
  const parser = createEventStreamParser(onTextDelta);
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    parser.pushLine(line);
  }
  return parser.finish();
}

function summarizeToolLinkage(messages: Message[]) {
  const assistantCalls = new Map<string, number>();
  const toolOutputs = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.toolCalls)) {
      for (const call of msg.toolCalls) {
        const id = String(call?.id || "").trim();
        if (!id) continue;
        assistantCalls.set(id, (assistantCalls.get(id) ?? 0) + 1);
      }
      continue;
    }
    if (msg.role === "tool") {
      const id = String(msg.toolCallId || "").trim();
      if (!id) continue;
      toolOutputs.set(id, (toolOutputs.get(id) ?? 0) + 1);
    }
  }

  const missingOutputForCall: string[] = [];
  for (const [id, callCount] of assistantCalls.entries()) {
    const outputCount = toolOutputs.get(id) ?? 0;
    if (outputCount < callCount) missingOutputForCall.push(id);
  }

  const orphanToolOutputs: string[] = [];
  for (const id of toolOutputs.keys()) {
    if (!assistantCalls.has(id)) orphanToolOutputs.push(id);
  }

  return {
    assistantCallCount: Array.from(assistantCalls.values()).reduce((a, b) => a + b, 0),
    toolOutputCount: Array.from(toolOutputs.values()).reduce((a, b) => a + b, 0),
    assistantCallIds: Array.from(assistantCalls.keys()),
    toolOutputIds: Array.from(toolOutputs.keys()),
    missingOutputForCall,
    orphanToolOutputs,
  };
}

function assertToolLinkage(messages: Message[]): void {
  const linkage = summarizeToolLinkage(messages);
  if (linkage.orphanToolOutputs.length === 0) return;
  throw new Error(
    [
      "运行时消息历史包含孤儿 tool output，已在本地阻止发送到 LLM。",
      `orphanToolOutputIds=${linkage.orphanToolOutputs.join(", ")}`,
      `assistantCallIds=${linkage.assistantCallIds.join(", ") || "none"}`,
      `toolOutputIds=${linkage.toolOutputIds.join(", ") || "none"}`,
    ].join(" "),
  );
}

function safePreview(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
  }
}

function buildLlmRequestSummary(input: {
  apiStyle: "chat" | "responses";
  url: string;
  model: string;
  retry: number;
  stream: boolean;
  systemChars: number;
  messages: Message[];
  toolDefinitions: number;
  payload: unknown;
  inputItems?: number;
}): LlmRequestSummary {
  const messageSummary = summarizeRequestMessages(input.messages);
  return {
    apiStyle: input.apiStyle,
    url: input.url,
    model: input.model,
    retry: input.retry,
    stream: input.stream,
    systemChars: input.systemChars,
    toolDefinitions: input.toolDefinitions,
    approxPayloadChars: safeJsonLength(input.payload),
    ...messageSummary,
    ...(typeof input.inputItems === "number" ? { inputItems: input.inputItems } : {}),
  };
}

function summarizeRequestMessages(messages: Message[]): LlmRequestMessageSummary {
  const summary: LlmRequestMessageSummary = {
    messageCount: messages.length,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolMessageCount: 0,
    assistantToolCallCount: 0,
    totalMessageChars: 0,
    userMessageChars: 0,
    assistantMessageChars: 0,
    toolMessageChars: 0,
    maxSingleMessageChars: 0,
    maxToolMessageChars: 0,
    toolMessagesOver16k: 0,
    largestToolMessages: [],
  };

  for (const message of messages) {
    const chars = String(message?.content || "").length;
    summary.totalMessageChars += chars;
    summary.maxSingleMessageChars = Math.max(summary.maxSingleMessageChars, chars);
    if (message.role === "user") {
      summary.userMessageCount += 1;
      summary.userMessageChars += chars;
      continue;
    }
    if (message.role === "assistant") {
      summary.assistantMessageCount += 1;
      summary.assistantMessageChars += chars;
      summary.assistantToolCallCount += Array.isArray(message.toolCalls)
        ? message.toolCalls.length
        : 0;
      continue;
    }
    if (message.role === "tool") {
      summary.toolMessageCount += 1;
      summary.toolMessageChars += chars;
      summary.maxToolMessageChars = Math.max(summary.maxToolMessageChars, chars);
      if (chars > 16_000) summary.toolMessagesOver16k += 1;
      summary.largestToolMessages.push({
        toolCallId: String(message.toolCallId || "").trim() || "unknown",
        chars,
      });
    }
  }

  summary.largestToolMessages = summary.largestToolMessages
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 5);

  return summary;
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function createHttpStatusError(input: {
  status: number;
  bodyText: string;
  requestSummary: LlmRequestSummary;
}): Error {
  const responsePreview = truncateDiagnosticText(input.bodyText, 1_600);
  const error = new Error(
    `LLM 请求失败: ${input.status} ${responsePreview || "<empty response body>"}`,
  ) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  error.code = `llm_http_${input.status}`;
  error.details = {
    status: input.status,
    responsePreview,
    requestSummary: input.requestSummary,
  };
  return error;
}

function attachRequestSummaryToError(
  error: unknown,
  requestSummary: LlmRequestSummary,
): Error {
  const wrapped =
    error instanceof Error ? error : new Error(String(error || "unknown_llm_error"));
  const record = wrapped as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  const existingDetails =
    record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? record.details
      : {};
  record.code = record.code || "llm_fetch_failed";
  record.details = {
    ...existingDetails,
    requestSummary,
  };
  return wrapped;
}

function truncateDiagnosticText(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseTimeoutMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseRetryCount(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(5, Math.trunc(n)));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function isLlmDebugEnabled(): boolean {
  const raw = String(process.env.AGENTS_LLM_DEBUG_LOG || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function shouldLogPayload(): boolean {
  const raw = String(process.env.AGENTS_LLM_DEBUG_PAYLOAD || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configureDnsResultOrderOnce() {
  if (dnsConfigured) return;
  dnsConfigured = true;
  const order = (process.env.AGENTS_DNS_RESULT_ORDER || "").trim();
  if (order !== "ipv4first" && order !== "verbatim") return;
  try {
    setDefaultResultOrder(order);
  } catch {
    // Ignore unsupported platforms/runtimes.
  }
}

function isRetryableFetchError(error: unknown): boolean {
  const err = asObject(error);
  const cause = asObject(err?.cause);
  const message = asString(err?.message).toLowerCase();
  const causeMessage = asString(cause?.message).toLowerCase();
  const code = asString(cause?.code);

  if (code === "UND_ERR_CONNECT_TIMEOUT") return true;
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return true;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN") return true;
  if (message.includes("timeout") || causeMessage.includes("timeout")) return true;
  return false;
}

async function createNodeFetchDispatcher(timeoutMs: number | null): Promise<unknown | null> {
  if (typeof process === "undefined") return null;
  const effectiveTimeoutMs = timeoutMs ? Math.max(5_000, Math.floor(timeoutMs)) : 600_000;
  if (nodeFetchDispatcherCache.has(effectiveTimeoutMs)) {
    return nodeFetchDispatcherCache.get(effectiveTimeoutMs) ?? null;
  }
  try {
    const undiciModule = requireNodeModule("undici") as unknown;
    if (!undiciModule || typeof undiciModule !== "object") return null;
    const agentCtor = Reflect.get(undiciModule, "Agent");
    if (typeof agentCtor !== "function") return null;
    const AgentCtor = agentCtor as new (options: {
      headersTimeout: number;
      bodyTimeout: number;
      connect?: { timeout: number };
    }) => unknown;
    const dispatcher = new AgentCtor({
      headersTimeout: effectiveTimeoutMs + 15_000,
      bodyTimeout: effectiveTimeoutMs + 15_000,
      connect: {
        timeout: effectiveTimeoutMs + 15_000,
      },
    });
    nodeFetchDispatcherCache.set(effectiveTimeoutMs, dispatcher);
    return dispatcher;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const text = typeof reason === "string" ? reason.trim() : "";
  throw new Error(text || "LLM 请求已中止。");
}

function buildFetchAbortSignal(
  timeoutMs: number | null,
  externalSignal: AbortSignal | null,
): { signal?: AbortSignal; cleanup: () => void } {
  const controller =
    timeoutMs || externalSignal
      ? new AbortController()
      : null;
  if (!controller) {
    return {
      cleanup() {
        return;
      },
    };
  }

  let timeoutHandle: NodeJS.Timeout | null = null;
  const abortFromExternal = () => {
    const reason = externalSignal?.reason;
    controller.abort(reason instanceof Error ? reason : undefined);
  };

  if (timeoutMs) {
    timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    },
  };
}

function buildCandidateUrls(url: string): string[] {
  const primary = [url];
  if (/^https:\/\/right\.codes\b/i.test(url)) {
    return [...primary, url.replace(/^https:\/\/right\.codes\b/i, "https://www.right.codes")];
  }
  return primary;
}

function wrapFetchError(
  error: unknown,
  url: string,
  apiBaseUrl: string,
  timeoutMs: number | null,
  retries: number
): Error {
  const err = asObject(error);
  const cause = asObject(err?.cause);
  const isAbort =
    (asString(err?.name) === "AbortError") ||
    (asString(cause?.name) === "AbortError");
  const detail = [
    asString(err?.message) ? `error=${asString(err?.message)}` : null,
    asString(cause?.code) ? `cause.code=${asString(cause?.code)}` : null,
    asString(cause?.message) ? `cause.message=${asString(cause?.message)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const msg = [
    `LLM 请求失败：fetch ${url} 失败。`,
    `请检查网络/DNS，或修改 apiBaseUrl（当前：${apiBaseUrl}）。`,
    "可通过 agents.config.json 的 apiBaseUrl 或环境变量 AGENTS_API_BASE_URL 覆盖。",
    "示例：AGENTS_API_BASE_URL=https://right.codes/codex/v1（或 https://api.openai.com/v1）。",
    retries > 0 ? `已重试 ${retries} 次（可设置 AGENTS_FETCH_RETRIES 调整，默认 1）。` : null,
    "若是偶发连接超时，可尝试 AGENTS_DNS_RESULT_ORDER=ipv4first。",
    isAbort && timeoutMs ? `请求超过 ${timeoutMs}ms 已中止（可设置 AGENTS_REQUEST_TIMEOUT_MS 调整）。` : null,
    detail ? `(${detail})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const wrapped = new Error(msg);
  return Object.assign(wrapped, { cause: error });
}
