export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowJsonValue[]
  | Readonly<{ [key: string]: WorkflowJsonValue }>

export type WorkflowJavascriptResult = Readonly<{
  output: WorkflowJsonValue
  durationMs: number
}>

type SandboxResponse = Readonly<{
  channel: 'tapcanvas-workflow-javascript'
  runId: string
  ok: boolean
  output?: unknown
  error?: unknown
}>

const SANDBOX_CHANNEL = 'tapcanvas-workflow-javascript'
const DEFAULT_TIMEOUT_MS = 5_000
const SANDBOX_WORKER_SOURCE = `
self.onmessage = async (event) => {
  const payload = event.data;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = new AsyncFunction('input', '"use strict";\\n' + payload.code);
    const output = await execute(payload.input);
    self.postMessage({ runId: payload.runId, ok: true, output });
  } catch (error) {
    self.postMessage({ runId: payload.runId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
`

function isWorkflowJsonValue(value: unknown): value is WorkflowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isWorkflowJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every(isWorkflowJsonValue)
}

function isSandboxResponse(value: unknown): value is SandboxResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.channel === SANDBOX_CHANNEL
    && typeof record.runId === 'string'
    && typeof record.ok === 'boolean'
}

export function parseWorkflowTestInput(raw: string): WorkflowJsonValue {
  const normalized = raw.trim()
  if (!normalized) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized) as unknown
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? `测试输入不是有效 JSON：${error.message}` : '测试输入不是有效 JSON')
  }
  if (!isWorkflowJsonValue(parsed)) throw new Error('测试输入必须是可序列化的 JSON 值')
  return parsed
}

export function stringifyWorkflowValue(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function createSandboxDocument(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
</head>
<body>
<script>
(() => {
  const channel = '${SANDBOX_CHANNEL}';
  const workerSource = ${JSON.stringify(SANDBOX_WORKER_SOURCE)};
  window.addEventListener('message', (event) => {
    const payload = event.data;
    if (!payload || payload.channel !== channel || typeof payload.runId !== 'string') return;
    const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl);
    const finish = (message) => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      parent.postMessage({ channel, ...message }, '*');
    };
    const timeout = setTimeout(() => finish({ runId: payload.runId, ok: false, error: '脚本执行超过 5 秒，已终止' }), ${DEFAULT_TIMEOUT_MS});
    worker.onmessage = (workerEvent) => {
      clearTimeout(timeout);
      finish(workerEvent.data);
    };
    worker.onerror = (workerError) => {
      clearTimeout(timeout);
      finish({ runId: payload.runId, ok: false, error: workerError.message || '隔离脚本执行失败' });
    };
    worker.postMessage({ runId: payload.runId, code: payload.code, input: payload.input });
  });
  parent.postMessage({ channel, runId: 'ready', ok: true, output: null }, '*');
})();
</script>
</body>
</html>`
}

export function executeWorkflowJavascriptSandbox(input: Readonly<{
  code: string
  value: WorkflowJsonValue
  timeoutMs?: number
}>): Promise<WorkflowJavascriptResult> {
  const code = input.code.trim()
  if (!code) return Promise.reject(new Error('JavaScript 脚本不能为空'))
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('本地隔离测试只能在浏览器中运行'))
  }
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    return Promise.reject(new Error('当前浏览器不支持安全 UUID，无法创建隔离脚本运行'))
  }
  const runId = globalThis.crypto.randomUUID()
  const startedAt = performance.now()
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.display = 'none'
  iframe.srcdoc = createSandboxDocument()
  document.body.appendChild(iframe)

  return new Promise<WorkflowJavascriptResult>((resolve, reject) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS + 1_000
    const cleanup = (): void => {
      window.removeEventListener('message', handleMessage)
      window.clearTimeout(parentTimeout)
      iframe.remove()
    }
    const fail = (message: string): void => {
      cleanup()
      reject(new Error(message))
    }
    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== iframe.contentWindow || !isSandboxResponse(event.data)) return
      if (event.data.runId === 'ready') {
        iframe.contentWindow?.postMessage({ channel: SANDBOX_CHANNEL, runId, code, input: input.value }, '*')
        return
      }
      if (event.data.runId !== runId) return
      if (!event.data.ok) {
        fail(typeof event.data.error === 'string' ? event.data.error : '隔离脚本执行失败')
        return
      }
      if (!isWorkflowJsonValue(event.data.output)) {
        fail('脚本输出必须是可序列化的 JSON 值')
        return
      }
      const result = { output: event.data.output, durationMs: Math.round(performance.now() - startedAt) }
      cleanup()
      resolve(result)
    }
    const parentTimeout = window.setTimeout(() => fail('隔离脚本没有在期限内返回结果'), timeoutMs)
    window.addEventListener('message', handleMessage)
  })
}
