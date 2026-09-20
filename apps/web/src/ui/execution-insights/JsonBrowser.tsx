import React from 'react'
import { isRecord, pointerToken } from './model'

export function JsonBrowser({ value, path = '', label = '数据' }: { value: unknown; path?: string; label?: string }): React.JSX.Element {
  const [count, setCount] = React.useState(50)
  const [copyStatus, setCopyStatus] = React.useState('')
  const structured = isRecord(value) || Array.isArray(value)
  const entries = structured ? Object.entries(value) : []
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopyStatus('已复制') }
    catch (error: unknown) { setCopyStatus(error instanceof Error ? error.message : '复制失败') }
  }
  return <div className="execution-insights__json">
    <details className="json-browser__details">
      <summary className="json-browser__summary">{label} · {structured ? `${Array.isArray(value) ? '数组' : '对象'} ${entries.length} 项` : value === null ? 'null' : typeof value}</summary>
      <div className="execution-insights__json-actions">
        <code className="json-browser__code">{path || '/'}</code>
        <button className="json-browser__button" type="button" onClick={() => void copy(path)}>复制 JSON Pointer</button>
        <button className="json-browser__button" type="button" onClick={() => void copy(JSON.stringify(value, null, 2) ?? 'undefined')}>复制值</button>
        <span className="json-browser__span" role="status">{copyStatus}</span>
      </div>
      {structured ? <div className="execution-insights__json-children">
        {entries.slice(0, count).map(([key, child]) => <JsonBrowser key={key} label={key} path={`${path}/${pointerToken(key)}`} value={child} />)}
        {entries.length > count && <button className="json-browser__button" type="button" onClick={() => setCount(count + 50)}>继续展开 {Math.min(50, entries.length - count)} 项</button>}
      </div> : <pre className="json-browser__pre">{value === undefined ? '未记录' : JSON.stringify(value, null, 2)}</pre>}
    </details>
  </div>
}
